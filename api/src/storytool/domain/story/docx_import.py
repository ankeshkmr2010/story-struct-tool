"""Word adapter: body prose only; Heading 1 starts each chapter, one scene per chapter."""

import io
import zipfile

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from storytool.domain.story.import_model import (
    ImportAdapter,
    ImportedChapter,
    ImportedScene,
    ImportedStory,
)

MAX_DOCX_BYTES = 10 * 1024 * 1024


def read_docx(content: bytes) -> ImportedStory:
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
    chapters: list[tuple[str | None, list[str]]] = [(None, [])]
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
                if chapters[-1][0] is None and not chapters[-1][1]:
                    chapters[-1] = (text.strip(), [])
                else:
                    chapters.append((text.strip(), []))
            else:
                chapters[-1][1].append(text)
    if not any(paragraphs for _, paragraphs in chapters):
        raise ValueError("This document contains no body prose to import")
    return ImportedStory(
        [
            ImportedChapter(title, [ImportedScene(prose="\n\n".join(paragraphs))])
            for title, paragraphs in chapters
        ]
    )


DOCX = ImportAdapter(name="docx", label="Word prose", max_bytes=MAX_DOCX_BYTES, parse=read_docx)
