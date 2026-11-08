"""`/api/me/access` for the app, and the admin API for tiers, groups and accounts.

Admin endpoints need an account in STORYTOOL_ADMIN_EMAILS. Every change is recorded in
`access_change` and clears the enforcement cache.
"""

import json
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post, put
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.models import User
from storytool.domain.plans.catalogue import feature_keys, features, limit_keys, limits
from storytool.domain.plans.models import (
    AccessChange,
    AccessTier,
    AccountAccess,
    AccountGroup,
    AccountGroupMember,
)
from storytool.domain.plans.service import invalidate, resolve
from storytool.domain.site.shoutouts import require_admin

FeatureMap = dict[str, bool]
LimitMap = dict[str, int | None]


class AccessCatalogueItem(BaseModel):
    key: str
    name: str
    description: str
    kind: str
    """feature or limit."""
    default: int | None = None


class AccessTierRef(BaseModel):
    key: str
    name: str


class AccessOut(BaseModel):
    features: FeatureMap
    limits: LimitMap
    tiers: list[AccessTierRef]


class AccessTierIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    rank: int = 0
    is_default: bool = False
    features: FeatureMap = Field(default_factory=dict)
    limits: LimitMap = Field(default_factory=dict)
    self_serve: bool = False
    price_note: str | None = Field(default=None, max_length=120)
    durations: list[Annotated[int, Field(ge=1, le=120)]] = Field(
        default_factory=lambda: [1, 3, 6, 12], max_length=12
    )


class AccessTierPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    rank: int | None = None
    is_default: bool | None = None
    features: FeatureMap | None = None
    limits: LimitMap | None = None
    self_serve: bool | None = None
    price_note: str | None = Field(default=None, max_length=120)
    durations: list[Annotated[int, Field(ge=1, le=120)]] | None = Field(
        default=None, max_length=12
    )


class AccessTierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    key: str
    name: str
    description: str | None
    rank: int
    is_default: bool
    features: FeatureMap
    limits: LimitMap
    self_serve: bool
    price_note: str | None
    durations: list[int]


class AccessGroupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    tier_id: UUID | None = None
    seats: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class AccessGroupPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    tier_id: UUID | None = None
    seats: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class AccessMemberOut(BaseModel):
    user_id: UUID
    email: str
    role: str


class AccessGroupOut(BaseModel):
    id: UUID
    name: str
    tier_id: UUID | None
    seats: int | None
    expires_at: datetime | None
    note: str | None
    members: list[AccessMemberOut]


class AccessMemberIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)
    role: str = Field(default="member", pattern=r"^(member|manager)$")


class AccessAccountIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tier_id: UUID | None = None
    tier_expires_at: datetime | None = None
    features: FeatureMap = Field(default_factory=dict)
    limits: LimitMap = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=500)


class AccessAccountOut(BaseModel):
    user_id: UUID
    email: str
    name: str | None
    tier_id: UUID | None
    tier_expires_at: datetime | None
    features: FeatureMap
    limits: LimitMap
    note: str | None
    groups: list[str]
    effective: AccessOut


class AccessChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    created_at: datetime
    actor_id: UUID | None
    subject: str
    subject_id: UUID | None
    change: dict[str, Any]


def _access_out(access: Any) -> AccessOut:
    return AccessOut(
        features=access.features,
        limits=access.limits,
        tiers=[AccessTierRef(key=t.key, name=t.name) for t in access.tiers],
    )


def _check_maps(feature_map: FeatureMap | None, limit_map: LimitMap | None) -> None:
    unknown = set(feature_map or {}) - feature_keys() | set(limit_map or {}) - limit_keys()
    if unknown:
        raise ClientException(detail="Unknown feature or limit: " + ", ".join(sorted(unknown)))
    if any(v is not None and v < 0 for v in (limit_map or {}).values()):
        raise ClientException(detail="Limits cannot be negative")


def _user(request: Request) -> UUID:
    return request.scope["state"]["storytool_user_id"]


