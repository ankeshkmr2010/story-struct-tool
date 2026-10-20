"""Minimal funnel milestones: no prose, prompts, IP addresses or external analytics."""

import logging
from typing import Literal
from uuid import UUID

from litestar import Controller, Request, get, post
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, String, UniqueConstraint, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.site.shoutouts import require_admin

TryKind = Literal["try_start", "try_step_1", "try_step_2", "try_step_3", "try_step_4", "try_step_5", "try_step_6", "try_step_7", "try_skip", "try_keep_click", "try_imported"]
EventKind = Literal["visit", "signup", "first_scene", "ai_connected"] | TryKind
logger = logging.getLogger(__name__)


class FunnelEvent(StoryToolBase):
    __tablename__ = "funnel_event"
    __table_args__ = (UniqueConstraint("kind", "subject_id", name="one_funnel_milestone"),)

    kind: Mapped[str] = mapped_column(String(20))
    subject_id: Mapped[UUID] = mapped_column()
    visitor_id: Mapped[UUID | None] = mapped_column(default=None)
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), default=None
    )


def request_visitor(request: Request) -> UUID | None:
    try:
        return UUID(request.headers.get("x-storytool-visitor", ""))
    except ValueError:
        return None


async def record_milestone(
    db: AsyncSession,
    kind: EventKind,
    *,
    user_id: UUID | None = None,
    visitor_id: UUID | None = None,
) -> None:
    subject_id = visitor_id if kind == "visit" or kind.startswith("try_") else user_id
    if subject_id is None:
        return
    # A telemetry failure must not roll back a signup or manuscript change.
    try:
        async with db.begin_nested():
            await db.execute(
                insert(FunnelEvent)
                .values(kind=kind, subject_id=subject_id, visitor_id=visitor_id, user_id=user_id)
                .on_conflict_do_nothing(constraint="one_funnel_milestone")
            )
    except SQLAlchemyError:
        logger.warning("Funnel milestone could not be recorded")


class VisitIn(BaseModel):
    visitor_id: UUID


class TryEventsIn(BaseModel):
    visitor_id: UUID
    events: list[TryKind] = Field(max_length=10)


class FunnelOut(BaseModel):
    visit: int
    signup: int
    first_scene: int
    ai_connected: int


class VisitController(Controller):
    path = "/api/site/visit"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(status_code=204, summary="Record a browser's first visit")
    async def visit(self, db_session: AsyncSession, data: VisitIn) -> None:
        await record_milestone(db_session, "visit", visitor_id=data.visitor_id)


class TryController(Controller):
    path = "/api/site/try"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(status_code=204, summary="Record browser sandbox milestones")
    async def events(self, db_session: AsyncSession, data: TryEventsIn) -> None:
        for kind in set(data.events):
            if kind != "try_imported":  # Successful imports are recorded by the importer.
                await record_milestone(db_session, kind, visitor_id=data.visitor_id)


class FunnelController(Controller):
    path = "/api/admin/funnel"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/try", summary="Guided sandbox funnel (site admin only)")
    async def try_counts(self, request: Request, db_session: AsyncSession) -> dict[str, int]:
        await require_admin(request, db_session)
        kinds = ["try_start", *[f"try_step_{i}" for i in range(1, 8)], "try_skip", "try_keep_click", "try_imported"]
        grouped = await db_session.execute(select(FunnelEvent.kind, func.count()).where(FunnelEvent.kind.in_(kinds)).group_by(FunnelEvent.kind))
        result = {kind: 0 for kind in kinds}
        result.update(dict(grouped.all()))
        starters = select(FunnelEvent.visitor_id).where(FunnelEvent.kind == "try_start")
        result["try_signup"] = await db_session.scalar(select(func.count()).select_from(FunnelEvent).where(FunnelEvent.kind == "signup", FunnelEvent.visitor_id.in_(starters))) or 0
        return result

    @get(summary="Funnel counts since tracking began (site admin only)")
    async def counts(self, request: Request, db_session: AsyncSession) -> FunnelOut:
        await require_admin(request, db_session)
        signups = select(FunnelEvent.subject_id).where(FunnelEvent.kind == "signup")
        first_scenes = select(FunnelEvent.subject_id).where(
            FunnelEvent.kind == "first_scene", FunnelEvent.subject_id.in_(signups)
        )
        visit = await db_session.scalar(
            select(func.count()).select_from(FunnelEvent).where(FunnelEvent.kind == "visit")
        )
        signup = await db_session.scalar(select(func.count()).select_from(signups.subquery()))
        first_scene = await db_session.scalar(
            select(func.count()).select_from(first_scenes.subquery())
        )
        ai_connected = await db_session.scalar(
            select(func.count())
            .select_from(FunnelEvent)
            .where(
                FunnelEvent.kind == "ai_connected",
                FunnelEvent.subject_id.in_(first_scenes),
            )
        )
        return FunnelOut(
            visit=visit or 0,
            signup=signup or 0,
            first_scene=first_scene or 0,
            ai_connected=ai_connected or 0,
        )
