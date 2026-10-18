"""Signed-in author consent and revocation. OAuth credentials never reach the model."""

from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

from litestar import Controller, Request, delete, get, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.oauth import SCOPES, complete_consent, consent_record
from storytool.domain.auth.oauth_models import MCPClient, MCPGrant
from storytool.domain.story.beta import BetaMember, BetaRound
from storytool.domain.story.models import Story


class ConsentDecision(BaseModel):
    story_id: UUID | None = None
    round_id: UUID | None = None
    scopes: list[str] = Field(default_factory=list, max_length=len(SCOPES))
    deny: bool = False


async def reader_rounds(db: AsyncSession, user_id: UUID) -> list[dict]:
    """Rounds this user reads whose author lets readers connect their own AI."""
    rows = await db.execute(
        select(BetaRound.id, BetaRound.title, Story.title)
        .join(BetaMember, BetaMember.round_id == BetaRound.id)
        .join(Story, Story.id == BetaRound.story_id)
        .where(
            BetaMember.user_id == user_id,
            BetaMember.status == "approved",
            BetaRound.allow_reader_ai.is_(True),
            Story.deleted_at.is_(None),
        )
        .order_by(BetaRound.created_at.desc())
    )
    return [{"id": str(rid), "title": title, "story_title": story} for rid, title, story in rows]


class OAuthConsentController(Controller):
    path = "/api/mcp"
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/consent/{request_id:str}")
    async def consent(self, request: Request, db_session: AsyncSession, request_id: str) -> dict:
        pending = await consent_record(db_session, request_id)
        if pending is None:
            raise NotFoundException(detail="Connection request expired or already completed")
        client = await db_session.scalar(
            select(MCPClient).where(MCPClient.client_id == pending.client_id)
        )
        if client is None:
            raise NotFoundException(detail="Client registration unavailable")
        return {
            "client_name": client.metadata_json.get("client_name") or "External AI client",
            "redirect_host": urlsplit(pending.parameters["redirect_uri"]).netloc,
            "requested_scopes": pending.parameters.get("scopes") or [],
            "expires_at": pending.expires_at.isoformat(),
            "beta_rounds": await reader_rounds(
                db_session, request.scope["state"]["storytool_user_id"]
            ),
        }

    @post("/consent/{request_id:str}")
    async def decide(
        self,
        request: Request,
        db_session: AsyncSession,
        request_id: str,
        data: ConsentDecision,
    ) -> dict:
        try:
            target = await complete_consent(
                db_session,
                request_id,
                request.scope["state"]["storytool_user_id"],
                data.story_id,
                data.scopes,
                data.deny,
                data.round_id,
            )
        except ValueError as exc:
            raise ClientException(detail=str(exc)) from None
        return {"redirect_url": target}

    @get("/grants")
    async def grants(self, request: Request, db_session: AsyncSession) -> list[dict]:
        rows = (
            await db_session.execute(
                select(MCPGrant, MCPClient, Story.title, BetaRound.title)
                .join(MCPClient, MCPClient.client_id == MCPGrant.client_id)
                .outerjoin(Story, Story.id == MCPGrant.story_id)
                .outerjoin(BetaRound, BetaRound.id == MCPGrant.round_id)
                .where(
                    MCPGrant.user_id == request.scope["state"]["storytool_user_id"],
                )
                .order_by(MCPGrant.created_at.desc())
            )
        ).all()
        return [
            {
                "id": str(grant.id),
                "client_name": client.metadata_json.get("client_name") or "External AI client",
                "story_title": title
                or (f"Beta round: {round_title}" if round_title else "All your stories"),
                "scopes": grant.scopes,
                "expires_at": grant.expires_at.isoformat(),
                "revoked_at": grant.revoked_at.isoformat() if grant.revoked_at else None,
            }
            for grant, client, title, round_title in rows
        ]

    @delete("/grants/{grant_id:uuid}")
    async def revoke(self, request: Request, db_session: AsyncSession, grant_id: UUID) -> None:
        grant = await db_session.scalar(
            select(MCPGrant)
            .where(
                MCPGrant.id == grant_id,
                MCPGrant.user_id == request.scope["state"]["storytool_user_id"],
            )
            .with_for_update()
        )
        if grant is None:
            raise NotFoundException(detail="Connection not found")
        grant.revoked_at = datetime.now(UTC)
