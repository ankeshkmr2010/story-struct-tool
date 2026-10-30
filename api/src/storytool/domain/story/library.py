"""Your stories: how the author arranges their cards, and what the library shows beside them.

Card arrangement (position, pin, archive) is per account and kept out of the story itself, so
moving a card never creates a story version. `WritingDay` is the daily tally that goals.py
writes and reads (streaks, This week).
Card status and open-item counts are derived on every read, never stored (DESIGN.md).
"""

from datetime import UTC, date, datetime
from uuid import UUID

from litestar import Controller, Request, get, patch
from litestar.exceptions import NotFoundException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.ai.models import AIRun
from storytool.domain.narrative.models import Scene
from storytool.domain.story.models import Story


class LibraryCard(StoryToolBase):
    __tablename__ = "library_card"
    __table_args__ = (UniqueConstraint("user_id", "story_id", name="one_card_per_story"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"))
    position: Mapped[float | None] = mapped_column(Float, default=None)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # Usability phase 2, per story: show every Design tool, and every ladder level.
    # None means the default for the story's age (see SIMPLE_SINCE).
    show_all_tools: Mapped[bool | None] = mapped_column(Boolean, default=None)
    full_ladder: Mapped[bool | None] = mapped_column(Boolean, default=None)


class WritingDay(StoryToolBase):
    __tablename__ = "writing_day"
    __table_args__ = (UniqueConstraint("user_id", "day", name="one_tally_per_day"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    words: Mapped[int] = mapped_column(Integer, default=0)
    sessions: Mapped[int] = mapped_column(Integer, default=0)
    ai_words: Mapped[int] = mapped_column(Integer, default=0)
    last_save_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CardOut(BaseModel):
    story_id: UUID
    position: float | None
    pinned: bool
    archived: bool
    show_all_tools: bool = True
    full_ladder: bool = True
    status: str
    scene_count: int
    drafted_scene_count: int
    tk_count: int
    pending_agent_changes: int
    goal_percent: int | None = None
    goal_status: str | None = None
    cover_url: str | None = None
    cover_focus_x: float = 0.5
    cover_focus_y: float = 0.5


class LibraryOverviewOut(BaseModel):
    cards: list[CardOut]


class CardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float | None = None
    pinned: bool | None = None
    archived: bool | None = None
    show_all_tools: bool | None = None
    full_ladder: bool | None = None


# Stories created before the simpler Design shipped keep every tool and level by default.
SIMPLE_SINCE = datetime(2026, 10, 30, tzinfo=UTC)


def chosen(card: "LibraryCard | None", field: str, created_at: datetime) -> bool:
    value = getattr(card, field) if card else None
    return value if value is not None else created_at < SIMPLE_SINCE


def card_status(scenes: int, drafted: int, revised: int, words: int) -> str:
    """Planning until prose exists; Revision once half the scenes are revised; Draft between."""
    if scenes and revised * 2 >= scenes:
        return "revision"
    if drafted or revised or words:
        return "draft"
    return "planning"


class LibraryController(Controller):
    path = "/api/library"

    @get("/overview", summary="Card arrangement, status and open items for Your stories")
    async def overview(self, request: Request, db_session: AsyncSession) -> LibraryOverviewOut:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        created = dict(
            (
                await db_session.execute(
                    select(Story.id, Story.created_at).where(
                        Story.user_id == user_id, Story.deleted_at.is_(None)
                    )
                )
            ).all()
        )
        story_ids = list(created)
        cards = {
            card.story_id: card
            for card in await db_session.scalars(
                select(LibraryCard).where(LibraryCard.user_id == user_id)
            )
        }
        counts: dict[UUID, tuple[int, int, int, int, int, int]] = {}
        pending: dict[UUID, int] = {}
        if story_ids:
            rows = await db_session.execute(
                select(
                    Scene.story_id,
                    func.count(Scene.id),
                    func.count(Scene.id).filter(Scene.status == "drafted"),
                    func.count(Scene.id).filter(Scene.status == "revised"),
                    # Drafted: has prose or marked drafted/revised (prose.is_drafted).
                    func.count(Scene.id).filter(
                        (Scene.word_count > 0) | Scene.status.in_(("drafted", "revised"))
                    ),
                    func.coalesce(func.sum(Scene.word_count), 0),
                    func.coalesce(
                        func.sum(
                            func.regexp_count(
                                func.coalesce(Scene.content, ""), r"\[\s*tk\s*[]:]", 1, "i"
                            )
                        ),
                        0,
                    ),
                )
                .where(Scene.story_id.in_(story_ids))
                .group_by(Scene.story_id)
            )
            counts = {row[0]: tuple(int(value) for value in row[1:]) for row in rows.all()}  # type: ignore[misc]
            pending = dict(
                (
                    await db_session.execute(
                        select(AIRun.story_id, func.count(AIRun.id))
                        .where(AIRun.story_id.in_(story_ids), AIRun.status == "proposed")
                        .group_by(AIRun.story_id)
                    )
                ).all()
            )
        out = []
        for story_id in story_ids:
            scenes, drafted, revised, with_prose, words, tks = counts.get(
                story_id, (0, 0, 0, 0, 0, 0)
            )
            card = cards.get(story_id)
            out.append(
                CardOut(
                    story_id=story_id,
                    position=card.position if card else None,
                    pinned=bool(card and card.pinned),
                    archived=bool(card and card.archived),
                    show_all_tools=chosen(card, "show_all_tools", created[story_id]),
                    full_ladder=chosen(card, "full_ladder", created[story_id]),
                    status=card_status(scenes, drafted, revised, words),
                    scene_count=scenes,
                    drafted_scene_count=with_prose,
                    tk_count=tks,
                    pending_agent_changes=pending.get(story_id, 0),
                )
            )
        # Covers replace the generated tile on cards that have one.
        from storytool.domain.story.image_models import StoryImage

        by_id = {item.story_id: item for item in out}
        for image in await db_session.scalars(
            select(StoryImage).where(
                StoryImage.story_id.in_(story_ids),
                StoryImage.role == "cover",
                StoryImage.archived.is_(False),
            )
        ):
            card_out = by_id[image.story_id]
            card_out.cover_url = f"/api/stories/{image.story_id}/images/{image.id}/file"
            card_out.cover_focus_x, card_out.cover_focus_y = image.focus_x, image.focus_y
        # Story goals ride on the cards: progress bar and pace chip (goals.py derives both).
        from storytool.domain.story.goals import (
            StoryGoal,
            goal_settings,
            story_goal_summary,
            zone,
        )

        goals = list(
            await db_session.scalars(
                select(StoryGoal).where(
                    StoryGoal.user_id == user_id, StoryGoal.story_id.in_(story_ids)
                )
            )
        )
        if goals:
            settings = await goal_settings(db_session, user_id)
            today = datetime.now(UTC).astimezone(zone(settings.timezone)).date()
            by_story = {item.story_id: item for item in out}
            for goal in goals:
                summary = await story_goal_summary(db_session, goal, settings, today)
                by_story[goal.story_id].goal_percent = summary.percent
                by_story[goal.story_id].goal_status = summary.status
        return LibraryOverviewOut(cards=out)

    @patch("/cards/{story_id:uuid}", summary="Move, pin or archive a story card")
    async def update_card(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: CardUpdate
    ) -> None:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        owned = await db_session.scalar(
            select(Story.id).where(
                Story.id == story_id, Story.user_id == user_id, Story.deleted_at.is_(None)
            )
        )
        if owned is None:
            raise NotFoundException(detail="Story not found")
        card = await db_session.scalar(
            select(LibraryCard).where(
                LibraryCard.user_id == user_id, LibraryCard.story_id == story_id
            )
        )
        if card is None:
            card = LibraryCard(user_id=user_id, story_id=story_id)
            db_session.add(card)
        for field in data.model_fields_set:
            value = getattr(data, field)
            if field == "position" or value is not None:
                setattr(card, field, value)
        await db_session.flush()
