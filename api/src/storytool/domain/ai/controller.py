import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from litestar import Controller, Request, delete, get, post, put
from litestar.exceptions import ClientException, NotFoundException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai import runner
from storytool.domain.ai.commands import (
    execute_proposal,
    fingerprint,
    matches_fingerprint,
    owned_story,
    snapshot,
    undo_operations,
)
from storytool.domain.ai.context import story_context
from storytool.domain.ai.credentials import decrypt_key, encrypt_key
from storytool.domain.ai.diagnostics import response_log
from storytool.domain.ai.models import AgentToken, AIConnection, AIRun
from storytool.domain.ai.schemas import (
    ConnectionOut,
    ConnectionSave,
    ObservationOut,
    PromptRequest,
    Proposal,
    RunOut,
    TokenRequest,
)


class ConflictException(ClientException):
    status_code = 409


def actor(request: Request) -> UUID:
    return request.scope["state"]["storytool_user_id"]


def proposal_evidence(proposal: Proposal, context: dict[str, Any]) -> list[dict[str, Any]]:
    identifiers = {
        str(identifier)
        for recommendation in proposal.recommendations
        for identifier in recommendation.observation_ids
    }
    scenes = {
        row["id"]: row.get("title") or "Untitled scene" for row in context["entities"]["scene"]
    }
    return [
        dict(row, scene_title=scenes[row["scene_id"]])
        for row in context["observations"]
        if row["id"] in identifiers
    ]


async def connection(db: AsyncSession, user_id: UUID, identifier: UUID) -> AIConnection:
    record = await db.scalar(
        select(AIConnection).where(AIConnection.id == identifier, AIConnection.user_id == user_id)
    )
    if record is None:
        raise NotFoundException(detail="Provider connection not found")
    return record


async def run_record(db: AsyncSession, user_id: UUID, story_id: UUID, identifier: UUID) -> AIRun:
    record = await db.scalar(
        select(AIRun).where(
            AIRun.id == identifier, AIRun.user_id == user_id, AIRun.story_id == story_id
        )
    )
    if record is None:
        raise NotFoundException(detail="AI proposal not found")
    return record


async def validate_changes(
    db: AsyncSession, user_id: UUID, story_id: UUID, proposal: Proposal
) -> None:
    # Exercise the real executor under a savepoint, then discard all writes.
    try:
        async with db.begin_nested() as savepoint:
            await execute_proposal(db, story_id, user_id, proposal)
            await savepoint.rollback()
    except IntegrityError:
        raise ClientException(
            detail="The plan conflicts with existing story data. "
            "Ask the assistant to reuse existing entities and revise the plan."
        ) from None


