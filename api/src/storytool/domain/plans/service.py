"""An account's effective access: its own tier, its groups' tiers, then its overrides.

Rules, in order:
1. Every feature is on and every limit at its catalogue default.
2. The tiers that apply are the account's own (until it expires) and those of its current
   groups; with none, the default tier if one is marked. A feature is on if any of them leaves
   it on; a limit is the most generous of them (None, unlimited, wins).
3. The account's own overrides win over any tier.

Most requests need no lookup: a short-lived set of the keys any tier or override restricts says
whether a request's features could be locked for anyone at all.
"""

import time
from dataclasses import dataclass, field
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
)

RESTRICTED_TTL = 30.0


@dataclass(frozen=True, slots=True)
class TierData:
    key: str
    name: str
    rank: int
    features: dict[str, Any] = field(default_factory=dict)
    limits: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def of(cls, tier: AccessTier) -> "TierData":
        return cls(tier.key, tier.name, tier.rank, dict(tier.features), dict(tier.limits))


@dataclass(frozen=True, slots=True)
class Access:
    features: dict[str, bool]
    limits: dict[str, int | None]
    tiers: tuple[TierData, ...]
    """The tiers that applied, highest rank first."""

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
    tier_ids: set[UUID] = set()
    if own and own.tier_id and (own.tier_expires_at is None or own.tier_expires_at > now):
        tier_ids.add(own.tier_id)
    group_tiers = await db.scalars(
        select(AccountGroup.tier_id)
        .join(AccountGroupMember, AccountGroupMember.group_id == AccountGroup.id)
        .where(
            AccountGroupMember.user_id == user_id,
            AccountGroup.tier_id.is_not(None),
            or_(AccountGroup.expires_at.is_(None), AccountGroup.expires_at > now),
        )
    )
    tier_ids.update(t for t in group_tiers if t)
    if tier_ids:
        rows = await db.scalars(select(AccessTier).where(AccessTier.id.in_(tier_ids)))
    else:
        rows = await db.scalars(select(AccessTier).where(AccessTier.is_default.is_(True)))
    return combine(
        [TierData.of(row) for row in rows],
        own.features if own else None,
        own.limits if own else None,
    )


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
