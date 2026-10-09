"""Story terminology, independent of the structural ladder."""

from typing import ClassVar
from uuid import UUID

from litestar import Controller, delete, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, Field
from sqlalchemy import ForeignKey, String, Text, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase
from storytool.domain.common import EntityOut, apply_patch
from storytool.domain.narrative.models import Scene


class GlossaryEntry(StoryToolBase, CompletableMixin):
    __tablename__ = "glossary_entry"
    complete_when = ("term", "definition")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    term: Mapped[str] = mapped_column(String(200))
    aliases: Mapped[list[str] | None] = mapped_column(JSONB, default=None)
    definition: Mapped[str | None] = mapped_column(Text, default=None)
    first_explained_scene_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("scene.id", ondelete="SET NULL"), default=None
    )


class GlossaryCreate(BaseModel):
    term: str = Field(min_length=1, max_length=200)
    aliases: list[str] | None = Field(default=None, max_length=100)
    definition: str | None = None
    first_explained_scene_id: UUID | None = None


class GlossaryUpdate(BaseModel):
    term: str | None = Field(default=None, min_length=1, max_length=200)
    aliases: list[str] | None = Field(default=None, max_length=100)
    definition: str | None = None
    first_explained_scene_id: UUID | None = None


class GlossaryOut(EntityOut):
    story_id: UUID
    term: str
    aliases: list[str] | None
    definition: str | None
    first_explained_scene_id: UUID | None


async def entry(db: AsyncSession, story_id: UUID, entry_id: UUID) -> GlossaryEntry:
    record = await db.scalar(
        select(GlossaryEntry).where(
            GlossaryEntry.story_id == story_id, GlossaryEntry.id == entry_id
        )
    )
    if record is None:
        raise NotFoundException(detail="Glossary entry not found")
    return record


async def check_scene(db: AsyncSession, story_id: UUID, scene_id: UUID | None) -> None:
    if (
        scene_id is not None
        and await db.scalar(
            select(Scene.id).where(Scene.id == scene_id, Scene.story_id == story_id)
        )
        is None
    ):
        raise NotFoundException(detail="Explanation scene not found in this story")


class GlossaryController(Controller):
    path = "/api/stories/{story_id:uuid}/glossary"
    tags: ClassVar[list[str]] = ["glossary"]
    signature_namespace: ClassVar[dict[str, type]] = {"AsyncSession": AsyncSession}

    @get(summary="List glossary entries")
    async def list_entries(self, db_session: AsyncSession, story_id: UUID) -> list[GlossaryOut]:
        rows = await db_session.scalars(
            select(GlossaryEntry)
            .where(GlossaryEntry.story_id == story_id)
            .order_by(GlossaryEntry.term, GlossaryEntry.id)
        )
        return [GlossaryOut.model_validate(row) for row in rows]

    @post(summary="Create a glossary entry")
    async def create_entry(
        self, db_session: AsyncSession, story_id: UUID, data: GlossaryCreate
    ) -> GlossaryOut:
        await check_scene(db_session, story_id, data.first_explained_scene_id)
        record = GlossaryEntry(story_id=story_id, **data.model_dump())
        db_session.add(record)
        await db_session.flush()
        return GlossaryOut.model_validate(record)

    @get("/{entry_id:uuid}", summary="Read a glossary entry")
    async def read_entry(
        self, db_session: AsyncSession, story_id: UUID, entry_id: UUID
    ) -> GlossaryOut:
        return GlossaryOut.model_validate(await entry(db_session, story_id, entry_id))

    @patch("/{entry_id:uuid}", summary="Update a glossary entry")
    async def update_entry(
        self, db_session: AsyncSession, story_id: UUID, entry_id: UUID, data: GlossaryUpdate
    ) -> GlossaryOut:
        if "term" in data.model_fields_set and data.term is None:
            raise ClientException(detail="Term cannot be cleared")
        await check_scene(db_session, story_id, data.first_explained_scene_id)
        record = apply_patch(await entry(db_session, story_id, entry_id), data)
        await db_session.flush()
        return GlossaryOut.model_validate(record)

    @delete("/{entry_id:uuid}", summary="Delete a glossary entry")
    async def delete_entry(self, db_session: AsyncSession, story_id: UUID, entry_id: UUID) -> None:
        await db_session.delete(await entry(db_session, story_id, entry_id))
        await db_session.flush()
