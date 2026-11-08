"""Your plan, the Plans page and self-serve upgrades (domain/plans).

An upgrade is a checkout (what was offered, fixed when created) confirmed once into a
subscription, which `resolve()` adds to the tiers that apply. Admin-set tiers are never
touched. Payment goes through a PaymentProvider. Today the only provider is the stub,
switched on by STORYTOOL_SELF_UPGRADE=stub, which approves every upgrade. A real vendor will
confirm through its own verified webhook, never through the browser confirm route below.
"""

import calendar
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol
from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException, NotFoundException, PermissionDeniedException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.plans.catalogue import features, limits
from storytool.domain.plans.controller import _record
from storytool.domain.plans.models import AccessTier, Checkout, Subscription
from storytool.domain.plans.service import Access, TierData, combine, resolve, restricted_keys

CHECKOUT_MINUTES = 30
Source = Literal["account", "group", "subscription", "default"]


def add_months(moment: datetime, months: int) -> datetime:
    """Calendar months, kept within the month: 31 January + 1 month is 28 or 29 February."""
    years, index = divmod(moment.month - 1 + months, 12)
    year, month = moment.year + years, index + 1
    return moment.replace(
        year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1])
    )


# ------------------------------------------------------------------ payment seam
class PaymentProvider(Protocol):
    name: str

    async def start(self, checkout: Checkout) -> str | None:
        """Begin payment. Returns the vendor page to send the author to, or None when the
        provider settles at once (the stub)."""
        ...


class StubProvider:
    """Approves every upgrade without payment. For use until a vendor is connected."""

    name = "stub"

    async def start(self, checkout: Checkout) -> str | None:
        return None


def payment_provider() -> PaymentProvider | None:
    return StubProvider() if get_settings().self_upgrade == "stub" else None


# ------------------------------------------------------------------ schemas
class PlanItem(BaseModel):
    key: str
    name: str


class PlanLimit(BaseModel):
    key: str
    name: str
    value: int | None
    """None means unlimited."""


class PlanTier(BaseModel):
    id: UUID
    key: str
    name: str
    description: str | None
    rank: int
    price_note: str | None
    durations: list[int]
    includes: list[PlanItem]
    """Features this tier leaves on."""
    limits: list[PlanLimit]


class PlanHeld(BaseModel):
    key: str
    name: str
    source: Source
    ends_at: datetime | None
    group: str | None = None


class MyPlanTier(PlanTier):
    have: Source | None
    """How you already have this tier, if you do."""
    adds: list[PlanItem]
    """Features you would gain."""
    raises: list[PlanLimit]
    """Limits that would rise for you."""
    loses: list[PlanItem]
    """Features you have now that this plan would not keep (your default plan stops applying)."""
    blocked: list[PlanItem]
    """Features in this tier your account's own settings keep off."""
    can_buy: bool


class PlansOut(BaseModel):
    upgrades: Literal["off", "stub"]
    tiers: list[PlanTier]


class MyPlanOut(BaseModel):
    upgrades: Literal["off", "stub"]
    everything_included: bool
    held: list[PlanHeld]
    tiers: list[MyPlanTier]


class UpgradeIn(BaseModel):
    tier_id: UUID
    months: int = Field(ge=1, le=120)


class CheckoutOut(BaseModel):
    id: UUID
    tier_key: str
    tier_name: str
    months: int
    status: str
    expires_at: datetime
    ends_at: datetime
    """When the plan would end (pending) or ends (paid)."""
    redirect_url: str | None = None


# ------------------------------------------------------------------ logic
def _tier_out(tier: AccessTier, upgrades: str) -> PlanTier:
    return PlanTier(
        id=tier.id,
        key=tier.key,
        name=tier.name,
        description=tier.description,
        rank=tier.rank,
        price_note=tier.price_note if upgrades != "off" else None,
        durations=sorted(tier.durations or []),
        includes=[
            PlanItem(key=f.key, name=f.name)
            for f in features()
            if bool((tier.features or {}).get(f.key, True))
        ],
        limits=[
            PlanLimit(key=lm.key, name=lm.name, value=(tier.limits or {}).get(lm.key, lm.default))
            for lm in limits()
        ],
    )


async def _self_serve(db: AsyncSession) -> list[AccessTier]:
    return list(
        await db.scalars(
            select(AccessTier)
            .where(AccessTier.self_serve.is_(True))
            .order_by(AccessTier.rank, AccessTier.name)
        )
    )


