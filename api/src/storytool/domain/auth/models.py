"""App users are keyed by Google's stable subject, not their mutable email address."""

from datetime import datetime
from uuid import UUID

from advanced_alchemy.types import DateTimeUTC
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase


class User(StoryToolBase):
    __tablename__ = "app_user"

    google_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    name: Mapped[str | None] = mapped_column(String(300), default=None)
    picture_url: Mapped[str | None] = mapped_column(String(1000), default=None)
    examples_seed_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class UserSession(StoryToolBase):
    __tablename__ = "user_session"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTimeUTC(timezone=True), index=True)
