"""One import path for every manuscript format.

An upload is kept briefly (24 hours, owner only) so the author's import window or their AI can
inspect it, preview plans and then import. Adapters parse; `save_imported_story` alone saves."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.narrative.prose import save_scene_content
from storytool.domain.site.funnel import record_milestone
from storytool.domain.story.authorship import record_changes
from storytool.domain.story.docx_import import DOCX
from storytool.domain.story.epub_import import EPUB
from storytool.domain.story.import_model import ImportAdapter, ImportedStory
from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryOut
from storytool.domain.story.scrivener_import import SCRIVENER
from storytool.domain.story.text_import import TEXT
from storytool.domain.versioning.service import checkpoint, full_state

ADAPTERS: dict[str, ImportAdapter] = {
    adapter.name: adapter for adapter in (DOCX, SCRIVENER, TEXT, EPUB)
}
MAX_IMPORT_BYTES = max(adapter.max_bytes for adapter in ADAPTERS.values())
UPLOAD_HOURS = 24


class ImportUpload(StoryToolBase):
    __tablename__ = "import_upload"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(20))
    filename: Mapped[str] = mapped_column(String(300))
    content: Mapped[bytes | None] = mapped_column(LargeBinary, default=None)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    story_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("story.id", ondelete="SET NULL"), default=None
    )


class ImportOut(BaseModel):
    story: StoryOut
    chapter_count: int
    scene_count: int
    word_count: int


class UploadOut(BaseModel):
    id: UUID
    format: str
    filename: str
    expires_at: datetime
    story_id: UUID | None
    inspection: dict[str, Any] | None
    outline_total: int = 0
    outline_offset: int = 0


class PlanIn(BaseModel):
    plan: dict[str, Any] = Field(default_factory=dict)


class ImportIn(PlanIn):
    title: str = Field(min_length=1, max_length=200)


class PreviewScene(BaseModel):
    title: str | None
    words: int
    summary: str | None
    has_notes: bool


class PreviewChapter(BaseModel):
    title: str | None
    scenes: list[PreviewScene]


class PreviewOut(BaseModel):
    chapter_count: int
    scene_count: int
    word_count: int
    chapters: list[PreviewChapter]
    truncated: bool


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
                notes=imported_scene.notes if imported_scene else None,
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


def _adapter(fmt: str) -> ImportAdapter:
    adapter = ADAPTERS.get(fmt)
    if adapter is None:
        raise NotFoundException(detail="Unsupported import format")
    return adapter


def _plan(adapter: ImportAdapter, data: dict[str, Any] | None) -> Any:
    try:
        return adapter.plan(data)
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in item['loc'])}: {item['msg']}" for item in error.errors()
        )
        raise ClientException(detail=f"Invalid import plan: {problems}"[:1000]) from None


async def _run(function: Any, *args: Any) -> Any:
    try:
        return await asyncio.to_thread(function, *args)
    except ValueError as error:
        raise ClientException(detail=str(error)) from None


def _title(title: str) -> str:
    title = title.strip()
    if not title or len(title) > 200:
        raise ClientException(detail="Use a story title between 1 and 200 characters")
    return title


async def _body(request: Request, adapter: ImportAdapter) -> bytes:
    content = await request.body()
    if not content or len(content) > adapter.max_bytes:
        limit = adapter.max_bytes // (1024 * 1024)
        raise ClientException(detail=f"Choose a {adapter.label} file up to {limit} MB")
    return content


async def _upload(db: AsyncSession, request: Request, upload_id: UUID) -> ImportUpload:
    upload = await db.scalar(
        select(ImportUpload).where(
            ImportUpload.id == upload_id,
            ImportUpload.user_id == request.scope["state"]["storytool_user_id"],
            ImportUpload.expires_at > datetime.now(UTC),
        )
    )
    if upload is None:
        raise NotFoundException(detail="Import upload not found or expired; upload the file again")
    return upload


async def _upload_out(upload: ImportUpload, offset: int = 0, limit: int = 300) -> UploadOut:
    inspection = None
    total = 0
    if upload.content is not None:
        inspection = await _run(ADAPTERS[upload.format].inspect, upload.content)
        total = len(inspection["outline"])
        inspection["outline"] = inspection["outline"][offset : offset + limit]
    return UploadOut(
        id=upload.id,
        format=upload.format,
        filename=upload.filename,
        expires_at=upload.expires_at,
        story_id=upload.story_id,
        inspection=inspection,
        outline_total=total,
        outline_offset=offset,
    )


def _preview(imported: ImportedStory, limit: int = 400) -> PreviewOut:
    scenes = [scene for chapter in imported.chapters for scene in chapter.scenes]
    return PreviewOut(
        chapter_count=len(imported.chapters),
        scene_count=len(scenes),
        word_count=sum(len(scene.prose.split()) for scene in scenes),
        chapters=[
            PreviewChapter(
                title=chapter.title,
                scenes=[
                    PreviewScene(
                        title=scene.title,
                        words=len(scene.prose.split()),
                        summary=scene.summary,
                        has_notes=bool(scene.notes),
                    )
                    for scene in chapter.scenes
                ],
            )
            for chapter in imported.chapters[:limit]
        ],
        truncated=len(imported.chapters) > limit,
    )


class StoryImportController(Controller):
    path = "/api/imports"
    tags = ["import"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(
        "/{fmt:str}",
        status_code=201,
        request_max_body_size=MAX_IMPORT_BYTES,
        summary="Import a manuscript with the recommended plan (no preview step)",
    )
    async def import_story(
        self, request: Request, db_session: AsyncSession, fmt: str, title: str
    ) -> ImportOut:
        adapter = _adapter(fmt)
        title = _title(title)
        content = await _body(request, adapter)
        imported = await _run(adapter.parse, content, None)
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        return await save_imported_story(db_session, user_id, title, imported, adapter.label)

    @post(
        "/{fmt:str}/uploads",
        status_code=201,
        request_max_body_size=MAX_IMPORT_BYTES,
        summary="Keep a manuscript for 24 hours and describe how it could be split",
    )
    async def upload(
        self, request: Request, db_session: AsyncSession, fmt: str, filename: str = "manuscript"
    ) -> UploadOut:
        adapter = _adapter(fmt)
        content = await _body(request, adapter)
        await _run(adapter.inspect, content)  # reject unreadable files before keeping them
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        await db_session.execute(
            delete(ImportUpload).where(
                ImportUpload.user_id == user_id, ImportUpload.expires_at <= datetime.now(UTC)
            )
        )
        upload = ImportUpload(
            user_id=user_id,
            format=fmt,
            filename=filename.strip()[:300] or "manuscript",
            content=content,
            expires_at=datetime.now(UTC) + timedelta(hours=UPLOAD_HOURS),
        )
        db_session.add(upload)
        await db_session.flush()
        return await _upload_out(upload)

    @get("/uploads/{upload_id:uuid}", summary="Inspect an upload: stats, options, outline")
    async def inspect(
        self,
        request: Request,
        db_session: AsyncSession,
        upload_id: UUID,
        offset: int = 0,
        limit: int = 300,
    ) -> UploadOut:
        upload = await _upload(db_session, request, upload_id)
        return await _upload_out(upload, max(offset, 0), min(max(limit, 1), 2000))

    @post("/uploads/{upload_id:uuid}/preview", status_code=200, summary="Dry-run a plan")
    async def preview(
        self, request: Request, db_session: AsyncSession, upload_id: UUID, data: PlanIn
    ) -> PreviewOut:
        upload = await _upload(db_session, request, upload_id)
        if upload.content is None:
            raise ClientException(detail="This upload was already imported")
        adapter = ADAPTERS[upload.format]
        return _preview(await _run(adapter.parse, upload.content, _plan(adapter, data.plan)))

    @post("/uploads/{upload_id:uuid}/import", status_code=201, summary="Import with a plan")
    async def import_upload(
        self, request: Request, db_session: AsyncSession, upload_id: UUID, data: ImportIn
    ) -> ImportOut:
        upload = await _upload(db_session, request, upload_id)
        if upload.content is None:
            raise ClientException(detail="This upload was already imported")
        adapter = ADAPTERS[upload.format]
        imported = await _run(adapter.parse, upload.content, _plan(adapter, data.plan))
        result = await save_imported_story(
            db_session, upload.user_id, _title(data.title), imported, adapter.label
        )
        upload.story_id, upload.content = result.story.id, None
        return result