def have_through(access: Access, tier_id: UUID) -> Source | None:
    """How the account already has this tier; account and group beat subscription."""
    sources = [h.source for h in access.held if h.tier_id == tier_id]
    for source in ("account", "group", "subscription", "default"):
        if source in sources:
            return source  # type: ignore[return-value]
    return None


def can_buy(access: Access, tier_id: UUID) -> bool:
    """Not when an admin-set tier or a group already gives it; a subscription can be extended."""
    return have_through(access, tier_id) not in {"account", "group"}


def gains(
    access: Access, tier: AccessTier
) -> tuple[list[PlanItem], list[PlanLimit], list[PlanItem]]:
    """What adding this tier would change for this account: features gained, limits raised
    and features lost. The default tier stops applying once any other tier does."""
    defaults = {h.tier_id for h in access.held if h.source == "default"}
    kept = [t for t in access.tiers if t.id not in defaults and t.id != tier.id]
    after = combine([*kept, TierData.of(tier)])
    after_features = {k: v and k not in access.overridden for k, v in after.features.items()}
    names = {f.key: f.name for f in features()}
    adds = [
        PlanItem(key=k, name=names[k])
        for k, on in after_features.items()
        if on and not access.features.get(k, True)
    ]
    loses = [
        PlanItem(key=k, name=names[k])
        for k, on in after_features.items()
        if not on and access.features.get(k, True)
    ]
    raises = []
    for lm in limits():
        if lm.key in access.overridden:
            continue
        now_cap, new_cap = access.limits.get(lm.key), after.limits.get(lm.key)
        if now_cap is not None and (new_cap is None or new_cap > now_cap):
            raises.append(PlanLimit(key=lm.key, name=lm.name, value=new_cap))
    return adds, raises, loses


async def _plan_ends(
    db: AsyncSession, user_id: UUID, tier_id: UUID | None, months: int, now: datetime
) -> datetime:
    """A repeat upgrade to the same tier extends from its current end; otherwise from now."""
    current = await db.scalar(
        select(Subscription.ends_at)
        .where(
            Subscription.user_id == user_id,
            Subscription.tier_id == tier_id,
            Subscription.status == "active",
            Subscription.ends_at > now,
        )
        .order_by(Subscription.ends_at.desc())
        .limit(1)
    )
    return add_months(current or now, months)


def _signed_in_person(request: Request) -> UUID:
    """Upgrades are the author's own act in the browser: never an AI connection or agent."""
    state = request.scope.get("state", {})
    if state.get("storytool_write_origin") == "mcp":
        raise PermissionDeniedException(detail="Plans can only be changed by you, in the app")
    return state["storytool_user_id"]


def _checkout_out(checkout: Checkout, ends_at: datetime, url: str | None = None) -> CheckoutOut:
    return CheckoutOut(
        id=checkout.id,
        tier_key=checkout.tier_key,
        tier_name=checkout.tier_name,
        months=checkout.months,
        status=checkout.status,
        expires_at=checkout.expires_at,
        ends_at=ends_at,
        redirect_url=url,
    )


