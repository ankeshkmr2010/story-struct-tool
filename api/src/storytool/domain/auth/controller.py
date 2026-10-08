"""Google ID-token login and revocable, server-side browser sessions."""

import asyncio
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from litestar import Controller, Request, Response, get, post
from litestar.exceptions import NotAuthorizedException, ServiceUnavailableException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.auth.access import SESSION_COOKIE, session_token
from storytool.domain.auth.models import User, UserSession
from storytool.domain.story.models import Story
from storytool.examples.provision import ensure_starter_examples

SESSION_AGE = 30 * 24 * 60 * 60


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=100, max_length=8192)


class AuthConfigOut(BaseModel):
    google_client_id: str | None


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str | None
    picture_url: str | None

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        return cls(id=user.id, email=user.email, name=user.name, picture_url=user.picture_url)


def verify_google_credential(credential: str, client_id: str) -> dict[str, object]:
    """Google's library verifies signature, issuer, audience and expiry."""
    claims = id_token.verify_oauth2_token(credential, GoogleRequest(), client_id)
    if claims.get("email_verified") is not True or not claims.get("sub") or not claims.get("email"):
        raise ValueError("Google did not verify this email address")
    return claims


class AuthController(Controller):
    path = "/api/auth"
    tags = ["auth"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/config", summary="Public Google sign-in configuration")
    async def config(self) -> AuthConfigOut:
        return AuthConfigOut(google_client_id=get_settings().google_client_id)

    @post("/google", summary="Sign in with a Google ID token")
    async def google_login(
        self, db_session: AsyncSession, request: Request, data: GoogleCredential
    ) -> Response[UserOut]:
        settings = get_settings()
        if not settings.google_client_id:
            raise ServiceUnavailableException(detail="Google sign-in is not configured")
        try:
            claims = await asyncio.to_thread(
                verify_google_credential, data.credential, settings.google_client_id
            )
        except (ValueError, GoogleAuthError) as exc:
            raise NotAuthorizedException(detail="Google sign-in failed") from exc

        google_sub = str(claims["sub"])
        email = str(claims["email"]).lower()
        user = (
            await db_session.execute(select(User).where(User.google_sub == google_sub))
        ).scalar_one_or_none()
        if user is None:
            user = User(google_sub=google_sub, email=email)
            db_session.add(user)
        user.email = email
        user.name = str(claims["name"]) if claims.get("name") else None
        user.picture_url = str(claims["picture"]) if claims.get("picture") else None
        await db_session.flush()

        # Claim pre-auth stories only for the explicitly configured, verified Google account.
        if settings.legacy_owner_email and email == settings.legacy_owner_email.lower():
            await db_session.execute(
                update(Story).where(Story.user_id.is_(None)).values(user_id=user.id)
            )

        await ensure_starter_examples(db_session, user.id)

        raw_token = secrets.token_urlsafe(32)
        db_session.add(
            UserSession(
                user_id=user.id,
                token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(seconds=SESSION_AGE),
            )
        )
        await db_session.flush()

        response = Response(UserOut.from_user(user))
        response.set_cookie(
            key=SESSION_COOKIE,
            value=raw_token,
            max_age=SESSION_AGE,
            path="/api",
            secure=request.headers.get("origin", "").startswith("https://"),
            httponly=True,
            samesite="lax",
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    @get("/me", summary="Current signed-in user")
    async def me(self, request: Request, db_session: AsyncSession) -> UserOut:
        user = await db_session.get(User, request.scope["state"]["storytool_user_id"])
        if user is None:
            raise NotAuthorizedException()
        return UserOut.from_user(user)

    @post("/logout", summary="Revoke the current browser session")
    async def logout(self, request: Request, db_session: AsyncSession) -> Response[dict[str, bool]]:
        raw_token = session_token(request.scope)
        if raw_token:
            await db_session.execute(
                delete(UserSession).where(
                    UserSession.token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
                )
            )
        response = Response({"signed_out": True})
        response.delete_cookie(SESSION_COOKIE, path="/api")
        response.headers["Cache-Control"] = "no-store"
        return response
