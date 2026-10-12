"""On-demand story evaluation endpoints.

Running a deterministic evaluator is a GET: a pure read of the graph, nothing stored, so it
works for read-only agent tokens too. AI reviews are the one stored part: an agent reads the
package (GET) and submits a report (POST, needs story:write); with a connected key the server
runs the same package itself (`/ai-review`, browser only, never locked across the model call).
"""

from typing import Any
from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai import runner
from storytool.domain.ai.commands import fingerprint, snapshot
from storytool.domain.ai.controller import actor, connection
from storytool.domain.ai.credentials import decrypt_key
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.evaluation import all_evaluators, get_evaluator
from storytool.domain.evaluation.engine import Evaluator, Review
from storytool.domain.evaluation.reports import (
    EvaluationReport,
    PackageOut,
    ReportIn,
    ReportOut,
    checked_verdicts,
    result_schema,
)
from storytool.domain.graph import StoryGraph


class EvaluatorOut(BaseModel):
    id: str
    name: str
    description: str
    kind: str
    has_review: bool
    inputs: list[str]
    ready: bool
    missing: list[str]


class EvaluationFindingOut(BaseModel):
    code: str
    severity: str
    message: str
    entity_type: str | None
    entity_id: UUID | None


class EvaluationOut(BaseModel):
    story_id: UUID
    evaluator_id: str
    ready: bool
    missing: list[str]
    findings: list[EvaluationFindingOut]
    visual: dict[str, Any]


class AIReviewRequest(BaseModel):
    connection_id: UUID


