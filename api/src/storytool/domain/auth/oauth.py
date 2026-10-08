"""Application persistence for the official SDK's OAuth/PKCE protocol handlers."""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.ai.credentials import decrypt_key, encrypt_key
from storytool.domain.ai.models import AgentToken
from storytool.domain.auth.oauth_models import MCPClient, MCPConsent, MCPGrant, MCPToken
from storytool.domain.story.models import Story

SCOPES = ["story:read", "prose:read", "story:write", "versions:restore"]


def digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issuer() -> str:
    return get_settings().public_url.rstrip("/")


def resource() -> str:
    return issuer() + "/mcp"


@dataclass
class Delegation:
    user_id: UUID
    story_id: UUID
    expires_at: datetime
    scopes: list[str]
    oauth: bool


async def delegated_access(db: AsyncSession, raw: str) -> Delegation | None:
    now = datetime.now(UTC)
    legacy = await db.scalar(
        select(AgentToken)
        .join(Story, Story.id == AgentToken.story_id)
        .where(
            AgentToken.token_hash == digest(raw),
            AgentToken.expires_at > now,
            Story.user_id == AgentToken.user_id,
            Story.deleted_at.is_(None),
        )
    )
    if legacy:
        return Delegation(legacy.user_id, legacy.story_id, legacy.expires_at, SCOPES, False)
    row = (
        await db.execute(
            select(MCPToken, MCPGrant)
            .join(MCPGrant, MCPGrant.id == MCPToken.grant_id)
            .join(Story, Story.id == MCPGrant.story_id)
            .where(
                MCPToken.token_hash == digest(raw),
                MCPToken.kind == "access",
                MCPToken.expires_at > now,
                MCPGrant.expires_at > now,
                MCPGrant.revoked_at.is_(None),
                Story.user_id == MCPGrant.user_id,
                Story.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    token, grant = row
    if token.parameters.get("resource") != resource():
        return None
    scopes = [s for s in token.parameters["scopes"] if s in grant.scopes]
    return Delegation(grant.user_id, grant.story_id, token.expires_at, scopes, True)


class OAuthProvider:
    def __init__(self, config: SQLAlchemyAsyncConfig):
        self.config = config

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with self.config.get_session() as db:
            record = await db.scalar(select(MCPClient).where(MCPClient.client_id == client_id))
            if record is None:
                return None
            data = dict(record.metadata_json)
            if data.get("client_secret"):
                data["client_secret"] = decrypt_key(data["client_secret"])
            return OAuthClientInformationFull.model_validate(data)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if not client_info.redirect_uris:
            raise RegistrationError("invalid_redirect_uri", "At least one redirect is required")
        for uri in client_info.redirect_uris:
            parsed = urlsplit(str(uri))
            if parsed.fragment or not (
                parsed.scheme == "https"
                or (
                    parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
                )
            ):
                raise RegistrationError("invalid_redirect_uri", "Use HTTPS or a loopback redirect")
        data = client_info.model_dump(mode="json")
        if data.get("client_secret"):
            data["client_secret"] = encrypt_key(data["client_secret"])
        async with self.config.get_session() as db:
            db.add(MCPClient(client_id=client_info.client_id, metadata_json=data))
            await db.commit()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        if params.scopes is None:
            params.scopes = (client.scope or " ".join(SCOPES)).split()
        if params.resource is not None and params.resource != resource():
            raise AuthorizeError("invalid_target", "This server authorizes only its MCP endpoint")
        if not set(params.scopes or []) <= set(SCOPES):
            raise AuthorizeError("invalid_scope", "Unknown StoryTool scope")
        params.resource = resource()
        raw = secrets.token_urlsafe(32)
        async with self.config.get_session() as db:
            db.add(
                MCPConsent(
                    request_hash=digest(raw),
                    client_id=client.client_id,
                    parameters=params.model_dump(mode="json"),
                    expires_at=datetime.now(UTC) + timedelta(minutes=10),
                )
            )
            await db.commit()
        return issuer() + "/oauth/consent?request_id=" + raw

    async def load_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: str,
    ) -> AuthorizationCode | None:
        async with self.config.get_session() as db:
            row = await db.scalar(
                select(MCPToken)
                .join(MCPGrant)
                .where(
                    MCPToken.token_hash == digest(authorization_code),
                    MCPToken.kind == "code",
                    MCPToken.consumed_at.is_(None),
                    MCPGrant.client_id == client.client_id,
                    MCPGrant.revoked_at.is_(None),
                    MCPGrant.expires_at > datetime.now(UTC),
                )
            )
            if row is None:
                return None
            return AuthorizationCode(
                code=authorization_code, expires_at=row.expires_at.timestamp(), **row.parameters
            )

    async def _issue(self, db: AsyncSession, grant: MCPGrant, scopes: list[str]) -> OAuthToken:
        access = secrets.token_urlsafe(32)
        refresh = secrets.token_urlsafe(32)
        for raw, kind, expiry in (
            (access, "access", datetime.now(UTC) + timedelta(hours=1)),
            (refresh, "refresh", grant.expires_at),
        ):
            db.add(
                MCPToken(
                    token_hash=digest(raw),
                    kind=kind,
                    grant_id=grant.id,
                    parameters={"resource": resource(), "scopes": scopes},
                    expires_at=expiry,
                )
            )
        return OAuthToken(
            access_token=access,
            refresh_token=refresh,
            token_type="Bearer",
            expires_in=3600,
            scope=" ".join(scopes),
        )

    async def _exchange(self, raw: str, kind: str, client_id: str, scopes: list[str]) -> OAuthToken:
        async with self.config.get_session() as db, db.begin():
            row = await db.scalar(
                select(MCPToken)
                .where(
                    MCPToken.token_hash == digest(raw),
                    MCPToken.kind == kind,
                )
                .with_for_update()
            )
            if row is None or row.expires_at <= datetime.now(UTC):
                raise TokenError("invalid_grant", "Credential expired or already used")
            grant = await db.get(MCPGrant, row.grant_id, with_for_update=True)
            if row.consumed_at:
                if kind == "refresh" and grant and grant.client_id == client_id:
                    grant.revoked_at = datetime.now(UTC)
                    await db.commit()
                raise TokenError("invalid_grant", "Credential already used")
            if (
                grant is None
                or grant.client_id != client_id
                or grant.revoked_at
                or grant.expires_at <= datetime.now(UTC)
                or not set(scopes) <= set(grant.scopes)
                or not set(scopes) <= set(row.parameters["scopes"])
            ):
                raise TokenError("invalid_grant", "Grant is unavailable")
            active = await db.scalar(
                select(Story.id).where(
                    Story.id == grant.story_id,
                    Story.user_id == grant.user_id,
                    Story.deleted_at.is_(None),
                )
            )
            if active is None:
                raise TokenError("invalid_grant", "Story is unavailable")
            row.consumed_at = datetime.now(UTC)
            return await self._issue(db, grant, scopes)

    async def exchange_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: AuthorizationCode,
    ) -> OAuthToken:
        return await self._exchange(
            authorization_code.code, "code", client.client_id, authorization_code.scopes
        )

    async def load_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: str,
    ) -> RefreshToken | None:
        async with self.config.get_session() as db:
            row = await db.scalar(
                select(MCPToken)
                .join(MCPGrant)
                .where(
                    MCPToken.token_hash == digest(refresh_token),
                    MCPToken.kind == "refresh",
                    MCPGrant.client_id == client.client_id,
                )
            )
            if row is None:
                return None
            grant = await db.get(MCPGrant, row.grant_id)
            if grant is None:
                return None
            if row.consumed_at:
                if grant:
                    grant.revoked_at = datetime.now(UTC)
                    await db.commit()
                return None
            if grant.revoked_at or grant.expires_at <= datetime.now(UTC):
                return None
            return RefreshToken(
                token=refresh_token,
                client_id=client.client_id,
                scopes=row.parameters["scopes"],
                resource=resource(),
                expires_at=int(row.expires_at.timestamp()),
                subject=str(grant.user_id),
            )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        return await self._exchange(refresh_token.token, "refresh", client.client_id, scopes)

    async def load_access_token(self, token: str) -> AccessToken | None:
        async with self.config.get_session() as db:
            delegation = await delegated_access(db, token)
            if delegation is None or not delegation.oauth:
                return None
            row = await db.scalar(select(MCPToken).where(MCPToken.token_hash == digest(token)))
            if row is None:
                return None
            grant = await db.get(MCPGrant, row.grant_id)
            if grant is None:
                return None
            return AccessToken(
                token=token,
                client_id=grant.client_id,
                scopes=delegation.scopes,
                expires_at=int(delegation.expires_at.timestamp()),
                resource=resource(),
                subject=str(delegation.user_id),
                claims={"iss": issuer()},
            )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with self.config.get_session() as db:
            row = await db.scalar(
                select(MCPToken).where(MCPToken.token_hash == digest(token.token))
            )
            if row:
                grant = await db.get(MCPGrant, row.grant_id)
                if grant:
                    grant.revoked_at = datetime.now(UTC)
                    await db.commit()

    async def exchange_identity_assertion(
        self, client: OAuthClientInformationFull, params: Any
    ) -> OAuthToken:
        raise TokenError("unsupported_grant_type", "Identity assertions are not supported")


