"""An account's effective access: its own tier, its groups' tiers, then its overrides.

Rules, in order:
1. Every feature is on and every limit at its catalogue default.
2. The tiers that apply are the account's own (until it expires), those of its current
   groups and of its active self-serve subscriptions; with none, the default tier if one is
   marked. A feature is on if any of them leaves it on; a limit is the most generous of
   them (None, unlimited, wins).
3. The account's own overrides win over any tier.

Most requests need no lookup: a short-lived set of the keys any tier or override restricts says
whether a request's features could be locked for anyone at all.
"""

import time
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.plans.catalogue import features, limits
from storytool.domain.plans.models import (
    AccessTier,
    AccountAccess,
    AccountGroup,
    AccountGroupMember,
    Subscription,
)

RESTRICTED_TTL = 30.0


@dataclass(frozen=True, slots=True)
class TierData:
    key: str
    name: str
    rank: int
    features: dict[str, Any] = field(default_factory=dict)
    limits: dict[str, Any] = field(default_factory=dict)
    id: UUID | None = None

    @classmethod
    def of(cls, tier: AccessTier) -> "TierData":
        return cls(tier.key, tier.name, tier.rank, dict(tier.features), dict(tier.limits), tier.id)


@dataclass(frozen=True, slots=True)
class Held:
    """One reason a tier applies: the account's own, a group's, a subscription or the default."""

    tier_id: UUID
    source: str
    """account, group, subscription or default."""
    ends_at: datetime | None = None
    group: str | None = None


@dataclass(frozen=True, slots=True)
class Access:
    features: dict[str, bool]
    limits: dict[str, int | None]
    tiers: tuple[TierData, ...]
    """The tiers that applied, highest rank first."""
    held: tuple[Held, ...] = ()
    overridden: frozenset[str] = frozenset()
    """Features the account's own overrides switch off, whatever its tiers include."""

    def allows(self, key: str) -> bool:
        return self.features.get(key, True)


def combine(
    tiers: list[TierData],
    feature_overrides: dict[str, Any] | None = None,
    limit_overrides: dict[str, Any] | None = None,
) -> Access:
    """Pure: the effective access from the tiers that apply and the account's overrides."""
    on: dict[str, bool] = {}
    for feature in features():
        on[feature.key] = (
            any(bool(t.features.get(feature.key, True)) for t in tiers) if tiers else True
        )
    caps: dict[str, int | None] = {}
    for limit in limits():
        values = [t.limits.get(limit.key, limit.default) for t in tiers] or [limit.default]
        caps[limit.key] = (
            None if any(v is None for v in values) else max(int(v) for v in values if v is not None)
        )
    for key, value in (feature_overrides or {}).items():
        if key in on:
            on[key] = bool(value)
    for key, value in (limit_overrides or {}).items():
        if key in caps:
            caps[key] = None if value is None else int(value)
    return Access(on, caps, tuple(sorted(tiers, key=lambda t: -t.rank)))


async def resolve(db: AsyncSession, user_id: UUID) -> Access:
    now = datetime.now(UTC)
    own = await db.scalar(select(AccountAccess).where(AccountAccess.user_id == user_id))
    held: list[Held] = []
    if own and own.tier_id and (own.tier_expires_at is None or own.tier_expires_at > now):
        held.append(Held(own.tier_id, "account", own.tier_expires_at))
    groups = await db.execute(
        select(AccountGroup.tier_id, AccountGroup.expires_at, AccountGroup.name)
        .join(AccountGroupMember, AccountGroupMember.group_id == AccountGroup.id)
        .where(
            AccountGroupMember.user_id == user_id,
            AccountGroup.tier_id.is_not(None),
            or_(AccountGroup.expires_at.is_(None), AccountGroup.expires_at > now),
        )
    )
    held += [Held(g.tier_id, "group", g.expires_at, g.name) for g in groups if g.tier_id]
    subscriptions = await db.execute(
        select(Subscription.tier_id, Subscription.ends_at).where(
            Subscription.user_id == user_id,
            Subscription.tier_id.is_not(None),
            Subscription.status == "active",
            Subscription.starts_at <= now,
            Subscription.ends_at > now,
        )
    )
    held += [Held(s.tier_id, "subscription", s.ends_at) for s in subscriptions if s.tier_id]
    if held:
        rows = list(
            await db.scalars(select(AccessTier).where(AccessTier.id.in_({h.tier_id for h in held})))
        )
    else:
        rows = list(await db.scalars(select(AccessTier).where(AccessTier.is_default.is_(True))))
        held = [Held(row.id, "default") for row in rows]
    access = combine(
        [TierData.of(row) for row in rows],
        own.features if own else None,
        own.limits if own else None,
    )
    off = frozenset(k for k, v in ((own.features if own else None) or {}).items() if v is False)
    return replace(access, held=tuple(held), overridden=off)


_restricted: tuple[float, frozenset[str]] = (0.0, frozenset())


def invalidate() -> None:
    """Call after any change to tiers, groups or account access."""
    global _restricted
    _restricted = (0.0, frozenset())


async def restricted_keys(db: AsyncSession) -> frozenset[str]:
    """Feature keys some tier or override switches off, and limit keys some tier or override
    sets. A request needing none of these is allowed without resolving the account."""
    global _restricted
    stamp, keys = _restricted
    if time.monotonic() - stamp < RESTRICTED_TTL:
        return keys
    found: set[str] = set()
    for row in (await db.execute(select(AccessTier.features, AccessTier.limits))).all():
        found |= _set_keys(row.features, row.limits)
    for row in (await db.execute(select(AccountAccess.features, AccountAccess.limits))).all():
        found |= _set_keys(row.features, row.limits)
    _restricted = (time.monotonic(), frozenset(found))
    return _restricted[1]


def _set_keys(feature_map: dict[str, Any] | None, limit_map: dict[str, Any] | None) -> set[str]:
    defaults = {limit.key: limit.default for limit in limits()}
    off = {key for key, value in (feature_map or {}).items() if value is False}
    capped = {
        key
        for key, value in (limit_map or {}).items()
        if key in defaults and value != defaults[key]
    }
    return off | capped


def granting_tiers(all_tiers: list[TierData], key: str) -> list[str]:
    """Names of the tiers that include a feature, cheapest first, for an upgrade message."""
    return [t.name for t in sorted(all_tiers, key=lambda t: t.rank) if t.features.get(key, True)]