class EvaluationController(Controller):
    path = "/api/stories/{story_id:uuid}/evaluations"
    tags = ["evaluation"]
    signature_namespace = {"AsyncSession": AsyncSession}

    async def _graph(self, db_session: AsyncSession, story_id: UUID) -> StoryGraph:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return graph

    @get(summary="List evaluators and whether each can run on this story")
    async def list_evaluators(self, db_session: AsyncSession, story_id: UUID) -> list[EvaluatorOut]:
        graph = await self._graph(db_session, story_id)
        out = []
        for evaluator in all_evaluators():
            missing = evaluator.missing(graph)
            out.append(
                EvaluatorOut(
                    id=evaluator.id,
                    name=evaluator.name,
                    description=evaluator.description,
                    kind=evaluator.kind,
                    has_review=evaluator.review is not None,
                    inputs=list(evaluator.inputs),
                    ready=not missing,
                    missing=missing,
                )
            )
        return out

    @get("/{evaluator_id:str}", summary="Run one evaluator")
    async def run_evaluator(
        self, db_session: AsyncSession, story_id: UUID, evaluator_id: str
    ) -> EvaluationOut:
        evaluator = get_evaluator(evaluator_id)
        if evaluator is None:
            raise NotFoundException(detail=f"No evaluator {evaluator_id!r}")
        graph = await self._graph(db_session, story_id)

        missing = evaluator.missing(graph)
        if missing:
            return EvaluationOut(
                story_id=story_id,
                evaluator_id=evaluator.id,
                ready=False,
                missing=missing,
                findings=[],
                visual={},
            )
        result = evaluator.run(graph)
        return EvaluationOut(
            story_id=story_id,
            evaluator_id=evaluator.id,
            ready=True,
            missing=[],
            findings=[
                EvaluationFindingOut(
                    code=f.code,
                    severity=f.severity.value,
                    message=f.message,
                    entity_type=f.entity_type,
                    entity_id=f.entity_id,
                )
                for f in result.findings
            ],
            visual=result.visual,
        )

    # ------------------------------------------------------------------ AI reviews

    def _reviewer(self, evaluator_id: str) -> tuple[Evaluator, Review]:
        evaluator = get_evaluator(evaluator_id)
        if evaluator is None or evaluator.review is None:
            raise NotFoundException(detail=f"No AI review for {evaluator_id!r}")
        return evaluator, evaluator.review

    async def _package(
        self, db_session: AsyncSession, story_id: UUID, evaluator_id: str
    ) -> PackageOut:
        evaluator, review = self._reviewer(evaluator_id)
        graph = await self._graph(db_session, story_id)
        missing = evaluator.missing(graph)
        if missing:
            raise ClientException(detail="Not ready for review: " + "; ".join(missing))
        return PackageOut(
            story_id=story_id,
            evaluator_id=evaluator.id,
            base_fingerprint=fingerprint(await snapshot(db_session, story_id)),
            subject=review.subject,
            instructions=review.instructions,
            inputs=review.inputs(graph),
            result_schema=result_schema(review.subject),
        )

    async def _save(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        evaluator_id: str,
        data: ReportIn,
        source: str,
        model: str | None,
    ) -> ReportOut:
        _, review = self._reviewer(evaluator_id)
        current = fingerprint(await snapshot(db_session, story_id))
        if data.base_fingerprint != current:
            raise ClientException(
                status_code=409,
                detail="The story changed since this package was read. "
                "Fetch it again and re-judge.",
            )
        graph = await self._graph(db_session, story_id)
        row = EvaluationReport(
            story_id=story_id,
            evaluator_id=evaluator_id,
            source=source,
            model=model,
            base_fingerprint=data.base_fingerprint,
            summary=data.summary.strip(),
            verdicts=checked_verdicts(graph, review, data),
        )
        db_session.add(row)
        await db_session.flush()
        return _report_out(row, current)

    @get("/{evaluator_id:str}/package", summary="Instructions and inputs for an AI review")
    async def get_package(
        self, db_session: AsyncSession, story_id: UUID, evaluator_id: str
    ) -> PackageOut:
        return await self._package(db_session, story_id, evaluator_id)

    @get("/{evaluator_id:str}/reports", summary="Saved AI reviews, newest first")
    async def list_reports(
        self, db_session: AsyncSession, story_id: UUID, evaluator_id: str
    ) -> list[ReportOut]:
        self._reviewer(evaluator_id)
        current = fingerprint(await snapshot(db_session, story_id))
        rows = await db_session.scalars(
            select(EvaluationReport)
            .where(
                EvaluationReport.story_id == story_id,
                EvaluationReport.evaluator_id == evaluator_id,
            )
            .order_by(EvaluationReport.created_at.desc(), EvaluationReport.id.desc())
            .limit(20)
        )
        return [_report_out(row, current) for row in rows]

    @post("/{evaluator_id:str}/reports", summary="Submit an AI review (MCP agents)")
    async def submit_report(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        evaluator_id: str,
        data: ReportIn,
    ) -> ReportOut:
        origin = request.scope["state"].get("storytool_write_origin", "author")
        return await self._save(
            db_session, story_id, evaluator_id, data, "mcp" if origin == "mcp" else "author", None
        )

    @post("/{evaluator_id:str}/ai-review", summary="Run an AI review with a connected key")
    async def ai_review(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        evaluator_id: str,
        data: AIReviewRequest,
    ) -> ReportOut:
        row = await connection(db_session, actor(request), data.connection_id)
        # Read everything off the row now: after the commit below it is expired.
        provider, model, api_key = row.provider, row.model, decrypt_key(row.encrypted_key)
        if provider == "jev":
            raise ClientException(detail="Choose Claude, OpenAI or OpenRouter to run a review")
        # Lock only while packaging, never across the remote call (see /ai/propose).
        await db_session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": int.from_bytes(story_id.bytes[:8], "big", signed=True)},
        )
        package = await self._package(db_session, story_id, evaluator_id)
        await db_session.commit()
        result, _ = await runner.generate_review(
            provider,
            model,
            api_key,
            package.instructions,
            package.inputs,
            package.result_schema,
        )
        try:
            report = ReportIn.model_validate(
                {**result, "base_fingerprint": package.base_fingerprint}
            )
        except ValidationError:
            raise ClientException(
                detail="The model's review did not match the expected format. Try again."
            ) from None
        return await self._save(db_session, story_id, evaluator_id, report, "assistant", model)


def _report_out(row: EvaluationReport, current: str) -> ReportOut:
    return ReportOut(
        id=row.id,
        evaluator_id=row.evaluator_id,
        source=row.source,
        model=row.model,
        summary=row.summary,
        verdicts=row.verdicts,
        base_fingerprint=row.base_fingerprint,
        created_at=row.created_at,
        stale=row.base_fingerprint != current,
    )
