"""Your stories: how the author arranges their cards, and what the library shows beside them.

Card arrangement (position, pin, archive) is per account and kept out of the story itself, so
moving a card never creates a story version. Writing activity is a daily tally of words added
by the author in the browser; agent and import writes are not the author's writing.
Card status and open-item counts are derived on every read, never stored (DESIGN.md).
"""

from datetime import UTC, date, datetime, timedelta
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
    case,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.ai.models import AIRun
from storytool.domain.narrative.models import Scene
from storytool.domain.story.models import Story

SESSION_GAP = timedelta(minutes=30)


class LibraryCard(StoryToolBase):
    __tablename__ = "library_card"
    __table_args__ = (UniqueConstraint("user_id", "story_id", name="one_card_per_story"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"))
    position: Mapped[float | None] = mapped_column(Float, default=None)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class WritingDay(StoryToolBase):
    __tablename__ = "writing_day"
    __table_args__ = (UniqueConstraint("user_id", "day", name="one_tally_per_day"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    words: Mapped[int] = mapped_column(Integer, default=0)
    sessions: Mapped[int] = mapped_column(Integer, default=0)
    last_save_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


async def record_writing(session: AsyncSession, user_id: UUID, added_words: int) -> None:
    """Count an author's prose save: words added today, and a new session after a 30-minute gap."""
    now = datetime.now(UTC)
    statement = insert(WritingDay).values(
        user_id=user_id,
        day=now.date(),
        words=max(added_words, 0),
        sessions=1,
        last_save_at=now,
        created_at=now,
        updated_at=now,
    )
    await session.execute(
        statement.on_conflict_do_update(
            constraint="one_tally_per_day",
            set_={
                "words": WritingDay.words + max(added_words, 0),
                "sessions": WritingDay.sessions
                + case((WritingDay.last_save_at < now - SESSION_GAP, 1), else_=0),
                "last_save_at": now,
                "updated_at": now,
            },
        )
    )


class CardOut(BaseModel):
    story_id: UUID
    position: float | None
    pinned: bool
    archived: bool
    status: str
    scene_count: int
    drafted_scene_count: int
    tk_count: int
    pending_agent_changes: int


class WeekOut(BaseModel):
    days: list[int]
    words: int
    sessions: int


class LibraryOverviewOut(BaseModel):
    cards: list[CardOut]
    week: WeekOut


class CardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float | None = None
    pinned: bool | None = None
    archived: bool | None = None


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
        story_ids = list(
            await db_session.scalars(
                select(Story.id).where(Story.user_id == user_id, Story.deleted_at.is_(None))
            )
        )
        cards = {
            card.story_id: card
            for card in await db_session.scalars(
                select(LibraryCard).where(LibraryCard.user_id == user_id)
            )
        }
        counts: dict[UUID, tuple[int, int, int, int, int]] = {}
        pending: dict[UUID, int] = {}
        if story_ids:
            rows = await db_session.execute(
                select(
                    Scene.story_id,
                    func.count(Scene.id),
                    func.count(Scene.id).filter(Scene.status == "drafted"),
                    func.count(Scene.id).filter(Scene.status == "revised"),
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
            scenes, drafted, revised, words, tks = counts.get(story_id, (0, 0, 0, 0, 0))
            card = cards.get(story_id)
            out.append(
                CardOut(
                    story_id=story_id,
                    position=card.position if card else None,
                    pinned=bool(card and card.pinned),
                    archived=bool(card and card.archived),
                    status=card_status(scenes, drafted, revised, words),
                    scene_count=scenes,
                    drafted_scene_count=drafted + revised,
                    tk_count=tks,
                    pending_agent_changes=pending.get(story_id, 0),
                )
            )
        today = datetime.now(UTC).date()
        first = today - timedelta(days=6)
        tallies = {
            row.day: row
            for row in await db_session.scalars(
                select(WritingDay).where(WritingDay.user_id == user_id, WritingDay.day >= first)
            )
        }
        days = [
            tallies[first + timedelta(days=n)].words if first + timedelta(days=n) in tallies else 0
            for n in range(7)
        ]
        return LibraryOverviewOut(
            cards=out,
            week=WeekOut(
                days=days, words=sum(days), sessions=sum(row.sessions for row in tallies.values())
            ),
        )

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
