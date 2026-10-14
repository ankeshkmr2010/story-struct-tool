"""Private derived answers and daily shared-reader reservations; never story versions."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase


class DecisionCache(StoryToolBase):
    __tablename__ = "decision_cache"
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    answer: Mapped[dict] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    actor_key: Mapped[str | None] = mapped_column(String(64), default=None)
    provider: Mapped[str | None] = mapped_column(String(200), default=None)


class DecisionFeedback(StoryToolBase):
    __tablename__ = "decision_feedback"
    __table_args__ = (
        UniqueConstraint("actor_key", "unit", "check_code", name="one_decision_label"),
    )
    actor_key: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    unit: Mapped[str] = mapped_column(String(64))
    check_code: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(String(200))
    model: Mapped[str] = mapped_column(String(100))
    rubric_version: Mapped[str] = mapped_column(String(40))
    probability: Mapped[float] = mapped_column(Float)
    accepted: Mapped[bool] = mapped_column(Boolean)


class DecisionBudget(StoryToolBase):
    __tablename__ = "decision_budget"
    __table_args__ = (UniqueConstraint("actor", "day", name="one_decision_budget_per_day"),)
    actor: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[date] = mapped_column(Date)
    minute: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    minute_calls: Mapped[int] = mapped_column(Integer, default=0)
    calls: Mapped[int] = mapped_column(Integer, default=0)
    reserved_tokens: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)


class DecisionValidator(StoryToolBase):
    """An owner's private check; no executable code or access to other users' data."""
    __tablename__ = "decision_validator"
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    definition: Mapped[dict] = mapped_column(JSONB)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    definition_hash: Mapped[str] = mapped_column(String(64))
