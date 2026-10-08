"""Durable MCP OAuth registrations, consent requests, grants and hashed credentials."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase


class MCPClient(StoryToolBase):
    __tablename__ = "mcp_oauth_client"
    client_id: Mapped[str] = mapped_column(String(255), unique=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB)


class MCPConsent(StoryToolBase):
    __tablename__ = "mcp_oauth_consent"
    request_hash: Mapped[str] = mapped_column(String(64), unique=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("mcp_oauth_client.client_id"))
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class MCPGrant(StoryToolBase):
    __tablename__ = "mcp_oauth_grant"
    client_id: Mapped[str] = mapped_column(ForeignKey("mcp_oauth_client.client_id"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    scopes: Mapped[list[str]] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class MCPToken(StoryToolBase):
    __tablename__ = "mcp_oauth_token"
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[str] = mapped_column(String(20))
    grant_id: Mapped[UUID] = mapped_column(
        ForeignKey("mcp_oauth_grant.id", ondelete="CASCADE"), index=True
    )
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
