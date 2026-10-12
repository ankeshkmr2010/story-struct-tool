"""Import Word body prose into a fresh story; infer no planning metadata."""

import asyncio
import io
import zipfile
from dataclasses import dataclass
from uuid import UUID

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from litestar import Controller, Request, post
from litestar.exceptions import ClientException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.narrative.prose import save_scene_content
from storytool.domain.site.funnel import record_milestone
from storytool.domain.story.authorship import record_changes
from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryOut
from storytool.domain.versioning.service import checkpoint, full_state

MAX_DOCX_BYTES = 10 * 1024 * 1024


@dataclass
class ImportedChapter:
    title: str | None
    paragraphs: list[str]


def read_docx(content: bytes) -> list[ImportedChapter]:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            files = archive.infolist()
            if len(files) > 2000 or sum(item.file_size for item in files) > 32 * 1024 * 1024:
                raise ValueError("This document is too large when unpacked")
            if archive.getinfo("word/document.xml").file_size > MAX_DOCX_BYTES:
                raise ValueError("This document's prose is too large")
        document = Document(io.BytesIO(content))
    except ValueError:
        raise
    except Exception:
        raise ValueError("Choose a valid, unencrypted .docx document") from None
    if document.element.xpath(".//w:ins | .//w:del"):
        raise ValueError("Accept or reject tracked changes in Word before importing")
    chapters = [ImportedChapter(None, [])]
    for block in document.iter_inner_content():
        paragraphs = [block] if isinstance(block, Paragraph) else []
        if isinstance(block, Table):
            seen_cells = set()
            for row in block.rows:
                for cell in row.cells:
                    if cell._tc not in seen_cells:
                        seen_cells.add(cell._tc)
                        paragraphs.extend(cell.paragraphs)
        for paragraph in paragraphs:
            text = paragraph.text
            if not text.strip():
                continue
            style = paragraph.style
            is_chapter = isinstance(block, Paragraph) and style is not None and (
                style.style_id == "Heading1" or style.name == "Heading 1"
            )
            if is_chapter:
                if len(text.strip()) > 200:
                    raise ValueError("A chapter heading exceeds 200 characters; shorten it in Word")
                if chapters[-1].title is None and not chapters[-1].paragraphs:
                    chapters[-1].title = text.strip()
                else:
                    chapters.append(ImportedChapter(text.strip(), []))
            else:
                chapters[-1].paragraphs.append(text)
    if not any(chapter.paragraphs for chapter in chapters):
        raise ValueError("This document contains no body prose to import")
    return chapters


class DocxImportOut(BaseModel):
    story: StoryOut
    chapter_count: int
    word_count: int


class DocxImportController(Controller):
    path = "/api/imports/docx"
    tags = ["import"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(
        status_code=201, request_max_body_size=MAX_DOCX_BYTES,
        summary="Import Word body prose as a new story",
    )
    async def import_docx(
        self, request: Request, db_session: AsyncSession, title: str
    ) -> DocxImportOut:
        title = title.strip()
        if not title or len(title) > 200:
            raise ClientException(detail="Use a story title between 1 and 200 characters")
        content = await request.body()
        if not content or len(content) > MAX_DOCX_BYTES:
            raise ClientException(detail="Choose a Word document up to 10 MB")
        try:
            chapters = await asyncio.to_thread(read_docx, content)
        except ValueError as error:
            raise ClientException(detail=str(error)) from None
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        story = Story(title=title, user_id=user_id)
        db_session.add(story)
        await db_session.flush()
        word_count = 0
        for number, imported in enumerate(chapters, 1):
            chapter = Chapter(
                story_id=story.id, title=imported.title, number=number, sort_key=number * 100,
                status="drafted" if imported.paragraphs else "placeholder",
            )
            db_session.add(chapter)
            await db_session.flush()
            scene = Scene(
                story_id=story.id, chapter_id=chapter.id, sort_key=100,
                status="drafted" if imported.paragraphs else "placeholder",
            )
            db_session.add(scene)
            result = await save_scene_content(db_session, scene, "\n\n".join(imported.paragraphs))
            word_count += result.word_count
        await db_session.flush()
        await record_changes(
            db_session, story.id, user_id, {}, await full_state(db_session, story.id),
            "import", "Imported Word prose",
        )
        await checkpoint(db_session, story.id, user_id, "Imported Word prose", "initial")
        await record_milestone(db_session, "first_scene", user_id=user_id)
        return DocxImportOut(
            story=StoryOut.model_validate(story), chapter_count=len(chapters), word_count=word_count
        )
