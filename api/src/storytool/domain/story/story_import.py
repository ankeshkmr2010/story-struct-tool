"""One import path for every manuscript format: an adapter parses, this module saves."""

import asyncio
from uuid import UUID

from litestar import Controller, Request, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.narrative.prose import save_scene_content
from storytool.domain.site.funnel import record_milestone
from storytool.domain.story.authorship import record_changes
from storytool.domain.story.docx_import import DOCX
from storytool.domain.story.import_model import ImportAdapter, ImportedStory
from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryOut
from storytool.domain.story.scrivener_import import SCRIVENER
from storytool.domain.versioning.service import checkpoint, full_state

ADAPTERS: dict[str, ImportAdapter] = {adapter.name: adapter for adapter in (DOCX, SCRIVENER)}
MAX_IMPORT_BYTES = max(adapter.max_bytes for adapter in ADAPTERS.values())


class ImportOut(BaseModel):
    story: StoryOut
    chapter_count: int
    scene_count: int
    word_count: int


async def save_imported_story(
    db: AsyncSession, user_id: UUID, title: str, imported: ImportedStory, label: str
) -> ImportOut:
    """Create a new story from any adapter's output, with authorship and a first version."""
    story = Story(title=title, user_id=user_id)
    db.add(story)
    await db.flush()
    word_count = scene_count = 0
    for number, imported_chapter in enumerate(imported.chapters, 1):
        has_prose = any(scene.prose.strip() for scene in imported_chapter.scenes)
        chapter = Chapter(
            story_id=story.id,
            title=imported_chapter.title,
            number=number,
            sort_key=number * 100,
            status="drafted" if has_prose else "placeholder",
        )
        db.add(chapter)
        await db.flush()
        for position, imported_scene in enumerate(imported_chapter.scenes or [None], 1):
            prose = imported_scene.prose if imported_scene else ""
            scene = Scene(
                story_id=story.id,
                chapter_id=chapter.id,
                sort_key=position * 100,
                title=imported_scene.title if imported_scene else None,
                summary=imported_scene.summary if imported_scene else None,
                status="drafted" if prose.strip() else "placeholder",
            )
            db.add(scene)
            result = await save_scene_content(db, scene, prose)
            word_count += result.word_count
            scene_count += 1
    await db.flush()
    await record_changes(
        db, story.id, user_id, {}, await full_state(db, story.id), "import", f"Imported {label}"
    )
    await checkpoint(db, story.id, user_id, f"Imported {label}", "initial")
    await record_milestone(db, "first_scene", user_id=user_id)
    return ImportOut(
        story=StoryOut.model_validate(story).model_copy(update={"prose_imported": True}),
        chapter_count=len(imported.chapters),
        scene_count=scene_count,
        word_count=word_count,
    )


class StoryImportController(Controller):
    path = "/api/imports/{fmt:str}"
    tags = ["import"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(
        status_code=201,
        request_max_body_size=MAX_IMPORT_BYTES,
        summary="Import a manuscript (Word .docx or zipped Scrivener project) as a new story",
    )
    async def import_story(
        self, request: Request, db_session: AsyncSession, fmt: str, title: str
    ) -> ImportOut:
        adapter = ADAPTERS.get(fmt)
        if adapter is None:
            raise NotFoundException(detail="Unsupported import format")
        title = title.strip()
        if not title or len(title) > 200:
            raise ClientException(detail="Use a story title between 1 and 200 characters")
        content = await request.body()
        if not content or len(content) > adapter.max_bytes:
            limit = adapter.max_bytes // (1024 * 1024)
            raise ClientException(detail=f"Choose a {adapter.label} file up to {limit} MB")
        try:
            imported = await asyncio.to_thread(adapter.parse, content)
        except ValueError as error:
            raise ClientException(detail=str(error)) from None
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        return await save_imported_story(db_session, user_id, title, imported, adapter.label)
