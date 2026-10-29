"""Writing goals: a daily habit for the account, a target (and deadline) per story, and sprints.

Only settings and raw daily tallies are stored. Streaks, pace and on-track status are derived
on every read (DESIGN.md: derived state is never stored). Days are the author's local days.
Typed words always count; words from applied AI proposals count only with `count_ai`.
Deleting text never subtracts, and one save counts at most PASTE_CAP words.
"""

from datetime import UTC, date, datetime, timedelta
from math import ceil
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from litestar import Controller, Request, delete, get, post, put
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    case,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.narrative.models import Scene
from storytool.domain.story.library import WritingDay
from storytool.domain.story.models import Story

SESSION_GAP = timedelta(minutes=30)
PASTE_CAP = 1000
ALL_DAYS = 127  # Monday = bit 0 ... Sunday = bit 6


class WritingGoal(StoryToolBase):
    __tablename__ = "writing_goal"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), unique=True
    )
    daily_words: Mapped[int | None] = mapped_column(Integer, default=None)
    writing_days: Mapped[int] = mapped_column(Integer, default=ALL_DAYS)
    forgive_missed: Mapped[bool] = mapped_column(Boolean, default=True)
    count_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")


class StoryGoal(StoryToolBase):
    __tablename__ = "story_goal"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), unique=True)
    target_words: Mapped[int] = mapped_column(Integer)
    deadline: Mapped[date | None] = mapped_column(Date, default=None)
    daily_words: Mapped[int | None] = mapped_column(Integer, default=None)
    baseline_words: Mapped[int] = mapped_column(Integer, default=0)
    start_day: Mapped[date] = mapped_column(Date)


