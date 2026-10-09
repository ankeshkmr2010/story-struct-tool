"""Signed-in author consent and revocation. OAuth credentials never reach the model."""

from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

from litestar import Controller, Request, delete, get, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.oauth import complete_consent, consent_record
from storytool.domain.auth.oauth_models import MCPClient, MCPGrant
from storytool.domain.story.models import Story


class ConsentDecision(BaseModel):
    story_id: UUID | None = None
    scopes: list[str] = Field(default_factory=list, max_length=6)
    deny: bool = False


class OAuthConsentController(Controller):
    path = "/api/mcp"
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/consent/{request_id:str}")
    async def consent(self, db_session: AsyncSession, request_id: str) -> dict:
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
            )
        except ValueError as exc:
            raise ClientException(detail=str(exc)) from None
        return {"redirect_url": target}

    @get("/grants")
    async def grants(self, request: Request, db_session: AsyncSession) -> list[dict]:
        rows = (
            await db_session.execute(
                select(MCPGrant, MCPClient, Story.title)
                .join(MCPClient, MCPClient.client_id == MCPGrant.client_id)
                .outerjoin(Story, Story.id == MCPGrant.story_id)
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
                "story_title": title or "All your stories",
                "scopes": grant.scopes,
                "expires_at": grant.expires_at.isoformat(),
                "revoked_at": grant.revoked_at.isoformat() if grant.revoked_at else None,
            }
            for grant, client, title in rows
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
