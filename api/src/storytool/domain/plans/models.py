"""Tiers, account groups, per-account access and the change history (domain/plans)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from advanced_alchemy.types import GUID, DateTimeUTC
from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase


class AccessTier(StoryToolBase):
    """A named set of features and limits. `features` and `limits` list only what the tier
    sets: a feature it does not mention stays available, a limit it does not mention keeps the
    catalogue default. `is_default` applies to accounts with no tier of their own or a group's."""

    __tablename__ = "access_tier"

    key: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(500), default=None)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    features: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    limits: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    self_serve: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    """Listed on the Plans page and open to self-serve upgrades."""
    price_note: Mapped[str | None] = mapped_column(String(120), default=None)
    """Shown beside the tier while upgrades are on, e.g. "€5 a month"."""
    durations: Mapped[list[int]] = mapped_column(
        JSONB, default=lambda: [1, 3, 6, 12], server_default="[1, 3, 6, 12]"
    )
    """Months a self-serve upgrade can last."""


class Subscription(StoryToolBase):
    """A self-serve upgrade: one tier for a period, apart from any tier an admin set.
    Active while `status` is active and now is before `ends_at`. `provider` records who
    approved it (stub until a payment vendor exists), so stub grants can be found later."""

    __tablename__ = "subscription"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    tier_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("access_tier.id", ondelete="SET NULL"), default=None, index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTimeUTC(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTimeUTC(timezone=True))
    provider: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str | None] = mapped_column(String(200), default=None)
    status: Mapped[str] = mapped_column(String(10), default="active")
    """active or ended."""


class Checkout(StoryToolBase):
    """One upgrade attempt. Holds what was offered (tier and months) so a later tier edit
    cannot change it; confirmed once, from pending to paid, before `expires_at`."""

    __tablename__ = "checkout"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    tier_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("access_tier.id", ondelete="SET NULL"), default=None
    )
    tier_key: Mapped[str] = mapped_column(String(40))
    tier_name: Mapped[str] = mapped_column(String(80))
    months: Mapped[int] = mapped_column(Integer)
    provider: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str | None] = mapped_column(String(200), default=None)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    """pending or paid."""
    expires_at: Mapped[datetime] = mapped_column(DateTimeUTC(timezone=True))
    subscription_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("subscription.id", ondelete="SET NULL"), default=None
    )


class AccountGroup(StoryToolBase):
    """Accounts sharing a plan (a class, a publisher, a team). Members get the group's tier
    while it lasts; `seats` caps the members when set."""

    __tablename__ = "account_group"

    name: Mapped[str] = mapped_column(String(120))
    tier_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("access_tier.id", ondelete="SET NULL"), default=None, index=True
    )
    seats: Mapped[int | None] = mapped_column(Integer, default=None)
    expires_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(timezone=True), default=None)
    note: Mapped[str | None] = mapped_column(String(500), default=None)


class AccountGroupMember(StoryToolBase):
    __tablename__ = "account_group_member"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="one_membership"),)

    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("account_group.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10), default="member")
    """member or manager (a manager will run the group's seats; for now admins do)."""


class AccountAccess(StoryToolBase):
    """One account's own tier (optionally until a date) and overrides that win over any tier."""

    __tablename__ = "account_access"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), unique=True
    )
    tier_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("access_tier.id", ondelete="SET NULL"), default=None, index=True
    )
    tier_expires_at: Mapped[datetime | None] = mapped_column(
        DateTimeUTC(timezone=True), default=None
    )
    features: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    limits: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    note: Mapped[str | None] = mapped_column(String(500), default=None)


class AccessChange(StoryToolBase):
    """Who changed which tier, group or account, and how (append-only)."""

    __tablename__ = "access_change"

    actor_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), default=None, index=True
    )
    subject: Mapped[str] = mapped_column(String(20))
    """tier, group, member or account."""
    subject_id: Mapped[UUID | None] = mapped_column(GUID(length=16), default=None, index=True)
    change: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