class AIController(Controller):
    path = "/api"
    tags = ["authoring-ai"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/stories/{story_id:uuid}/ai/fingerprint")
    async def state_fingerprint(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> dict[str, str]:
        await owned_story(db_session, story_id, actor(request))
        return {"base_fingerprint": fingerprint(await snapshot(db_session, story_id))}

    @get("/ai/connections")
    async def list_connections(
        self, request: Request, db_session: AsyncSession
    ) -> list[ConnectionOut]:
        rows = (
            await db_session.execute(
                select(AIConnection).where(AIConnection.user_id == actor(request))
            )
        ).scalars()
        return [ConnectionOut.model_validate(row) for row in rows]

    @put("/ai/connections")
    async def save_connection(self, request: Request, db_session: AsyncSession) -> ConnectionOut:
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise ClientException(detail="Send credentials as JSON")
        try:
            validated = ConnectionSave.model_validate(await request.json())
        except (ValidationError, ValueError):
            raise ClientException(detail="Choose a provider, model, and valid API key") from None
        stmt = (
            insert(AIConnection)
            .values(
                user_id=actor(request),
                provider=validated.provider,
                model=validated.model,
                encrypted_key=encrypt_key(validated.api_key),
                key_suffix=validated.api_key[-4:],
            )
            .on_conflict_do_update(
                constraint="one_provider_per_user",
                set_={
                    "model": validated.model,
                    "encrypted_key": encrypt_key(validated.api_key),
                    "key_suffix": validated.api_key[-4:],
                },
            )
            .returning(AIConnection)
        )
        row = (await db_session.execute(stmt)).scalar_one()
        return ConnectionOut.model_validate(row)

    @post("/ai/connections/{connection_id:uuid}/test")
    async def test_connection(
        self, request: Request, db_session: AsyncSession, connection_id: UUID
    ) -> dict[str, bool]:
        row = await connection(db_session, actor(request), connection_id)
        await runner.test_provider(row.provider, row.model, decrypt_key(row.encrypted_key))
        return {"connected": True}

    @delete("/ai/connections/{connection_id:uuid}")
    async def disconnect(
        self, request: Request, db_session: AsyncSession, connection_id: UUID
    ) -> None:
        await db_session.delete(await connection(db_session, actor(request), connection_id))

    @get("/stories/{story_id:uuid}/ai/context")
    async def context(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        include_prose: bool = False,
    ) -> dict[str, Any]:
        await owned_story(db_session, story_id, actor(request))
        await db_session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": int.from_bytes(story_id.bytes[:8], "big", signed=True)},
        )
        return await story_context(db_session, story_id, include_prose)

    @get("/stories/{story_id:uuid}/ai/runs")
    async def list_runs(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> list[RunOut]:
        rows = (
            await db_session.execute(
                select(AIRun)
                .where(AIRun.story_id == story_id, AIRun.user_id == actor(request))
                .order_by(AIRun.created_at.desc())
                .limit(30)
            )
        ).scalars()
        runs = [RunOut.model_validate(row) for row in rows]
        response_log(
            "ai_history_served",
            story_id=story_id,
            count=len(runs),
            latest_run=runs[0].id if runs else None,
            latest_reply_length=len(runs[0].summary) if runs else 0,
        )
        return runs

    @get("/stories/{story_id:uuid}/ai/observations")
    async def observations(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> list[ObservationOut]:
        await owned_story(db_session, story_id, actor(request))
        context = await story_context(db_session, story_id, True)
        scenes = {
            row["id"]: row.get("title") or "Untitled scene" for row in context["entities"]["scene"]
        }
        return [
            ObservationOut(**row, scene_title=scenes[row["scene_id"]])
            for row in context["observations"]
        ]

    @post("/stories/{story_id:uuid}/ai/propose")
    async def propose(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: PromptRequest
    ) -> RunOut:
        user_id = actor(request)
        await owned_story(db_session, story_id, user_id)
        row = await connection(db_session, user_id, data.connection_id)
        provider, model, api_key = row.provider, row.model, decrypt_key(row.encrypted_key)
        if provider == "jev":
            raise ClientException(detail="Choose Claude or OpenAI for authoring; Jev is a reader")
        # Lock only while taking a consistent snapshot, not during the remote model call.
        await db_session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": int.from_bytes(story_id.bytes[:8], "big", signed=True)},
        )
        state = await snapshot(db_session, story_id)
        context = await story_context(db_session, story_id, data.include_prose, state)
        conversation = []
        for identifier in dict.fromkeys(data.conversation_run_ids):
            previous = await run_record(db_session, user_id, story_id, identifier)
            conversation.append(
                {
                    "user": previous.prompt,
                    "assistant": previous.summary,
                    "change_status": previous.status,
                    "proposed_changes": previous.proposal,
                }
            )
        context["conversation"] = conversation
        context["assistant_mode"] = data.mode
        if len(json.dumps(context)) > 180000:
            raise ClientException(
                detail="This story exceeds the current context limit. Try without prose."
            )
        await db_session.commit()
        prompt = data.prompt
        proposal, usage = await runner.generate_proposal(provider, model, api_key, prompt, context)
        known_observations = {row["id"] for row in context["observations"]}
        validation_error = None
        try:
            if any(
                str(identifier) not in known_observations
                for recommendation in proposal.recommendations
                for identifier in recommendation.observation_ids
            ):
                raise ClientException(
                    detail="The model cited an observation outside this story context"
                )
            await validate_changes(db_session, user_id, story_id, proposal)
        except (ClientException, NotFoundException) as exc:
            # Retain the conversation reply and rejected plan for a follow-up correction.
            # Invalid plans are never eligible for apply; validation already rolled back.
            validation_error = exc.detail
        record = AIRun(
            user_id=user_id,
            story_id=story_id,
            provider=provider,
            model=model,
            prompt=data.prompt,
            summary=proposal.summary,
            proposal=proposal.model_dump(mode="json"),
            base_fingerprint=fingerprint(state),
            usage=usage,
            evidence=proposal_evidence(proposal, context),
            status="invalid" if validation_error else "proposed",
            result={"validation_error": validation_error} if validation_error else None,
        )
        db_session.add(record)
        await db_session.flush()
        response_log(
            "ai_reply_saved",
            story_id=story_id,
            run_id=record.id,
            status=record.status,
            reply_length=len(record.summary),
            operations=len(proposal.operations),
            validation_error=validation_error,
        )
        return RunOut.model_validate(record)

    @post("/stories/{story_id:uuid}/ai/stage")
    async def stage(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: Proposal
    ) -> RunOut:
        user_id = actor(request)
        await owned_story(db_session, story_id, user_id)
        state = await snapshot(db_session, story_id)
        if data.base_fingerprint and not matches_fingerprint(state, data.base_fingerprint):
            raise ConflictException(
                detail="The story changed since your context read. Read it again."
            )
        context = await story_context(db_session, story_id, False, state)
        known_ids = {row["id"] for row in context["observations"]}
        if any(
            str(identifier) not in known_ids
            for recommendation in data.recommendations
            for identifier in recommendation.observation_ids
        ):
            raise ClientException(detail="An observation reference is invalid")
        await validate_changes(db_session, user_id, story_id, data)
        record = AIRun(
            user_id=user_id,
            story_id=story_id,
            provider="external",
            model="mcp",
            prompt="External agent proposal",
            summary=data.summary,
            proposal=data.model_dump(mode="json"),
            base_fingerprint=fingerprint(state),
            evidence=proposal_evidence(data, context),
        )
        db_session.add(record)
        await db_session.flush()
        return RunOut.model_validate(record)

    @post("/stories/{story_id:uuid}/ai/runs/{run_id:uuid}/apply")
    async def apply(
        self, request: Request, db_session: AsyncSession, story_id: UUID, run_id: UUID
    ) -> RunOut:
        row = await run_record(db_session, actor(request), story_id, run_id)
        if row.status == "applied":
            return RunOut.model_validate(row)
        if row.status != "proposed":
            raise ConflictException(detail="This proposal is no longer pending")
        if not matches_fingerprint(await snapshot(db_session, story_id), row.base_fingerprint):
            raise ConflictException(
                detail="The story changed since this proposal. Generate a fresh one."
            )
        proposal = Proposal.model_validate(row.proposal)
        if any(operation.op == "delete" for operation in proposal.operations):
            request.scope["state"]["explicit_deletion_checkpoint"] = True
            from storytool.domain.versioning.service import checkpoint

            await checkpoint(
                db_session, story_id, actor(request), "Before agent deletion", "recovery"
            )
        result, inverse = await execute_proposal(db_session, story_id, actor(request), proposal)
        row.result, row.inverse, row.status = result, inverse, "applied"
        row.applied_fingerprint = fingerprint(await snapshot(db_session, story_id))
        await db_session.flush()
        return RunOut.model_validate(row)

    @post("/stories/{story_id:uuid}/ai/runs/{run_id:uuid}/undo")
    async def undo(
        self, request: Request, db_session: AsyncSession, story_id: UUID, run_id: UUID
    ) -> RunOut:
        row = await run_record(db_session, actor(request), story_id, run_id)
        if row.status != "applied":
            raise ConflictException(detail="Only an applied proposal can be undone")
        if not row.applied_fingerprint or not matches_fingerprint(
            await snapshot(db_session, story_id), row.applied_fingerprint
        ):
            raise ConflictException(
                detail="The story changed after this batch. Undo would overwrite later work."
            )
        await undo_operations(db_session, story_id, row.inverse)
        row.status = "undone"
        await db_session.flush()
        return RunOut.model_validate(row)

    @post("/stories/{story_id:uuid}/ai/runs/{run_id:uuid}/dismiss")
    async def dismiss(
        self, request: Request, db_session: AsyncSession, story_id: UUID, run_id: UUID
    ) -> RunOut:
        row = await run_record(db_session, actor(request), story_id, run_id)
        if row.status != "proposed":
            raise ConflictException(detail="Only pending proposals can be dismissed")
        row.status = "dismissed"
        return RunOut.model_validate(row)

    @get("/ai/agent-tokens")
    async def list_tokens(self, request: Request, db_session: AsyncSession) -> list[dict[str, Any]]:
        rows = (
            await db_session.execute(select(AgentToken).where(AgentToken.user_id == actor(request)))
        ).scalars()
        return [
            {
                "id": str(row.id),
                "story_id": str(row.story_id),
                "label": row.label,
                "expires_at": row.expires_at.isoformat(),
            }
            for row in rows
        ]

    @post("/ai/agent-tokens")
    async def create_token(
        self, request: Request, db_session: AsyncSession, data: TokenRequest
    ) -> dict[str, Any]:
        await owned_story(db_session, data.story_id, actor(request))
        token = secrets.token_urlsafe(32)
        row = AgentToken(
            user_id=actor(request),
            story_id=data.story_id,
            label=data.label,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
        db_session.add(row)
        await db_session.flush()
        return {"id": str(row.id), "token": token, "expires_at": row.expires_at.isoformat()}

    @delete("/ai/agent-tokens/{token_id:uuid}")
    async def revoke_token(
        self, request: Request, db_session: AsyncSession, token_id: UUID
    ) -> None:
        row = await db_session.scalar(
            select(AgentToken).where(
                AgentToken.id == token_id, AgentToken.user_id == actor(request)
            )
        )
        if row is None:
            raise NotFoundException()
        await db_session.delete(row)
