"""First-run measures (usability phase 4): time to first scene, first-hour checklist completion, and
tools opened once and never again. Account-level only: no prose, titles shown, IP addresses or
external analytics. Readable by the site admin only."""

from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Literal
from uuid import UUID

from litestar import Controller, Request, get, post
from pydantic import BaseModel
from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.site.funnel import FunnelEvent, logger
from storytool.domain.site.shoutouts import require_admin

# Workspace places a writer can open: Write and Read, the eight plan levels and Design pages.
ToolKind = Literal[
    "write",
    "read",
    "level-1",
    "level-2",
    "level-3",
    "level-4",
    "level-5",
    "level-6",
    "level-7",
    "level-8",
    "structure",
    "timeline",
    "places",
    "glossary",
    "check",
    "grid",
    "pacing",
    "agent-changes",
    "catch-up",
    "placeholders",
    "history",
]
# A tool opened in one session only, and not since this long ago, counts as tried and dropped.
DROPPED_AFTER = timedelta(days=7)


class ToolUse(StoryToolBase):
    """One row per account and tool: created_at is the first open, updated_at the latest."""

    __tablename__ = "tool_use"
    __table_args__ = (UniqueConstraint("user_id", "tool", name="one_tool_use"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    tool: Mapped[str] = mapped_column(String(30))
    # Browser sessions that opened the tool (the client sends each tool once per session).
    sessions: Mapped[int] = mapped_column(Integer, default=1)


class ToolOpenIn(BaseModel):
    tool: ToolKind


class Bucket(BaseModel):
    label: str
    count: int


class ToolOut(BaseModel):
    tool: str
    accounts: int
    dropped: int


class FirstRunOut(BaseModel):
    first_scene_count: int
    median_hours_to_first_scene: float | None
    hours_to_first_scene: list[Bucket]
    accounts: int
    checklist: dict[str, int]
    tools: list[ToolOut]


class ToolOpenController(Controller):
    path = "/api/site/tool-open"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(status_code=204, summary="Record that the signed-in writer opened a workspace tool")
    async def tool_open(self, request: Request, db_session: AsyncSession, data: ToolOpenIn) -> None:
        user_id = request.scope["state"].get("storytool_user_id")
        if user_id is None:
            return
        now = datetime.now(UTC)
        # Telemetry must never fail the writer's request.
        try:
            async with db_session.begin_nested():
                await db_session.execute(
                    insert(ToolUse)
                    .values(user_id=user_id, tool=data.tool, sessions=1)
                    .on_conflict_do_update(
                        constraint="one_tool_use",
                        set_={"sessions": ToolUse.sessions + 1, "updated_at": now},
                    )
                )
        except SQLAlchemyError:
            logger.warning("Tool use could not be recorded")


def buckets(hours: list[float]) -> list[Bucket]:
    edges = [("Under 1 hour", 1), ("1 to 24 hours", 24), ("1 to 7 days", 168)]
    out, low = [], 0.0
    for label, high in edges:
        out.append(Bucket(label=label, count=sum(1 for h in hours if low <= h < high)))
        low = high
    out.append(Bucket(label="Over 7 days", count=sum(1 for h in hours if h >= low)))
    return out


class FirstRunController(Controller):
    path = "/api/admin/funnel/first-run"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get(summary="First-run measures (site admin only)")
    async def first_run(self, request: Request, db_session: AsyncSession) -> FirstRunOut:
        await require_admin(request, db_session)
        from storytool.domain.auth.models import User
        from storytool.domain.cast.models import Character
        from storytool.domain.story.library import is_example
        from storytool.domain.story.models import Story

        # Time from signup to the first scene with prose (both are funnel milestones).
        moments: dict[str, dict] = {"signup": {}, "first_scene": {}, "ai_connected": {}}
        rows = await db_session.execute(
            select(FunnelEvent.kind, FunnelEvent.subject_id, FunnelEvent.created_at).where(
                FunnelEvent.kind.in_(list(moments))
            )
        )
        for kind, subject, at in rows.all():
            moments[kind][subject] = at
        hours = [
            (at - moments["signup"][user]).total_seconds() / 3600
            for user, at in moments["first_scene"].items()
            if user in moments["signup"]
        ]

        # First-hour checklist steps, per account; seeded example stories don't count.
        users = (await db_session.execute(select(User.id, User.guide))).all()
        cast = {
            owner
            for owner, title, genre in (
                await db_session.execute(
                    select(Story.user_id, Story.title, Story.genre)
                    .join(Character, Character.story_id == Story.id)
                    .where(Story.deleted_at.is_(None))
                    .distinct()
                )
            ).all()
            if not is_example(title, genre)
        }
        wrote = set(moments["first_scene"])
        checked = {user for user, guide in users if (guide or {}).get("check_run")}
        checklist = {
            "wrote_a_scene": len(wrote),
            "added_a_character": len(cast),
            "ran_a_check": len(checked),
            "connected_ai": len(moments["ai_connected"]),
            "first_three_done": len(wrote & cast & checked),
            "hid_checklist": sum(
                1 for _, guide in users if (guide or {}).get("checklist_dismissed")
            ),
        }

        # Tools opened in one session only and not since DROPPED_AFTER.
        cutoff = datetime.now(UTC) - DROPPED_AFTER
        tool_rows = await db_session.execute(
            select(
                ToolUse.tool,
                func.count(),
                func.count().filter(ToolUse.sessions == 1, ToolUse.updated_at < cutoff),
            ).group_by(ToolUse.tool)
        )
        tools = sorted(
            (
                ToolOut(tool=tool, accounts=accounts, dropped=dropped)
                for tool, accounts, dropped in tool_rows.all()
            ),
            key=lambda row: (-(row.dropped / row.accounts if row.accounts else 0), row.tool),
        )
        return FirstRunOut(
            first_scene_count=len(hours),
            median_hours_to_first_scene=round(median(hours), 1) if hours else None,
            hours_to_first_scene=buckets(hours),
            accounts=len(users),
            checklist=checklist,
            tools=tools,
        )
