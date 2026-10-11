"""Opt-in public showcase: a random-token, read-only view for people without an account.

The public route skips StoryAccessMiddleware, so it returns only the same visible graph as
email shares (no notes) plus version metadata and change summaries, never states or prompts.
"""

import secrets
from datetime import datetime
from typing import Any
from uuid import UUID

from litestar import Controller, Request, get, post, put
from litestar.exceptions import NotFoundException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Boolean, ForeignKey, String, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.ai.commands import owned_story
from storytool.domain.ai.models import AIRun
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.auth.models import User
from storytool.domain.narrative.prose import compile_manuscript
from storytool.domain.story.authorship import FieldAuthorship
from storytool.domain.story.models import Story
from storytool.domain.story.sharing import actor, visible_state
from storytool.domain.versioning.models import StoryVersion
from storytool.domain.versioning.service import full_state


class StoryShowcase(StoryToolBase):
    __tablename__ = "story_showcase"

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), unique=True)
    token: Mapped[str] = mapped_column(String(64), unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class ShowcaseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class ShowcaseOut(BaseModel):
    enabled: bool
    token: str | None


class ShowcaseVersionOut(BaseModel):
    number: int
    label: str
    source: str
    created_at: datetime
    word_count: int | None


class ShowcaseChangeOut(BaseModel):
    summary: str
    status: str
    created_at: datetime


class ShowcaseDocumentOut(BaseModel):
    title: str
    premise: str | None
    blurb: str | None
    genre: str | None
    owner_name: str
    updated_at: datetime
    manuscript: str
    structure: dict[str, list[dict[str, Any]]]
    versions: list[ShowcaseVersionOut]
    authorship: dict[str, int]
    changes: list[ShowcaseChangeOut]


def new_token() -> str:
    return secrets.token_urlsafe(24)


def showcase_out(record: StoryShowcase | None) -> ShowcaseOut:
    if record is None:
        return ShowcaseOut(enabled=False, token=None)
    return ShowcaseOut(enabled=record.enabled, token=record.token if record.enabled else None)


async def showcase_record(db: AsyncSession, story_id: UUID) -> StoryShowcase | None:
    return await db.scalar(select(StoryShowcase).where(StoryShowcase.story_id == story_id))


class StoryShowcaseController(Controller):
    path = "/api/stories/{story_id:uuid}/showcase"
    tags = ["sharing"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get()
    async def get_showcase(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> ShowcaseOut:
        await owned_story(db_session, story_id, actor(request))
        return showcase_out(await showcase_record(db_session, story_id))

    @put()
    async def set_showcase(
        self, db_session: AsyncSession, request: Request, story_id: UUID, data: ShowcaseInput
    ) -> ShowcaseOut:
        await owned_story(db_session, story_id, actor(request))
        record = await showcase_record(db_session, story_id)
        if record is None:
            record = StoryShowcase(story_id=story_id, token=new_token(), enabled=data.enabled)
            db_session.add(record)
        else:
            record.enabled = data.enabled
        await db_session.flush()
        return showcase_out(record)

    @post("/rotate", status_code=200)
    async def rotate(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> ShowcaseOut:
        await owned_story(db_session, story_id, actor(request))
        record = await showcase_record(db_session, story_id)
        if record is None:
            raise NotFoundException(detail="Turn on the showcase first")
        record.token = new_token()
        await db_session.flush()
        return showcase_out(record)


class PublicShowcaseController(Controller):
    path = "/api/showcase"
    tags = ["sharing"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/{token:str}")
    async def read_showcase(self, db_session: AsyncSession, token: str) -> ShowcaseDocumentOut:
        row = (
            await db_session.execute(
                select(Story, User)
                .join(StoryShowcase, StoryShowcase.story_id == Story.id)
                .join(User, User.id == Story.user_id)
                .where(
                    StoryShowcase.token == token,
                    StoryShowcase.enabled.is_(True),
                    Story.deleted_at.is_(None),
                )
            )
        ).one_or_none()
        if row is None:
            raise NotFoundException(detail="This showcase is unavailable")
        story, owner = row
        state = await full_state(db_session, story.id)
        graph = await load_graph_by_id(db_session, story.id)
        assert graph is not None
        versions = await db_session.scalars(
            select(StoryVersion)
            .where(StoryVersion.story_id == story.id)
            .order_by(StoryVersion.number.desc())
            .limit(100)
        )
        origins = await db_session.execute(
            select(FieldAuthorship.origin, func.count())
            .where(FieldAuthorship.story_id == story.id)
            .group_by(FieldAuthorship.origin)
        )
        runs = await db_session.scalars(
            select(AIRun)
            .where(AIRun.story_id == story.id, AIRun.status.in_(("applied", "undone")))
            .order_by(AIRun.created_at.desc())
            .limit(50)
        )
        return ShowcaseDocumentOut(
            title=story.title,
            premise=story.premise,
            blurb=story.blurb,
            genre=story.genre,
            owner_name=owner.name or "StoryTool author",
            updated_at=story.updated_at,
            manuscript=compile_manuscript(graph),
            structure=visible_state(state),
            versions=[
                ShowcaseVersionOut(
                    number=v.number,
                    label=v.label,
                    source=v.source,
                    created_at=v.created_at,
                    word_count=(v.statistics or {}).get("word_count"),
                )
                for v in versions
            ],
            authorship={origin: count for origin, count in origins.all()},
            changes=[
                ShowcaseChangeOut(summary=r.summary, status=r.status, created_at=r.created_at)
                for r in runs
            ],
        )