async def consent_record(db: AsyncSession, raw: str, *, lock: bool = False) -> MCPConsent | None:
    query = select(MCPConsent).where(
        MCPConsent.request_hash == digest(raw),
        MCPConsent.expires_at > datetime.now(UTC),
        MCPConsent.completed_at.is_(None),
    )
    return await db.scalar(query.with_for_update() if lock else query)


async def complete_consent(
    db: AsyncSession,
    raw: str,
    user_id: UUID,
    story_id: UUID | None,
    scopes: list[str],
    deny: bool,
) -> str:
    pending = await consent_record(db, raw, lock=True)
    if pending is None:
        raise ValueError("Connection request expired or already completed")
    params = AuthorizationParams.model_validate(pending.parameters)
    if deny:
        pending.completed_at = datetime.now(UTC)
        return construct_redirect_uri(
            str(params.redirect_uri), error="access_denied", state=params.state, iss=issuer()
        )
    if "story:read" not in scopes or not set(scopes) <= set(params.scopes or []):
        raise ValueError("Invalid consent scopes")
    story = await db.scalar(
        select(Story)
        .where(
            Story.id == story_id,
            Story.user_id == user_id,
            Story.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if story is None:
        raise ValueError("Select one of your active stories")
    grant = MCPGrant(
        client_id=pending.client_id,
        user_id=user_id,
        story_id=story.id,
        scopes=scopes,
        expires_at=datetime.now(UTC) + timedelta(days=30),
    )
    db.add(grant)
    await db.flush()
    code = secrets.token_urlsafe(32)
    data = {
        **params.model_dump(mode="json"),
        "client_id": pending.client_id,
        "scopes": scopes,
        "subject": str(user_id),
    }
    data.pop("state", None)
    db.add(
        MCPToken(
            token_hash=digest(code),
            kind="code",
            grant_id=grant.id,
            parameters=data,
            expires_at=datetime.now(UTC) + timedelta(minutes=2),
        )
    )
    pending.completed_at = datetime.now(UTC)
    return construct_redirect_uri(
        str(params.redirect_uri), code=code, state=params.state, iss=issuer()
    )
