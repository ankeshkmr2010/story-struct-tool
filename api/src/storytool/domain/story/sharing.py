"""Email-scoped read access and explicit independent imports. No owner API is relaxed."""

import copy
import hashlib
from typing import Any
from uuid import UUID

from litestar import Controller, Request, delete, get, post, put
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from uuid_utils import uuid7

from storytool.db.base import StoryToolBase
from storytool.domain.ai.commands import ENTITIES, LINKS, owned_story
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.auth.models import User
from storytool.domain.narrative.prose import compile_manuscript
from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryOut
from storytool.domain.versioning.service import (
    EXTRAS,
    checkpoint,
    fingerprint,
    full_state,
    restore_state,
)


class StoryShare(StoryToolBase):
    __tablename__ = "story_share"
    __table_args__ = (UniqueConstraint("story_id", "recipient_email", name="uq_story_recipient"),)

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    recipient_email: Mapped[str] = mapped_column(String(320), index=True)
    allow_import: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class ShareInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient_email: str = Field(max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    allow_import: bool = False

    @field_validator("recipient_email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> Any:
        return value.strip().casefold() if isinstance(value, str) else value


class ShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    recipient_email: str
    allow_import: bool


class SharedStoryOut(BaseModel):
    story_id: UUID
    title: str
    premise: str | None
    blurb: str | None
    owner_name: str
    allow_import: bool


class SharedDocumentOut(BaseModel):
    share: SharedStoryOut
    manuscript: str
    structure: dict[str, list[dict[str, Any]]]
    base_fingerprint: str


class SharedImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_fingerprint: str = Field(min_length=64, max_length=64)


class StoryActivityOut(BaseModel):
    change_token: str


def activity(source: Story) -> StoryActivityOut:
    return StoryActivityOut(
        change_token=hashlib.sha256(str(source.updated_at).encode()).hexdigest()
    )


def visible_state(state: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {
        kind: [{key: value for key, value in row.items() if key != "notes"} for row in state[kind]]
        for kind in (*ENTITIES, *LINKS)
    }


def actor(request: Request) -> UUID:
    return request.scope["state"]["storytool_user_id"]


async def lock_source(db: AsyncSession, story_id: UUID) -> None:
    # Same source lock as owner writes/revocation: copy one consistent state and recheck access.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": int.from_bytes(story_id.bytes[:8], "big", signed=True)},
    )


async def shared_source(
    db: AsyncSession, user_id: UUID, story_id: UUID
) -> tuple[Story, StoryShare, User]:
    recipient = await db.get(User, user_id)
    if recipient is None:
        raise NotFoundException(detail="Shared story is unavailable")
    row = (
        await db.execute(
            select(Story, StoryShare, User)
            .join(StoryShare, StoryShare.story_id == Story.id)
            .join(User, User.id == Story.user_id)
            .where(
                Story.id == story_id,
                Story.deleted_at.is_(None),
                StoryShare.recipient_email == recipient.email.casefold(),
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundException(detail="Shared story is unavailable or access was revoked")
    return row[0], row[1], row[2]


def shared_summary(story: Story, grant: StoryShare, owner: User) -> SharedStoryOut:
    return SharedStoryOut(
        story_id=story.id,
        title=story.title,
        premise=story.premise,
        blurb=story.blurb,
        owner_name=owner.name or "StoryTool author",
        allow_import=grant.allow_import,
    )


async def import_graph(db: AsyncSession, source: Story, user_id: UUID) -> Story:
    state = copy.deepcopy(await full_state(db, source.id))
    for kind in ENTITIES:
        for row in state[kind]:
            if "notes" in row:
                row["notes"] = None
    created = Story(title=source.title, user_id=user_id, parent_story_id=source.id)
    db.add(created)
    await db.flush()
    identifiers = {row["id"]: str(uuid7()) for kind in ENTITIES for row in state[kind]}
    identifiers[str(source.id)] = str(created.id)
    for kind, (model, _, _) in ENTITIES.items():
        for row in state[kind]:
            row["id"] = identifiers[row["id"]]
            for column in model.__table__.c:
                if column.foreign_keys and row.get(column.name) in identifiers:
                    row[column.name] = identifiers[row[column.name]]
    for kind, (table, _, _, _, _) in LINKS.items():
        for row in state[kind]:
            if "id" in row:
                row["id"] = str(uuid7())
            for column in table.c:
                if column.foreign_keys and row.get(column.name) in identifiers:
                    row[column.name] = identifiers[row[column.name]]
    # Only the visible current graph is copied, never private notes, past prose, or findings.
    for kind in EXTRAS:
        state[kind] = []
    await restore_state(db, created.id, state)
    await db.refresh(created)
    from storytool.domain.story.authorship import record_changes

    await record_changes(
        db, created.id, user_id, {}, await full_state(db, created.id), "import", "Imported copy"
    )
    await checkpoint(db, created.id, user_id, "Imported shared story", "initial")
    return created


class StoryShareController(Controller):
    path = "/api/stories/{story_id:uuid}/shares"
    tags = ["sharing"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get()
    async def list_shares(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> list[ShareOut]:
        await owned_story(db_session, story_id, actor(request))
        records = await db_session.scalars(
            select(StoryShare)
            .where(StoryShare.story_id == story_id)
            .order_by(StoryShare.recipient_email)
        )
        return [ShareOut.model_validate(record) for record in records]

    @put()
    async def share(
        self, db_session: AsyncSession, request: Request, story_id: UUID, data: ShareInput
    ) -> ShareOut:
        await owned_story(db_session, story_id, actor(request))
        owner = await db_session.get(User, actor(request))
        if owner and owner.email.casefold() == data.recipient_email:
            raise ClientException(detail="This story already belongs to your account")
        statement = insert(StoryShare).values(story_id=story_id, **data.model_dump())
        upsert = statement.on_conflict_do_update(
            constraint="uq_story_recipient", set_={"allow_import": data.allow_import}
        ).returning(StoryShare)
        result = await db_session.scalar(upsert)
        return ShareOut.model_validate(result)

    @delete("/{share_id:uuid}")
    async def revoke(
        self, db_session: AsyncSession, request: Request, story_id: UUID, share_id: UUID
    ) -> None:
        await owned_story(db_session, story_id, actor(request))
        grant = await db_session.scalar(
            select(StoryShare).where(StoryShare.id == share_id, StoryShare.story_id == story_id)
        )
        if grant is None:
            raise NotFoundException(detail="Sharing permission not found")
        await db_session.delete(grant)


class SharedStoriesController(Controller):
    path = "/api/shared-stories"
    tags = ["sharing"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get()
    async def list_shared(self, db_session: AsyncSession, request: Request) -> list[SharedStoryOut]:
        recipient = await db_session.get(User, actor(request))
        if recipient is None:
            return []
        records = (
            await db_session.execute(
                select(Story, StoryShare, User)
                .join(StoryShare, StoryShare.story_id == Story.id)
                .join(User, User.id == Story.user_id)
                .where(
                    StoryShare.recipient_email == recipient.email.casefold(),
                    Story.deleted_at.is_(None),
                )
                .order_by(Story.title)
            )
        ).all()
        return [shared_summary(story, grant, owner) for story, grant, owner in records]

    @get("/{story_id:uuid}")
    async def read(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> SharedDocumentOut:
        await lock_source(db_session, story_id)
        source, grant, owner = await shared_source(db_session, actor(request), story_id)
        state = await full_state(db_session, story_id)
        graph = await load_graph_by_id(db_session, story_id)
        assert graph is not None
        return SharedDocumentOut(
            share=shared_summary(source, grant, owner),
            manuscript=compile_manuscript(graph),
            structure=visible_state(state),
            base_fingerprint=fingerprint(visible_state(state)),
        )

    @get("/{story_id:uuid}/activity")
    async def shared_activity(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> StoryActivityOut:
        source, _grant, _owner = await shared_source(db_session, actor(request), story_id)
        return activity(source)

    @post("/{story_id:uuid}/import", status_code=201)
    async def import_story(
        self, db_session: AsyncSession, request: Request, story_id: UUID, data: SharedImportInput
    ) -> StoryOut:
        await lock_source(db_session, story_id)
        source, grant, _owner = await shared_source(db_session, actor(request), story_id)
        if not grant.allow_import:
            raise ClientException(
                status_code=403, detail="The author has not allowed importing this story"
            )
        if (
            fingerprint(visible_state(await full_state(db_session, story_id)))
            != data.expected_fingerprint
        ):
            raise ClientException(
                status_code=409,
                detail="The shared story changed. Refresh and review it before importing.",
            )
        return StoryOut.model_validate(await import_graph(db_session, source, actor(request)))


class StoryReaderController(Controller):
    path = "/api/stories/{story_id:uuid}"
    tags = ["reading"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/reader")
    async def read_owned(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> SharedDocumentOut:
        await lock_source(db_session, story_id)
        source = await owned_story(db_session, story_id, actor(request))
        owner = await db_session.get(User, actor(request))
        assert owner is not None
        state = await full_state(db_session, story_id)
        graph = await load_graph_by_id(db_session, story_id)
        assert graph is not None
        return SharedDocumentOut(
            share=SharedStoryOut(
                story_id=source.id,
                title=source.title,
                premise=source.premise,
                blurb=source.blurb,
                owner_name=owner.name or "Your story",
                allow_import=False,
            ),
            manuscript=compile_manuscript(graph),
            structure=visible_state(state),
            base_fingerprint=fingerprint(visible_state(state)),
        )

    @get("/activity")
    async def owned_activity(
        self, db_session: AsyncSession, request: Request, story_id: UUID
    ) -> StoryActivityOut:
        return activity(await owned_story(db_session, story_id, actor(request)))