class StoryDay(StoryToolBase):
    __tablename__ = "story_day"
    __table_args__ = (UniqueConstraint("story_id", "day", name="one_story_tally_per_day"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    words: Mapped[int] = mapped_column(Integer, default=0)
    ai_words: Mapped[int] = mapped_column(Integer, default=0)


class WritingSprint(StoryToolBase):
    __tablename__ = "writing_sprint"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    minutes: Mapped[int] = mapped_column(Integer)
    target_words: Mapped[int | None] = mapped_column(Integer, default=None)
    words: Mapped[int] = mapped_column(Integer, default=0)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


# ------------------------------------------------------------------ helpers


def zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def is_writing_day(mask: int, day: date) -> bool:
    return bool(mask >> day.weekday() & 1)


def writing_days_between(mask: int, first: date, last: date) -> int:
    """Writing days from `first` to `last` inclusive (0 when last is before first)."""
    return sum(
        is_writing_day(mask, first + timedelta(days=n)) for n in range((last - first).days + 1)
    )


async def goal_settings(session: AsyncSession, user_id: UUID) -> WritingGoal:
    """The account's goal row, or unsaved defaults (no daily goal, every day, UTC)."""
    row = await session.scalar(select(WritingGoal).where(WritingGoal.user_id == user_id))
    return row or WritingGoal(
        user_id=user_id,
        daily_words=None,
        writing_days=ALL_DAYS,
        forgive_missed=True,
        count_ai=False,
        timezone="UTC",
    )


def ended(sprint: WritingSprint, now: datetime) -> datetime | None:
    if sprint.ended_at:
        return sprint.ended_at
    finish = sprint.started_at + timedelta(minutes=sprint.minutes)
    return finish if finish <= now else None


async def record_words(
    session: AsyncSession, user_id: UUID, story_id: UUID, added: int, *, ai: bool = False
) -> None:
    """Tally words added today (local day) for the account and the story; typed saves also
    open a session after a 30-minute gap and feed the running sprint."""
    added = max(0, min(added, PASTE_CAP))
    now = datetime.now(UTC)
    goal = await goal_settings(session, user_id)
    today = now.astimezone(zone(goal.timezone)).date()
    typed, assisted = (0, added) if ai else (added, 0)
    day = insert(WritingDay).values(
        user_id=user_id,
        day=today,
        words=typed,
        ai_words=assisted,
        sessions=0 if ai else 1,
        last_save_at=now,
        created_at=now,
        updated_at=now,
    )
    update = {"words": WritingDay.words + typed, "ai_words": WritingDay.ai_words + assisted}
    if not ai:
        update |= {
            "sessions": WritingDay.sessions
            + case((WritingDay.last_save_at < now - SESSION_GAP, 1), else_=0),
            "last_save_at": now,
        }
    await session.execute(
        day.on_conflict_do_update(
            constraint="one_tally_per_day", set_={**update, "updated_at": now}
        )
    )
    story_day = insert(StoryDay).values(
        user_id=user_id,
        story_id=story_id,
        day=today,
        words=typed,
        ai_words=assisted,
        created_at=now,
        updated_at=now,
    )
    await session.execute(
        story_day.on_conflict_do_update(
            constraint="one_story_tally_per_day",
            set_={
                "words": StoryDay.words + typed,
                "ai_words": StoryDay.ai_words + assisted,
                "updated_at": now,
            },
        )
    )
    if typed:
        for sprint in await session.scalars(
            select(WritingSprint).where(
                WritingSprint.user_id == user_id, WritingSprint.ended_at.is_(None)
            )
        ):
            if ended(sprint, now) is None:
                sprint.words += typed


async def story_words(session: AsyncSession, story_id: UUID) -> int:
    return int(
        await session.scalar(
            select(func.coalesce(func.sum(Scene.word_count), 0)).where(Scene.story_id == story_id)
        )
        or 0
    )


def streaks(days: dict[date, int], goal: WritingGoal, today: date) -> tuple[int, int]:
    """(current, best). Rest days neither count nor break; with `forgive_missed` one missed
    writing day per week is skipped. Today only counts once met, so it never breaks a streak."""
    target = goal.daily_words or 1
    if not days:
        return 0, 0

    def met(day: date) -> bool:
        return days.get(day, 0) >= target

    best = run = 0
    forgiven: set[tuple[int, int]] = set()
    day = min(days)
    while day <= today:
        if is_writing_day(goal.writing_days, day):
            if met(day):
                run += 1
            elif day == today:
                pass
            elif goal.forgive_missed and day.isocalendar()[:2] not in forgiven:
                forgiven.add(day.isocalendar()[:2])
            else:
                run = 0
            best = max(best, run)
        day += timedelta(days=1)
    return run, best


# ------------------------------------------------------------------ schemas


class GoalSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_words: int | None = Field(default=None, ge=1, le=100_000)
    writing_days: int = Field(default=ALL_DAYS, ge=1, le=ALL_DAYS)
    forgive_missed: bool = True
    count_ai: bool = False
    timezone: str = "UTC"


class GoalSettingsOut(GoalSettingsIn):
    model_config = ConfigDict(from_attributes=True)


class DayOut(BaseModel):
    day: date
    words: int
    writing_day: bool
    met: bool


class SprintIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    story_id: UUID
    minutes: int = Field(ge=1, le=240)
    target_words: int | None = Field(default=None, ge=1, le=100_000)


class SprintOut(BaseModel):
    id: UUID
    story_id: UUID
    started_at: datetime
    minutes: int
    target_words: int | None
    words: int
    ended_at: datetime | None


class GoalsOut(BaseModel):
    settings: GoalSettingsOut
    has_goal: bool
    today: date
    today_words: int
    streak: int
    best_streak: int
    week: list[DayOut]
    week_words: int
    week_sessions: int
    week_sprints: int
    week_sprint_words: int
    active_sprint: SprintOut | None
    last_sprint: SprintOut | None
    recent_sprints: list[SprintOut]


class StoryGoalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_words: int = Field(ge=1, le=10_000_000)
    deadline: date | None = None
    daily_words: int | None = Field(default=None, ge=1, le=100_000)


class StoryGoalOut(BaseModel):
    target_words: int
    deadline: date | None
    daily_words: int | None
    words_now: int
    percent: int
    today_words: int
    needed_today: int | None
    behind_by: int
    days_left: int | None
    status: str  # done | on_track | behind | overdue | open


class HabitOut(BaseModel):
    daily_words: int | None
    today_words: int
    streak: int


class StoryGoalRow(BaseModel):
    story_id: UUID
    title: str
    goal: StoryGoalOut | None


class StoryGoalEnvelope(BaseModel):
    goal: StoryGoalOut | None
    habit: HabitOut


def sprint_out(sprint: WritingSprint, now: datetime) -> SprintOut:
    return SprintOut(
        id=sprint.id,
        story_id=sprint.story_id,
        started_at=sprint.started_at,
        minutes=sprint.minutes,
        target_words=sprint.target_words,
        words=sprint.words,
        ended_at=ended(sprint, now),
    )


async def habit_days(session: AsyncSession, user_id: UUID, count_ai: bool) -> dict[date, int]:
    rows = await session.scalars(select(WritingDay).where(WritingDay.user_id == user_id))
    return {row.day: row.words + (row.ai_words if count_ai else 0) for row in rows}


async def story_goal_summary(
    session: AsyncSession, goal: StoryGoal, settings: WritingGoal, today: date
) -> StoryGoalOut:
    """Pace for one story. The plan runs from the day the goal was set (baseline words) to the
    deadline over writing days; today's need spreads what is left over the days remaining."""
    words_now = await story_words(session, goal.story_id)
    tally = await session.scalar(
        select(StoryDay).where(StoryDay.story_id == goal.story_id, StoryDay.day == today)
    )
    written_today = (tally.words + tally.ai_words) if tally else 0
    today_words = (tally.words + (tally.ai_words if settings.count_ai else 0)) if tally else 0
    start_today = max(0, words_now - written_today)
    remaining = max(0, goal.target_words - start_today)
    mask = settings.writing_days
    needed: int | None = goal.daily_words
    behind = 0
    days_left: int | None = None
    if goal.deadline:
        days_left = writing_days_between(mask, today, goal.deadline)
        if goal.daily_words is None and days_left:
            needed = ceil(remaining / days_left)
        span = max(1, writing_days_between(mask, goal.start_day, goal.deadline))
        planned = goal.daily_words or ceil(max(0, goal.target_words - goal.baseline_words) / span)
        elapsed = writing_days_between(mask, goal.start_day, today - timedelta(days=1))
        expected = min(goal.target_words, goal.baseline_words + planned * elapsed)
        behind = max(0, expected - start_today)
    elif goal.daily_words:
        elapsed = writing_days_between(mask, goal.start_day, today - timedelta(days=1))
        expected = min(goal.target_words, goal.baseline_words + goal.daily_words * elapsed)
        behind = max(0, expected - start_today)
    if words_now >= goal.target_words:
        status = "done"
    elif goal.deadline and goal.deadline < today:
        status = "overdue"
    elif goal.deadline or goal.daily_words:
        status = "behind" if behind else "on_track"
    else:
        status = "open"
    return StoryGoalOut(
        target_words=goal.target_words,
        deadline=goal.deadline,
        daily_words=goal.daily_words,
        words_now=words_now,
        percent=min(100, round(words_now * 100 / goal.target_words)),
        today_words=today_words,
        needed_today=None if status in {"done", "overdue"} else needed,
        behind_by=behind if status == "behind" else 0,
        days_left=days_left,
        status=status,
    )


async def story_goal_envelope(
    session: AsyncSession, user_id: UUID, story_id: UUID
) -> StoryGoalEnvelope:
    settings = await goal_settings(session, user_id)
    today = datetime.now(UTC).astimezone(zone(settings.timezone)).date()
    goal = await session.scalar(select(StoryGoal).where(StoryGoal.story_id == story_id))
    days = await habit_days(session, user_id, settings.count_ai)
    return StoryGoalEnvelope(
        goal=await story_goal_summary(session, goal, settings, today) if goal else None,
        habit=HabitOut(
            daily_words=settings.daily_words,
            today_words=days.get(today, 0),
            streak=streaks(days, settings, today)[0],
        ),
    )


async def owned_story(session: AsyncSession, user_id: UUID, story_id: UUID) -> None:
    if (
        await session.scalar(
            select(Story.id).where(
                Story.id == story_id, Story.user_id == user_id, Story.deleted_at.is_(None)
            )
        )
        is None
    ):
        raise NotFoundException(detail="Story not found")


# ------------------------------------------------------------------ routes


class GoalsController(Controller):
    path = "/api/goals"

    @get(summary="Daily goal, streak, this week and sprints")
    async def overview(self, request: Request, db_session: AsyncSession) -> GoalsOut:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        settings = await goal_settings(db_session, user_id)
        now = datetime.now(UTC)
        today = now.astimezone(zone(settings.timezone)).date()
        days = await habit_days(db_session, user_id, settings.count_ai)
        current, best = streaks(days, settings, today)
        target = settings.daily_words or 1
        week = [
            DayOut(
                day=day,
                words=days.get(day, 0),
                writing_day=is_writing_day(settings.writing_days, day),
                met=days.get(day, 0) >= target,
            )
            for day in (today - timedelta(days=6 - n) for n in range(7))
        ]
        sessions = await db_session.scalar(
            select(func.coalesce(func.sum(WritingDay.sessions), 0)).where(
                WritingDay.user_id == user_id, WritingDay.day >= today - timedelta(days=6)
            )
        )
        sprints = list(
            await db_session.scalars(
                select(WritingSprint)
                .where(
                    WritingSprint.user_id == user_id,
                    WritingSprint.started_at >= now - timedelta(days=7),
                )
                .order_by(WritingSprint.started_at.desc())
            )
        )
        active = next((sprint for sprint in sprints if ended(sprint, now) is None), None)
        finished = [sprint for sprint in sprints if ended(sprint, now) is not None]
        return GoalsOut(
            settings=GoalSettingsOut.model_validate(settings),
            has_goal=settings.daily_words is not None,
            today=today,
            today_words=days.get(today, 0),
            streak=current,
            best_streak=best,
            week=week,
            week_words=sum(day.words for day in week),
            week_sessions=int(sessions or 0),
            week_sprints=len(finished),
            week_sprint_words=sum(sprint.words for sprint in finished),
            active_sprint=sprint_out(active, now) if active else None,
            last_sprint=sprint_out(finished[0], now) if finished else None,
            recent_sprints=[sprint_out(sprint, now) for sprint in finished],
        )

    @get("/stories", summary="Every story with its goal and pace, for the Goals page")
    async def stories(self, request: Request, db_session: AsyncSession) -> list[StoryGoalRow]:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        settings = await goal_settings(db_session, user_id)
        today = datetime.now(UTC).astimezone(zone(settings.timezone)).date()
        goals = {
            goal.story_id: goal
            for goal in await db_session.scalars(
                select(StoryGoal).where(StoryGoal.user_id == user_id)
            )
        }
        rows = []
        for story_id, title in await db_session.execute(
            select(Story.id, Story.title)
            .where(Story.user_id == user_id, Story.deleted_at.is_(None))
            .order_by(Story.updated_at.desc())
        ):
            goal = goals.get(story_id)
            summary = await story_goal_summary(db_session, goal, settings, today) if goal else None
            rows.append(StoryGoalRow(story_id=story_id, title=title, goal=summary))
        return rows

    @put(summary="Set the daily goal and its rules")
    async def save(
        self, request: Request, db_session: AsyncSession, data: GoalSettingsIn
    ) -> GoalSettingsOut:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        if zone(data.timezone).key != data.timezone:
            raise ClientException(detail="Unknown time zone")
        row = await db_session.scalar(select(WritingGoal).where(WritingGoal.user_id == user_id))
        if row is None:
            row = WritingGoal(user_id=user_id)
            db_session.add(row)
        for field, value in data.model_dump().items():
            setattr(row, field, value)
        await db_session.flush()
        return GoalSettingsOut.model_validate(row)

    @post("/sprints", status_code=201, summary="Start a sprint (ends any running one)")
    async def start_sprint(
        self, request: Request, db_session: AsyncSession, data: SprintIn
    ) -> SprintOut:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        await owned_story(db_session, user_id, data.story_id)
        now = datetime.now(UTC)
        for sprint in await db_session.scalars(
            select(WritingSprint).where(
                WritingSprint.user_id == user_id, WritingSprint.ended_at.is_(None)
            )
        ):
            sprint.ended_at = ended(sprint, now) or now
        sprint = WritingSprint(user_id=user_id, started_at=now, words=0, **data.model_dump())
        db_session.add(sprint)
        await db_session.flush()
        return sprint_out(sprint, now)

    @post("/sprints/{sprint_id:uuid}/end", status_code=200, summary="End a sprint early")
    async def end_sprint(
        self, request: Request, db_session: AsyncSession, sprint_id: UUID
    ) -> SprintOut:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        sprint = await db_session.scalar(
            select(WritingSprint).where(
                WritingSprint.id == sprint_id, WritingSprint.user_id == user_id
            )
        )
        if sprint is None:
            raise NotFoundException(detail="Sprint not found")
        now = datetime.now(UTC)
        sprint.ended_at = ended(sprint, now) or now
        await db_session.flush()
        return sprint_out(sprint, now)


class StoryGoalController(Controller):
    path = "/api/stories/{story_id:uuid}/goal"

    @get(summary="This story's goal and pace, with the daily habit beside it")
    async def read(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> StoryGoalEnvelope:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        return await story_goal_envelope(db_session, user_id, story_id)

    @put(summary="Set this story's word target, deadline or daily pace")
    async def save(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: StoryGoalIn
    ) -> StoryGoalEnvelope:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        await owned_story(db_session, user_id, story_id)
        settings = await goal_settings(db_session, user_id)
        today = datetime.now(UTC).astimezone(zone(settings.timezone)).date()
        goal = await db_session.scalar(select(StoryGoal).where(StoryGoal.story_id == story_id))
        if goal is None:
            goal = StoryGoal(
                user_id=user_id,
                story_id=story_id,
                baseline_words=await story_words(db_session, story_id),
                start_day=today,
            )
            db_session.add(goal)
        goal.target_words, goal.deadline, goal.daily_words = (
            data.target_words,
            data.deadline,
            data.daily_words,
        )
        await db_session.flush()
        return await story_goal_envelope(db_session, user_id, story_id)

    @delete(summary="Remove this story's goal", status_code=204)
    async def remove(self, request: Request, db_session: AsyncSession, story_id: UUID) -> None:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        await owned_story(db_session, user_id, story_id)
        goal = await db_session.scalar(select(StoryGoal).where(StoryGoal.story_id == story_id))
        if goal is not None:
            await db_session.delete(goal)