# ------------------------------------------------------------------ routes
class PlansController(Controller):
    """Public: the self-serve tiers, for the Plans page when signed out."""

    path = "/api/plans"
    tags = ["access"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get(summary="Plans open to self-serve upgrades, cheapest first")
    async def plans(self, db_session: AsyncSession) -> PlansOut:
        upgrades = get_settings().self_upgrade
        return PlansOut(
            upgrades=upgrades, tiers=[_tier_out(t, upgrades) for t in await _self_serve(db_session)]
        )


class MyPlanController(Controller):
    path = "/api/me"
    tags = ["access"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession, "Request": Request}  # noqa: RUF012

    @get("/plan", summary="Your plan: the tiers you have and what each plan would add")
    async def my_plan(self, request: Request, db_session: AsyncSession) -> MyPlanOut:
        user_id = _signed_in_person(request)
        upgrades = get_settings().self_upgrade
        access = await resolve(db_session, user_id)
        tier_ids = {h.tier_id for h in access.held}
        names = {
            t.id: t
            for t in await db_session.scalars(select(AccessTier).where(AccessTier.id.in_(tier_ids)))
        }
        held = [
            PlanHeld(
                key=names[h.tier_id].key,
                name=names[h.tier_id].name,
                source=h.source,  # type: ignore[arg-type]
                ends_at=h.ends_at,
                group=h.group,
            )
            for h in access.held
            if h.tier_id in names
        ]
        tiers = []
        for tier in await _self_serve(db_session):
            adds, raises, loses = gains(access, tier)
            base = _tier_out(tier, upgrades)
            tiers.append(
                MyPlanTier(
                    **base.model_dump(),
                    have=have_through(access, tier.id),
                    adds=adds,
                    raises=raises,
                    loses=loses,
                    blocked=[i for i in base.includes if i.key in access.overridden],
                    can_buy=upgrades != "off" and can_buy(access, tier.id),
                )
            )
        return MyPlanOut(
            upgrades=upgrades,
            everything_included=not await restricted_keys(db_session),
            held=held,
            tiers=tiers,
        )

    @post("/upgrade", summary="Start an upgrade to a plan for some months")
    async def start(
        self, request: Request, db_session: AsyncSession, data: UpgradeIn
    ) -> CheckoutOut:
        user_id = _signed_in_person(request)
        provider = payment_provider()
        if provider is None:
            raise ClientException(status_code=409, detail="Upgrades are not available yet.")
        tier = await db_session.get(AccessTier, data.tier_id)
        if tier is None or not tier.self_serve:
            raise NotFoundException(detail="This plan is not available.")
        if data.months not in (tier.durations or []):
            raise ClientException(detail="Choose one of the lengths this plan offers.")
        access = await resolve(db_session, user_id)
        if not can_buy(access, tier.id):
            raise ClientException(
                status_code=409, detail=f"You already have {tier.name} through your account."
            )
        now = datetime.now(UTC)
        checkout = Checkout(
            user_id=user_id,
            tier_id=tier.id,
            tier_key=tier.key,
            tier_name=tier.name,
            months=data.months,
            provider=provider.name,
            status="pending",
            expires_at=now + timedelta(minutes=CHECKOUT_MINUTES),
        )
        db_session.add(checkout)
        await db_session.flush()
        url = await provider.start(checkout)
        ends = await _plan_ends(db_session, user_id, tier.id, data.months, now)
        return _checkout_out(checkout, ends, url)

    @post("/upgrade/{checkout_id:uuid}/confirm", summary="Go ahead with a stub upgrade")
    async def confirm(
        self, request: Request, db_session: AsyncSession, checkout_id: UUID
    ) -> CheckoutOut:
        user_id = _signed_in_person(request)
        provider = payment_provider()
        # Only the stub settles in the browser; a vendor confirms through its webhook.
        if provider is None or provider.name != "stub":
            raise ClientException(status_code=409, detail="Upgrades are not available yet.")
        checkout = await db_session.scalar(
            select(Checkout)
            .where(Checkout.id == checkout_id, Checkout.user_id == user_id)
            .with_for_update()
        )
        if checkout is None:
            raise NotFoundException(detail="No such upgrade.")
        if checkout.status == "paid":  # A repeated click: same answer, nothing added.
            sub = await db_session.get(Subscription, checkout.subscription_id)
            return _checkout_out(checkout, sub.ends_at if sub else checkout.expires_at)
        now = datetime.now(UTC)
        if checkout.status != "pending" or checkout.provider != "stub":
            raise ClientException(status_code=409, detail="This upgrade cannot be confirmed.")
        if checkout.expires_at <= now:
            raise ClientException(status_code=409, detail="This upgrade expired. Start again.")
        tier = await db_session.get(AccessTier, checkout.tier_id) if checkout.tier_id else None
        if tier is None or not tier.self_serve or checkout.months not in (tier.durations or []):
            raise ClientException(
                status_code=409, detail="This plan changed since you chose it. Start again."
            )
        if not can_buy(await resolve(db_session, user_id), tier.id):
            raise ClientException(
                status_code=409, detail=f"You already have {tier.name} through your account."
            )
        current = await db_session.scalar(
            select(Subscription)
            .where(
                Subscription.user_id == user_id,
                Subscription.tier_id == tier.id,
                Subscription.status == "active",
                Subscription.ends_at > now,
            )
            .order_by(Subscription.ends_at.desc())
            .limit(1)
            .with_for_update()
        )
        if current is not None:
            current.ends_at = add_months(current.ends_at, checkout.months)
            subscription = current
        else:
            subscription = Subscription(
                user_id=user_id,
                tier_id=tier.id,
                starts_at=now,
                ends_at=add_months(now, checkout.months),
                provider=checkout.provider,
                status="active",
            )
            db_session.add(subscription)
        await db_session.flush()
        checkout.status = "paid"
        checkout.subscription_id = subscription.id
        await _record(
            db_session,
            request,
            "subscription",
            subscription.id,
            {
                "self_upgrade": tier.key,
                "months": checkout.months,
                "provider": checkout.provider,
                "ends_at": subscription.ends_at.isoformat(),
            },
        )
        return _checkout_out(checkout, subscription.ends_at)
