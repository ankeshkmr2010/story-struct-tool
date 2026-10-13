"""Private, version-bound beta reading. No owner manuscript permissions are relaxed."""

import hashlib
import json
import re
import secrets
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.exceptions import ClientException, NotFoundException, PermissionDeniedException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.ai.commands import owned_story
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.auth.models import User
from storytool.domain.narrative.prose import compile_manuscript
from storytool.domain.story.models import Story
from storytool.domain.story.sharing import SharedDocumentOut, SharedStoryOut, actor, lock_source
from storytool.domain.versioning.service import fingerprint, full_state


class BetaRound(StoryToolBase):
    __tablename__ = "beta_round"
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    brief: Mapped[str] = mapped_column(Text, default="")
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    status: Mapped[str] = mapped_column(String(20), default="open")
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    source_fingerprint: Mapped[str] = mapped_column(String(64))
    token: Mapped[str] = mapped_column(String(64), unique=True)
    link_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_approve: Mapped[bool] = mapped_column(Boolean, default=False)


class BetaMember(StoryToolBase):
    __tablename__ = "beta_member"
    __table_args__ = (UniqueConstraint("round_id", "user_id", name="one_beta_member"),)
    round_id: Mapped[UUID] = mapped_column(ForeignKey("beta_round.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    read_chapters: Mapped[list[str]] = mapped_column(JSONB, default=list)
    reading_status: Mapped[str] = mapped_column(String(20), default="not_started")
    stopped_reason: Mapped[str | None] = mapped_column(Text, default=None)


class BetaThread(StoryToolBase):
    __tablename__ = "beta_thread"
    round_id: Mapped[UUID] = mapped_column(ForeignKey("beta_round.id", ondelete="CASCADE"), index=True)
    reader_id: Mapped[UUID | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    chapter_id: Mapped[UUID | None] = mapped_column(default=None)
    scene_id: Mapped[UUID | None] = mapped_column(default=None)
    quote: Mapped[str | None] = mapped_column(Text, default=None)
    paragraph: Mapped[int | None] = mapped_column(default=None)
    prose_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)


class BetaMessage(StoryToolBase):
    __tablename__ = "beta_message"
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("beta_thread.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    submitted: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class BetaPoll(StoryToolBase):
    __tablename__ = "beta_poll"
    round_id: Mapped[UUID] = mapped_column(ForeignKey("beta_round.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(default=None)
    question: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20), default="single")
    options: Mapped[list[str]] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    show_results: Mapped[bool] = mapped_column(Boolean, default=False)
    anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(default=1)
    previous_id: Mapped[UUID | None] = mapped_column(ForeignKey("beta_poll.id", ondelete="SET NULL"), default=None)


class BetaVote(StoryToolBase):
    __tablename__ = "beta_vote"
    __table_args__ = (UniqueConstraint("poll_id", "user_id", name="one_beta_vote"),)
    poll_id: Mapped[UUID] = mapped_column(ForeignKey("beta_poll.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("app_user.id", ondelete="SET NULL"))
    choices: Mapped[list[int]] = mapped_column(JSONB, default=list)
    answer: Mapped[str] = mapped_column(Text, default="")


class RoundIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(default="", max_length=5000)
    deadline: datetime | None = None
    chapter_ids: list[UUID] | None = Field(default=None, max_length=1000)
    auto_approve: bool = False

    @field_validator("title")
    @classmethod
    def title_nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give the round a title")
        return value.strip()

    @field_validator("deadline")
    @classmethod
    def aware_deadline(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("Include a timezone in the deadline")
        return value


class RoundUpdate(BaseModel):
    status: Literal["open", "closed"] | None = None
    link_enabled: bool | None = None
    auto_approve: bool | None = None


class RoundOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    story_id: UUID
    title: str
    brief: str
    deadline: datetime | None
    status: str
    created_at: datetime
    auto_approve: bool
    link_enabled: bool
    join_path: str | None = None


class MemberOut(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    email: str
    status: str
    read_chapters: list[str]
    reading_status: str
    stopped_reason: str | None


class MemberUpdate(BaseModel):
    status: Literal["approved", "declined", "revoked"]


class ProgressIn(BaseModel):
    read_chapters: list[UUID] = Field(max_length=1000)
    reading_status: Literal["not_started", "reading", "finished", "stopped"]
    stopped_reason: str | None = Field(default=None, max_length=1000)


class BetaDocumentOut(SharedDocumentOut):
    round: RoundOut
    is_owner: bool
    read_chapters: list[str]
    reading_status: str
    stopped_reason: str | None


class InviteOut(BaseModel):
    round: RoundOut
    story_title: str
    membership: str


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    submitted: bool = True

    @field_validator("body")
    @classmethod
    def body_nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write a message")
        return value.strip()


class ThreadIn(MessageIn):
    chapter_id: UUID | None = None
    scene_id: UUID | None = None
    quote: str | None = Field(default=None, max_length=2000)
    paragraph: int | None = Field(default=None, ge=0, le=100000)


class BetaThreadUpdate(BaseModel):
    submitted: bool | None = None
    resolved: bool | None = None


class MessageOut(BaseModel):
    id: UUID
    name: str
    body: str
    submitted: bool
    deleted: bool
    mine: bool
    created_at: datetime
    updated_at: datetime


class BetaThreadOut(BaseModel):
    id: UUID
    round_id: UUID
    reader_id: UUID | None
    chapter_id: UUID | None
    scene_id: UUID | None
    quote: str | None
    paragraph: int | None
    submitted: bool
    resolved: bool
    mine: bool
    created_at: datetime
    url: str
    messages: list[MessageOut]
    message_count: int


class PollIn(BaseModel):
    round_id: UUID
    chapter_id: UUID | None = None
    question: str = Field(min_length=1, max_length=1000)
    kind: Literal["single", "multiple", "text"] = "single"
    options: list[str] = Field(default_factory=list, max_length=20)
    status: Literal["draft", "open", "closed", "archived"] = "draft"
    show_results: bool = False
    anonymous: bool = False

    @model_validator(mode="after")
    def valid_question(self) -> "PollIn":
        self.question = self.question.strip()
        self.options = [option.strip() for option in self.options]
        if not self.question:
            raise ValueError("Write a question")
        if self.kind == "text":
            self.options = []
        elif not 2 <= len(self.options) <= 20 or any(not x or len(x) > 200 for x in self.options):
            raise ValueError("Choice polls need 2–20 options, each 1–200 characters")
        if len({x.casefold() for x in self.options}) != len(self.options):
            raise ValueError("Poll options must be distinct")
        return self


class VoteIn(BaseModel):
    choices: list[int] = Field(default_factory=list, max_length=20)
    answer: str = Field(default="", max_length=4000)


class PollResponseOut(BaseModel):
    name: str | None
    choices: list[int]
    answer: str


class PollResultsOut(BaseModel):
    total: int
    counts: list[int]
    responses: list[PollResponseOut] | None = None


class PollOut(BaseModel):
    id: UUID
    round_id: UUID
    chapter_id: UUID | None
    question: str
    kind: str
    options: list[str]
    status: str
    show_results: bool
    anonymous: bool
    version: int
    previous_id: UUID | None
    my_response: VoteIn | None
    results: PollResultsOut | None


def round_out(row: BetaRound, owner: bool = False) -> RoundOut:
    return RoundOut.model_validate(row).model_copy(
        update={"join_path": f"/beta/join/{row.token}" if owner else None}
    )


async def round_access(db: AsyncSession, request: Request, round_id: UUID, *, owner_only: bool = False, write: bool = False) -> tuple[BetaRound, Story, BetaMember | None, bool]:
    row = await db.get(BetaRound, round_id)
    story = await db.get(Story, row.story_id) if row else None
    if row is None or story is None or story.deleted_at is not None:
        raise NotFoundException(detail="Beta round is unavailable")
    owner = story.user_id == actor(request)
    member = None if owner else await db.scalar(select(BetaMember).where(
        BetaMember.round_id == row.id, BetaMember.user_id == actor(request), BetaMember.status == "approved",
    ))
    if not owner and (owner_only or member is None):
        raise NotFoundException(detail="Beta access is unavailable or revoked")
    if write:
        await lock_source(db, story.id)
        await db.refresh(row)
        if not owner:
            await db.refresh(member)
            if member.status != "approved":
                raise NotFoundException(detail="Beta access was revoked")
        await db.refresh(story)
        if story.deleted_at is not None:
            raise NotFoundException(detail="Beta round is unavailable")
        if row.status != "open":
            raise ClientException(status_code=409, detail="This round is closed to feedback")
    return row, story, member, owner


async def owner_round(db: AsyncSession, request: Request, story_id: UUID, round_id: UUID) -> BetaRound:
    row, story, _, _ = await round_access(db, request, round_id, owner_only=True)
    if story.id != story_id:
        raise NotFoundException(detail="Round not found")
    await lock_source(db, story_id)
    await db.refresh(row)
    await db.refresh(story)
    if story.deleted_at is not None:
        raise NotFoundException(detail="Story is in Trash")
    return row


async def invite_info(db: AsyncSession, request: Request, token: str) -> InviteOut:
    row = await db.scalar(select(BetaRound).join(Story).where(
        BetaRound.token == token, BetaRound.link_enabled.is_(True),
        BetaRound.status == "open", Story.deleted_at.is_(None),
    ))
    if row is None:
        raise NotFoundException(detail="This beta invitation is unavailable")
    story = await db.get(Story, row.story_id)
    member = await db.scalar(select(BetaMember).where(
        BetaMember.round_id == row.id, BetaMember.user_id == actor(request),
    ))
    return InviteOut(
        round=round_out(row), story_title=row.snapshot["title"],
        membership="owner" if story.user_id == actor(request) else member.status if member else "none",
    )


async def thread_access(db: AsyncSession, request: Request, thread_id: UUID, write: bool = False) -> tuple[BetaThread, BetaRound, bool]:
    thread = await db.get(BetaThread, thread_id)
    if thread is None:
        raise NotFoundException(detail="Comment not found")
    row, _, _, owner = await round_access(db, request, thread.round_id, write=write)
    if thread.reader_id != actor(request) and (not owner or not thread.submitted):
        raise NotFoundException(detail="Comment not found")
    if write:
        await db.refresh(thread)
    return thread, row, owner


async def thread_out(db: AsyncSession, request: Request, thread: BetaThread, summary: bool = False) -> BetaThreadOut:
    scope = (BetaMessage.thread_id == thread.id, or_(BetaMessage.submitted.is_(True), BetaMessage.user_id == actor(request)))
    count = await db.scalar(select(func.count()).select_from(BetaMessage).where(*scope))
    query = select(BetaMessage).where(*scope).order_by(BetaMessage.created_at, BetaMessage.id)
    posts = await db.scalars(query.limit(1) if summary else query)
    return BetaThreadOut(
        id=thread.id, round_id=thread.round_id, reader_id=thread.reader_id, chapter_id=thread.chapter_id, scene_id=thread.scene_id,
        quote=thread.quote, paragraph=thread.paragraph, submitted=thread.submitted, resolved=thread.resolved,
        mine=thread.reader_id == actor(request), created_at=thread.created_at,
        url=f"/beta/rounds/{thread.round_id}/threads/{thread.id}",
        message_count=count or 0, messages=[MessageOut(
            id=p.id, name=p.name, body=p.body, submitted=p.submitted, deleted=p.deleted,
            mine=p.user_id == actor(request), created_at=p.created_at, updated_at=p.updated_at,
        ) for p in posts if p.submitted or p.user_id == actor(request)],
    )


async def poll_out(db: AsyncSession, request: Request, poll: BetaPoll, owner: bool) -> PollOut:
    votes = (await db.scalars(select(BetaVote).where(BetaVote.poll_id == poll.id))).all()
    mine = next((v for v in votes if v.user_id == actor(request)), None)
    visible = owner or (poll.show_results and (mine is not None or poll.status in {"closed", "archived"}))
    results = None
    if visible:
        results = dict(total=len(votes), counts=[sum(i in v.choices for v in votes) for i in range(len(poll.options))])
        if owner or poll.kind == "text":
            people = {}
            if owner and not poll.anonymous:
                ids = [v.user_id for v in votes if v.user_id]
                people = {u.id: u.name or u.email for u in await db.scalars(select(User).where(User.id.in_(ids)))}
            results["responses"] = [dict(
                name=people.get(v.user_id) if owner and not poll.anonymous else None,
                choices=v.choices, answer=v.answer,
            ) for v in votes]
    return PollOut(
        id=poll.id, round_id=poll.round_id, chapter_id=poll.chapter_id, question=poll.question,
        kind=poll.kind, options=poll.options, status=poll.status, show_results=poll.show_results,
        anonymous=poll.anonymous, version=poll.version, previous_id=poll.previous_id,
        my_response=VoteIn(choices=mine.choices, answer=mine.answer) if mine else None, results=results,
    )


class BetaOwnerController(Controller):
    path = "/api/beta/manage/{story_id:uuid}"
    tags = ["beta"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/rounds")
    async def rounds(self, request: Request, db_session: AsyncSession, story_id: UUID) -> list[RoundOut]:
        await owned_story(db_session, story_id, actor(request))
        rows = await db_session.scalars(select(BetaRound).where(BetaRound.story_id == story_id).order_by(BetaRound.created_at.desc()))
        return [round_out(row, True) for row in rows]

    @post("/rounds", status_code=201)
    async def publish(self, request: Request, db_session: AsyncSession, story_id: UUID, data: RoundIn) -> RoundOut:
        await lock_source(db_session, story_id)
        source = await owned_story(db_session, story_id, actor(request))
        state = await full_state(db_session, story_id)
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None or source.deleted_at is not None:
            raise NotFoundException(detail="Story unavailable")
        selected = {str(id_) for id_ in data.chapter_ids} if data.chapter_ids is not None else {str(c.id) for c in graph.chapters}
        if not selected or not selected <= {str(c.id) for c in graph.chapters}:
            raise ClientException(detail="Choose chapters belonging to this story")
        chapters = tuple(c for c in graph.chapters if str(c.id) in selected)
        scenes = tuple(s for s in graph.scenes if str(s.chapter_id) in selected)
        if not any((s.content or "").strip() for s in scenes):
            raise ClientException(detail="Draft some prose before publishing a beta round")
        user = await db_session.get(User, actor(request))
        author_name = user.author_name if user else None
        snapshot = dict(
            title=source.title, blurb=source.blurb, author_name=author_name,
            manuscript=compile_manuscript(replace(graph, chapters=chapters, scenes=scenes), include_unplaced=False, author_name=author_name, include_planning=False),
            structure={
                "chapter": [{k: c[k] for k in ("id", "title", "number", "sort_key", "epigraph", "opening_note", "closing_note")} for c in state["chapter"] if str(c["id"]) in selected],
                "scene": [{k: s[k] for k in ("id", "title", "chapter_id", "sort_key", "content")} for s in state["scene"] if str(s["chapter_id"]) in selected],
            },
        )
        row = BetaRound(story_id=story_id, title=data.title, brief=data.brief, deadline=data.deadline,
                        auto_approve=data.auto_approve, token=secrets.token_urlsafe(32), snapshot=json.loads(json.dumps(snapshot, default=str)), source_fingerprint=fingerprint(state))
        db_session.add(row)
        await db_session.flush()
        return round_out(row, True)

    @patch("/rounds/{round_id:uuid}")
    async def update_round(self, request: Request, db_session: AsyncSession, story_id: UUID, round_id: UUID, data: RoundUpdate) -> RoundOut:
        row = await owner_round(db_session, request, story_id, round_id)
        for key, value in data.model_dump(exclude_none=True).items():
            setattr(row, key, value)
        if row.status == "closed":
            for poll in await db_session.scalars(select(BetaPoll).where(BetaPoll.round_id == row.id, BetaPoll.status == "open")):
                poll.status = "closed"
        await db_session.flush()
        return round_out(row, True)

    @post("/rounds/{round_id:uuid}/rotate")
    async def rotate(self, request: Request, db_session: AsyncSession, story_id: UUID, round_id: UUID) -> RoundOut:
        row = await owner_round(db_session, request, story_id, round_id)
        row.token = secrets.token_urlsafe(32)
        await db_session.flush()
        return round_out(row, True)

    @get("/rounds/{round_id:uuid}/members")
    async def members(self, request: Request, db_session: AsyncSession, story_id: UUID, round_id: UUID) -> list[MemberOut]:
        await owner_round(db_session, request, story_id, round_id)
        rows = await db_session.execute(select(BetaMember, User).join(User, User.id == BetaMember.user_id).where(BetaMember.round_id == round_id).order_by(BetaMember.created_at))
        return [MemberOut(id=m.id, user_id=m.user_id, name=u.name or "Reader", email=u.email, status=m.status, read_chapters=m.read_chapters, reading_status=m.reading_status, stopped_reason=m.stopped_reason) for m, u in rows]

    @patch("/rounds/{round_id:uuid}/members/{member_id:uuid}", status_code=204)
    async def member_status(self, request: Request, db_session: AsyncSession, story_id: UUID, round_id: UUID, member_id: UUID, data: MemberUpdate) -> None:
        row = await owner_round(db_session, request, story_id, round_id)
        member = await db_session.get(BetaMember, member_id)
        if member is None or member.round_id != row.id:
            raise NotFoundException(detail="Reader not found")
        if data.status == "approved" and row.status != "open":
            raise ClientException(detail="Reopen this round before admitting readers")
        member.status = data.status

    @get("/polls")
    async def polls(self, request: Request, db_session: AsyncSession, story_id: UUID) -> list[PollOut]:
        await owned_story(db_session, story_id, actor(request))
        rows = await db_session.scalars(select(BetaPoll).join(BetaRound).where(BetaRound.story_id == story_id).order_by(BetaPoll.created_at.desc()))
        return [await poll_out(db_session, request, p, True) for p in rows]

    @post("/polls", status_code=201)
    async def create_poll(self, request: Request, db_session: AsyncSession, story_id: UUID, data: PollIn) -> PollOut:
        row = await owner_round(db_session, request, story_id, data.round_id)
        validate_poll_chapter(row, data.chapter_id)
        if data.status == "open" and row.status != "open":
            raise ClientException(detail="Reopen the beta round before publishing a poll")
        poll = BetaPoll(**data.model_dump())
        db_session.add(poll)
        await db_session.flush()
        return await poll_out(db_session, request, poll, True)

    @patch("/polls/{poll_id:uuid}")
    async def update_poll(self, request: Request, db_session: AsyncSession, story_id: UUID, poll_id: UUID, data: PollIn) -> PollOut:
        poll = await db_session.get(BetaPoll, poll_id)
        if poll is None:
            raise NotFoundException(detail="Poll not found")
        await owner_round(db_session, request, story_id, poll.round_id)
        await db_session.refresh(poll)
        target = await owner_round(db_session, request, story_id, data.round_id)
        validate_poll_chapter(target, data.chapter_id)
        if data.status == "open" and target.status != "open":
            raise ClientException(detail="Reopen the beta round before publishing a poll")
        changed = any(getattr(poll, k) != getattr(data, k) for k in ("round_id", "chapter_id", "question", "kind", "options", "anonymous"))
        count = await db_session.scalar(select(func.count()).select_from(BetaVote).where(BetaVote.poll_id == poll.id))
        if changed and count:
            poll.status = "archived"
            poll = BetaPoll(**data.model_dump(), version=poll.version + 1, previous_id=poll.id)
            db_session.add(poll)
        else:
            for key, value in data.model_dump().items():
                setattr(poll, key, value)
        await db_session.flush()
        return await poll_out(db_session, request, poll, True)

    @delete("/polls/{poll_id:uuid}")
    async def delete_poll(self, request: Request, db_session: AsyncSession, story_id: UUID, poll_id: UUID, confirm: bool = False) -> None:
        poll = await db_session.get(BetaPoll, poll_id)
        if poll is None:
            raise NotFoundException(detail="Poll not found")
        await owner_round(db_session, request, story_id, poll.round_id)
        count = await db_session.scalar(select(func.count()).select_from(BetaVote).where(BetaVote.poll_id == poll.id))
        if count and not confirm:
            raise ClientException(status_code=409, detail="This poll has responses. Archive it, or explicitly confirm deletion.")
        await db_session.delete(poll)


def validate_poll_chapter(row: BetaRound, chapter_id: UUID | None) -> None:
    if chapter_id and str(chapter_id) not in {c["id"] for c in row.snapshot["structure"]["chapter"]}:
        raise ClientException(detail="Chapter is not part of this beta round")


class BetaReaderController(Controller):
    path = "/api/beta"
    tags = ["beta"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/invite/{token:str}")
    async def invite(self, request: Request, db_session: AsyncSession, token: str) -> InviteOut:
        return await invite_info(db_session, request, token)

    @post("/invite/{token:str}")
    async def join(self, request: Request, db_session: AsyncSession, token: str) -> InviteOut:
        info = await invite_info(db_session, request, token)
        row = await db_session.get(BetaRound, info.round.id)
        await lock_source(db_session, row.story_id)
        await db_session.refresh(row)
        source = await db_session.get(Story, row.story_id)
        await db_session.refresh(source)
        if source.deleted_at is not None:
            raise NotFoundException(detail="This invitation is unavailable")
        if not row.link_enabled or row.status != "open" or row.token != token:
            raise NotFoundException(detail="This invitation is no longer available")
        if info.membership == "owner":
            return info
        member = await db_session.scalar(select(BetaMember).where(BetaMember.round_id == row.id, BetaMember.user_id == actor(request)))
        if member and member.status in {"revoked", "declined"}:
            raise PermissionDeniedException(detail="Ask the author to restore your access")
        if member is None:
            member = BetaMember(round_id=row.id, user_id=actor(request), status="approved" if row.auto_approve else "pending")
            db_session.add(member)
        await db_session.flush()
        return InviteOut(round=round_out(row), story_title=row.snapshot["title"], membership=member.status)

    @get("/rounds/{round_id:uuid}")
    async def read(self, request: Request, db_session: AsyncSession, round_id: UUID) -> BetaDocumentOut:
        row, _, member, owner = await round_access(db_session, request, round_id)
        snapshot = row.snapshot
        return BetaDocumentOut(
            share=SharedStoryOut(story_id=row.story_id, title=snapshot["title"], premise=None, blurb=snapshot.get("blurb"), owner_name=snapshot.get("author_name") or "StoryTool author", allow_import=False),
            manuscript=snapshot["manuscript"], structure=snapshot["structure"], base_fingerprint=row.source_fingerprint,
            round=round_out(row), is_owner=owner,
            read_chapters=member.read_chapters if member else [], reading_status=member.reading_status if member else "not_started", stopped_reason=member.stopped_reason if member else None,
        )

    @patch("/rounds/{round_id:uuid}/progress", status_code=204)
    async def progress(self, request: Request, db_session: AsyncSession, round_id: UUID, data: ProgressIn) -> None:
        row, source, member, owner = await round_access(db_session, request, round_id)
        if owner or member is None:
            raise PermissionDeniedException(detail="Only readers have reading progress")
        await lock_source(db_session, row.story_id)
        await db_session.refresh(member)
        await db_session.refresh(source)
        if source.deleted_at is not None:
            raise NotFoundException(detail="Beta round is unavailable")
        if member.status != "approved":
            raise NotFoundException(detail="Access revoked")
        valid = {c["id"] for c in row.snapshot["structure"]["chapter"]}
        if not {str(id_) for id_ in data.read_chapters} <= valid:
            raise ClientException(detail="Chapter is not in this round")
        member.read_chapters = list(dict.fromkeys(str(id_) for id_ in data.read_chapters))
        member.reading_status = data.reading_status
        member.stopped_reason = data.stopped_reason

    @get("/rounds/{round_id:uuid}/threads")
    async def threads(self, request: Request, db_session: AsyncSession, round_id: UUID) -> list[BetaThreadOut]:
        _, _, _, owner = await round_access(db_session, request, round_id)
        query = select(BetaThread).where(BetaThread.round_id == round_id)
        query = query.where(BetaThread.submitted.is_(True)) if owner else query.where(BetaThread.reader_id == actor(request))
        rows = await db_session.scalars(query.order_by(BetaThread.updated_at.desc()))
        return [await thread_out(db_session, request, t, summary=True) for t in rows]

    @post("/rounds/{round_id:uuid}/threads", status_code=201)
    async def comment(self, request: Request, db_session: AsyncSession, round_id: UUID, data: ThreadIn) -> BetaThreadOut:
        row, _, _, owner = await round_access(db_session, request, round_id, write=True)
        chapters = {c["id"] for c in row.snapshot["structure"]["chapter"]}
        scene = next((s for s in row.snapshot["structure"]["scene"] if s["id"] == str(data.scene_id)), None)
        if data.scene_id and scene is None or data.chapter_id and str(data.chapter_id) not in chapters:
            raise ClientException(detail="Comment target is not part of this round")
        if scene and data.chapter_id and str(data.chapter_id) != scene["chapter_id"]:
            raise ClientException(detail="Scene belongs to a different chapter")
        if data.quote:
            if scene is None:
                raise ClientException(detail="Select a scene for a passage comment")
            content = scene.get("content") or ""
            if data.paragraph is not None:
                paragraphs = [p for p in re.split(r"\n\s*\n", content) if p.strip()]
                if data.paragraph >= len(paragraphs):
                    raise ClientException(detail="Passage is unavailable")
                content = paragraphs[data.paragraph]
            normalized = " ".join(content.split())
            quote = " ".join(data.quote.split())
            first = normalized.find(quote)
            if not quote or first < 0 or normalized.find(quote, first + 1) >= 0:
                raise ClientException(detail="Select a longer, unique passage within one scene")
        thread = BetaThread(round_id=row.id, reader_id=actor(request), chapter_id=UUID(scene["chapter_id"]) if scene else data.chapter_id, scene_id=data.scene_id, quote=data.quote, paragraph=data.paragraph,
                            prose_hash=hashlib.sha256((scene.get("content") or "").encode()).hexdigest() if scene else None, submitted=data.submitted)
        db_session.add(thread)
        await db_session.flush()
        user = await db_session.get(User, actor(request))
        db_session.add(BetaMessage(thread_id=thread.id, user_id=user.id, name=(user.author_name or "Author") if owner else user.name or "Reader", body=data.body, submitted=data.submitted))
        await db_session.flush()
        return await thread_out(db_session, request, thread)

    @get("/threads/{thread_id:uuid}")
    async def thread(self, request: Request, db_session: AsyncSession, thread_id: UUID) -> BetaThreadOut:
        row, _, _ = await thread_access(db_session, request, thread_id)
        return await thread_out(db_session, request, row)

    @patch("/threads/{thread_id:uuid}")
    async def change_thread(self, request: Request, db_session: AsyncSession, thread_id: UUID, data: BetaThreadUpdate) -> BetaThreadOut:
        row, round_, owner = await thread_access(db_session, request, thread_id, write=data.submitted is not None)
        await lock_source(db_session, round_.story_id)
        if data.resolved is not None:
            if not owner:
                raise PermissionDeniedException(detail="Only the author resolves feedback")
            row.resolved = data.resolved
        if data.submitted is not None:
            if row.reader_id != actor(request) or row.submitted:
                raise ClientException(detail="Only an unsubmitted reader draft can be submitted")
            row.submitted = data.submitted
            for message in await db_session.scalars(select(BetaMessage).where(BetaMessage.thread_id == row.id, BetaMessage.user_id == actor(request))):
                message.submitted = data.submitted
        await db_session.flush()
        return await thread_out(db_session, request, row)

    @post("/threads/{thread_id:uuid}/messages", status_code=201)
    async def reply(self, request: Request, db_session: AsyncSession, thread_id: UUID, data: MessageIn) -> BetaThreadOut:
        thread, _, owner = await thread_access(db_session, request, thread_id, write=True)
        if not thread.submitted and data.submitted:
            raise ClientException(detail="Submit the original draft first")
        user = await db_session.get(User, actor(request))
        db_session.add(BetaMessage(thread_id=thread.id, user_id=user.id, name=(user.author_name or "Author") if owner else user.name or "Reader", **data.model_dump()))
        if data.submitted:
            thread.updated_at = datetime.now(UTC)
        await db_session.flush()
        return await thread_out(db_session, request, thread)

    @patch("/messages/{message_id:uuid}")
    async def edit_message(self, request: Request, db_session: AsyncSession, message_id: UUID, data: MessageIn) -> BetaThreadOut:
        message = await db_session.get(BetaMessage, message_id)
        if message is None or message.user_id != actor(request) or message.deleted:
            raise NotFoundException(detail="Message not found")
        thread, _, _ = await thread_access(db_session, request, message.thread_id, write=True)
        await db_session.refresh(message)
        if message.deleted:
            raise NotFoundException(detail="Message not found")
        if message.submitted and not data.submitted:
            raise ClientException(detail="Submitted messages cannot be made private again")
        if not thread.submitted and data.submitted:
            raise ClientException(detail="Submit the original draft first")
        message.body, message.submitted = data.body, data.submitted
        if data.submitted:
            thread.updated_at = datetime.now(UTC)
        await db_session.flush()
        return await thread_out(db_session, request, thread)

    @delete("/messages/{message_id:uuid}")
    async def remove_message(self, request: Request, db_session: AsyncSession, message_id: UUID) -> None:
        message = await db_session.get(BetaMessage, message_id)
        if message is None or message.user_id != actor(request):
            raise NotFoundException(detail="Message not found")
        await thread_access(db_session, request, message.thread_id, write=True)
        message.body, message.deleted = "", True

    @get("/rounds/{round_id:uuid}/polls")
    async def reader_polls(self, request: Request, db_session: AsyncSession, round_id: UUID) -> list[PollOut]:
        _, _, _, owner = await round_access(db_session, request, round_id)
        query = select(BetaPoll).where(BetaPoll.round_id == round_id)
        if not owner:
            query = query.where(BetaPoll.status.in_(["open", "closed", "archived"]))
        rows = await db_session.scalars(query.order_by(BetaPoll.created_at))
        return [await poll_out(db_session, request, p, owner) for p in rows]

    @post("/polls/{poll_id:uuid}/vote")
    async def vote(self, request: Request, db_session: AsyncSession, poll_id: UUID, data: VoteIn) -> PollOut:
        poll = await db_session.get(BetaPoll, poll_id)
        if poll is None:
            raise NotFoundException(detail="Poll not found")
        _, _, _, owner = await round_access(db_session, request, poll.round_id, write=True)
        await db_session.refresh(poll)
        if owner:
            raise PermissionDeniedException(detail="Authors cannot vote in reader polls")
        if poll.status != "open":
            raise ClientException(status_code=409, detail="This poll is closed")
        if poll.kind == "text":
            if not data.answer.strip() or data.choices:
                raise ClientException(detail="Write an answer for this question")
        elif not data.choices or len(set(data.choices)) != len(data.choices) or any(i < 0 or i >= len(poll.options) for i in data.choices) or poll.kind == "single" and len(data.choices) != 1 or data.answer:
            raise ClientException(detail="Choose valid options for this poll")
        existing = await db_session.scalar(select(BetaVote).where(BetaVote.poll_id == poll.id, BetaVote.user_id == actor(request)))
        if existing:
            existing.choices, existing.answer = data.choices, data.answer.strip()
        else:
            db_session.add(BetaVote(poll_id=poll.id, user_id=actor(request), choices=data.choices, answer=data.answer.strip()))
        await db_session.flush()
        return await poll_out(db_session, request, poll, False)
