from datetime import datetime
from typing import Any
from uuid import UUID

from advanced_alchemy.types import DateTimeUTC
from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase


class AIConnection(StoryToolBase):
    __tablename__ = "ai_connection"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(200))
    encrypted_key: Mapped[str] = mapped_column(Text)
    key_suffix: Mapped[str] = mapped_column(String(4))
    __table_args__ = (UniqueConstraint("user_id", "provider", name="one_provider_per_user"),)


class AIRun(StoryToolBase):
    __tablename__ = "ai_run"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(200))
    prompt: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="proposed")
    base_fingerprint: Mapped[str] = mapped_column(String(64))
    applied_fingerprint: Mapped[str | None] = mapped_column(String(64), default=None)
    proposal: Mapped[dict[str, Any]] = mapped_column(JSONB)
    inverse: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    usage: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)


class StoryObservation(StoryToolBase):
    __tablename__ = "story_observation"
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    scene_id: Mapped[UUID] = mapped_column(ForeignKey("scene.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20))
    source_revision: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    __table_args__ = (UniqueConstraint("scene_id", "source", name="one_observation_per_reader"),)


class AgentToken(StoryToolBase):
    __tablename__ = "story_agent_token"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    label: Mapped[str] = mapped_column(String(100), default="Story agent")
    expires_at: Mapped[datetime] = mapped_column(DateTimeUTC(timezone=True))