async def _record(
    db: AsyncSession, request: Request, subject: str, subject_id: UUID | None, change: Any
) -> None:
    db.add(
        AccessChange(
            actor_id=_user(request),
            subject=subject,
            subject_id=subject_id,
            change=json.loads(json.dumps(change, default=str)),
        )
    )
    invalidate()


class MyAccessController(Controller):
    path = "/api/me/access"
    tags = ["access"]
    signature_namespace = {"AsyncSession": AsyncSession, "Request": Request}

    @get(summary="The features and limits the signed-in account has")
    async def my_access(self, request: Request, db_session: AsyncSession) -> AccessOut:
        return _access_out(await resolve(db_session, _user(request)))


class AdminAccessController(Controller):
    path = "/api/admin/access"
    tags = ["access"]
    signature_namespace = {"AsyncSession": AsyncSession, "Request": Request}

    @get("/catalogue", summary="Every feature and limit a tier can set")
    async def catalogue(
        self, request: Request, db_session: AsyncSession
    ) -> list[AccessCatalogueItem]:
        await require_admin(request, db_session)
        return [
            AccessCatalogueItem(key=f.key, name=f.name, description=f.description, kind="feature")
            for f in features()
        ] + [
            AccessCatalogueItem(
                key=lm.key,
                name=lm.name,
                description=lm.description,
                kind="limit",
                default=lm.default,
            )
            for lm in limits()
        ]

    # ------------------------------------------------------------------ tiers
    @get("/tiers", summary="All tiers, cheapest first")
    async def list_tiers(self, request: Request, db_session: AsyncSession) -> list[AccessTierOut]:
        await require_admin(request, db_session)
        rows = await db_session.scalars(select(AccessTier).order_by(AccessTier.rank))
        return [AccessTierOut.model_validate(row) for row in rows]

    @post("/tiers", summary="Add a tier")
    async def create_tier(
        self, request: Request, db_session: AsyncSession, data: AccessTierIn
    ) -> AccessTierOut:
        await require_admin(request, db_session)
        _check_maps(data.features, data.limits)
        if await db_session.scalar(select(AccessTier).where(AccessTier.key == data.key)):
            raise ClientException(detail=f"A tier with key {data.key!r} already exists")
        if data.is_default:
            await self._clear_default(db_session)
        data.durations = sorted(set(data.durations or [1, 3, 6, 12]))
        tier = AccessTier(**data.model_dump())
        db_session.add(tier)
        await db_session.flush()
        await _record(db_session, request, "tier", tier.id, {"created": data.model_dump()})
        return AccessTierOut.model_validate(tier)

    @patch("/tiers/{tier_id:uuid}", summary="Change a tier (features and limits replace)")
    async def update_tier(
        self, request: Request, db_session: AsyncSession, tier_id: UUID, data: AccessTierPatch
    ) -> AccessTierOut:
        await require_admin(request, db_session)
        tier = await db_session.get(AccessTier, tier_id)
        if tier is None:
            raise NotFoundException(detail="No such tier")
        _check_maps(data.features, data.limits)
        values = data.model_dump(exclude_unset=True)
        if values.get("is_default"):
            await self._clear_default(db_session)
        for name, value in values.items():
            if name in {"features", "limits"} and value is None:
                value = {}
            if name == "durations":
                value = sorted(set(value or [1, 3, 6, 12]))
            setattr(tier, name, value)
        await _record(db_session, request, "tier", tier.id, {"changed": values})
        return AccessTierOut.model_validate(tier)

    @delete("/tiers/{tier_id:uuid}", summary="Delete a tier; its accounts fall back")
    async def delete_tier(self, request: Request, db_session: AsyncSession, tier_id: UUID) -> None:
        await require_admin(request, db_session)
        tier = await db_session.get(AccessTier, tier_id)
        if tier is None:
            raise NotFoundException(detail="No such tier")
        await _record(db_session, request, "tier", tier.id, {"deleted": tier.key})
        await db_session.delete(tier)

    async def _clear_default(self, db: AsyncSession) -> None:
        for tier in await db.scalars(select(AccessTier).where(AccessTier.is_default.is_(True))):
            tier.is_default = False

    # ----------------------------------------------------------------- groups
    async def _group_out(self, db: AsyncSession, group: AccountGroup) -> AccessGroupOut:
        rows = await db.execute(
            select(AccountGroupMember.user_id, User.email, AccountGroupMember.role)
            .join(User, User.id == AccountGroupMember.user_id)
            .where(AccountGroupMember.group_id == group.id)
            .order_by(User.email)
        )
        return AccessGroupOut(
            id=group.id,
            name=group.name,
            tier_id=group.tier_id,
            seats=group.seats,
            expires_at=group.expires_at,
            note=group.note,
            members=[AccessMemberOut(user_id=r.user_id, email=r.email, role=r.role) for r in rows],
        )

    async def _group(self, db: AsyncSession, group_id: UUID) -> AccountGroup:
        group = await db.get(AccountGroup, group_id)
        if group is None:
            raise NotFoundException(detail="No such group")
        return group

    async def _tier_exists(self, db: AsyncSession, tier_id: UUID | None) -> None:
        if tier_id is not None and await db.get(AccessTier, tier_id) is None:
            raise NotFoundException(detail="No such tier")

    @get("/groups", summary="All account groups with their members")
    async def list_groups(self, request: Request, db_session: AsyncSession) -> list[AccessGroupOut]:
        await require_admin(request, db_session)
        groups = await db_session.scalars(select(AccountGroup).order_by(AccountGroup.name))
        return [await self._group_out(db_session, g) for g in groups]

    @post("/groups", summary="Add an account group")
    async def create_group(
        self, request: Request, db_session: AsyncSession, data: AccessGroupIn
    ) -> AccessGroupOut:
        await require_admin(request, db_session)
        await self._tier_exists(db_session, data.tier_id)
        group = AccountGroup(**data.model_dump())
        db_session.add(group)
        await db_session.flush()
        await _record(
            db_session, request, "group", group.id, {"created": data.model_dump(mode="json")}
        )
        return await self._group_out(db_session, group)

    @patch("/groups/{group_id:uuid}", summary="Change a group's name, tier, seats or end date")
    async def update_group(
        self, request: Request, db_session: AsyncSession, group_id: UUID, data: AccessGroupPatch
    ) -> AccessGroupOut:
        await require_admin(request, db_session)
        group = await self._group(db_session, group_id)
        values = data.model_dump(exclude_unset=True)
        await self._tier_exists(db_session, values.get("tier_id"))
        for name, value in values.items():
            setattr(group, name, value)
        await _record(
            db_session,
            request,
            "group",
            group.id,
            {"changed": data.model_dump(mode="json", exclude_unset=True)},
        )
        return await self._group_out(db_session, group)

    @delete("/groups/{group_id:uuid}", summary="Delete a group; its members keep their own access")
    async def delete_group(
        self, request: Request, db_session: AsyncSession, group_id: UUID
    ) -> None:
        await require_admin(request, db_session)
        group = await self._group(db_session, group_id)
        await _record(db_session, request, "group", group.id, {"deleted": group.name})
        await db_session.delete(group)

    @post("/groups/{group_id:uuid}/members", summary="Add an existing account by email")
    async def add_member(
        self, request: Request, db_session: AsyncSession, group_id: UUID, data: AccessMemberIn
    ) -> AccessGroupOut:
        await require_admin(request, db_session)
        group = await self._group(db_session, group_id)
        user = await db_session.scalar(
            select(User).where(func.lower(User.email) == data.email.strip().lower())
        )
        if user is None:
            raise NotFoundException(detail="No account with that email has signed in yet")
        existing = await db_session.scalar(
            select(AccountGroupMember).where(
                AccountGroupMember.group_id == group.id, AccountGroupMember.user_id == user.id
            )
        )
        if existing is None:
            count = await db_session.scalar(
                select(func.count(AccountGroupMember.id)).where(
                    AccountGroupMember.group_id == group.id
                )
            )
            if group.seats is not None and (count or 0) >= group.seats:
                raise ClientException(detail=f"All {group.seats} seats in this group are taken")
            db_session.add(AccountGroupMember(group_id=group.id, user_id=user.id, role=data.role))
        else:
            existing.role = data.role
        await db_session.flush()
        await _record(
            db_session,
            request,
            "member",
            group.id,
            {"added": str(user.id), "email": user.email, "role": data.role},
        )
        return await self._group_out(db_session, group)

    @delete("/groups/{group_id:uuid}/members/{user_id:uuid}", summary="Remove a member")
    async def remove_member(
        self, request: Request, db_session: AsyncSession, group_id: UUID, user_id: UUID
    ) -> None:
        await require_admin(request, db_session)
        member = await db_session.scalar(
            select(AccountGroupMember).where(
                AccountGroupMember.group_id == group_id, AccountGroupMember.user_id == user_id
            )
        )
        if member is None:
            raise NotFoundException(detail="That account is not in this group")
        await _record(db_session, request, "member", group_id, {"removed": str(user_id)})
        await db_session.delete(member)

    # --------------------------------------------------------------- accounts
    async def _account_out(self, db: AsyncSession, user: User) -> AccessAccountOut:
        own = await db.scalar(select(AccountAccess).where(AccountAccess.user_id == user.id))
        groups = await db.scalars(
            select(AccountGroup.name)
            .join(AccountGroupMember, AccountGroupMember.group_id == AccountGroup.id)
            .where(AccountGroupMember.user_id == user.id)
            .order_by(AccountGroup.name)
        )
        return AccessAccountOut(
            user_id=user.id,
            email=user.email,
            name=user.name,
            tier_id=own.tier_id if own else None,
            tier_expires_at=own.tier_expires_at if own else None,
            features=dict(own.features) if own else {},
            limits=dict(own.limits) if own else {},
            note=own.note if own else None,
            groups=list(groups),
            effective=_access_out(await resolve(db, user.id)),
        )

    @get("/accounts", summary="Find accounts by email, with their access")
    async def find_accounts(
        self, request: Request, db_session: AsyncSession, email: str = ""
    ) -> list[AccessAccountOut]:
        await require_admin(request, db_session)
        query = select(User).order_by(User.email).limit(20)
        if email.strip():
            query = query.where(User.email.ilike(f"%{email.strip()}%"))
        return [await self._account_out(db_session, u) for u in await db_session.scalars(query)]

    @put("/accounts/{user_id:uuid}", summary="Set an account's tier, end date and overrides")
    async def set_account(
        self, request: Request, db_session: AsyncSession, user_id: UUID, data: AccessAccountIn
    ) -> AccessAccountOut:
        await require_admin(request, db_session)
        user = await db_session.get(User, user_id)
        if user is None:
            raise NotFoundException(detail="No such account")
        _check_maps(data.features, data.limits)
        await self._tier_exists(db_session, data.tier_id)
        own = await db_session.scalar(select(AccountAccess).where(AccountAccess.user_id == user_id))
        if own is None:
            own = AccountAccess(user_id=user_id)
            db_session.add(own)
        for name, value in data.model_dump().items():
            setattr(own, name, value)
        await db_session.flush()
        await _record(db_session, request, "account", user_id, data.model_dump(mode="json"))
        return await self._account_out(db_session, user)

    @get("/history", summary="Recent changes to tiers, groups and accounts")
    async def history(
        self, request: Request, db_session: AsyncSession, limit: int = 100
    ) -> list[AccessChangeOut]:
        await require_admin(request, db_session)
        rows = await db_session.scalars(
            select(AccessChange).order_by(AccessChange.created_at.desc()).limit(min(limit, 500))
        )
        return [AccessChangeOut.model_validate(row) for row in rows]
