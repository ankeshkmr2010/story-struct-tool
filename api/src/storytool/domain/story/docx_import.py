"""Word adapter: paragraphs (including table cells) become blocks with their style, page breaks
and italics; planning is shared with every block-based format (see block_import)."""

import io
import zipfile

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from storytool.domain.story.block_import import (
    Block,
    BlockPlan,
    block_adapter,
    inspect_blocks,
    read_blocks,
)
from storytool.domain.story.import_model import ImportedStory

MAX_DOCX_BYTES = 10 * 1024 * 1024


def _blocks(content: bytes) -> list[Block]:
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
    blocks: list[Block] = []
    pending_break = False
    for item in document.iter_inner_content():
        entries: list[tuple[Paragraph, bool]] = []
        if isinstance(item, Paragraph):
            entries.append((item, False))
        elif isinstance(item, Table):
            seen = set()
            for row in item.rows:
                for cell in row.cells:
                    if cell._tc not in seen:
                        seen.add(cell._tc)
                        entries.extend((p, True) for p in cell.paragraphs)
        for paragraph, in_table in entries:
            breaks = paragraph._p.findall(".//" + qn("w:br"))
            has_page_break = any(b.get(qn("w:type")) == "page" for b in breaks)
            text = paragraph.text
            if not text.strip():
                pending_break = pending_break or has_page_break
                continue
            style = paragraph.style.name if paragraph.style is not None else "Normal"
            style_italic = bool(paragraph.style is not None and paragraph.style.font.italic)
            runs = [run for run in paragraph.runs if run.text.strip()]
            italic = bool(runs) and all(
                run.italic or (run.italic is None and style_italic) for run in runs
            )
            blocks.append(
                Block(
                    i=len(blocks),
                    text=text,
                    style=style,
                    page_break_before=pending_break
                    or bool(paragraph.paragraph_format.page_break_before),
                    italic=italic,
                    in_table=in_table,
                )
            )
            # A page break inside a paragraph pushes the next block onto a new page.
            pending_break = has_page_break
    if not blocks:
        raise ValueError("This document contains no body prose to import")
    return blocks


DocxPlan = BlockPlan


def inspect_docx(content: bytes) -> dict:
    return inspect_blocks(_blocks(content))


def read_docx(content: bytes, plan: BlockPlan | None = None) -> ImportedStory:
    return read_blocks(_blocks(content), plan)


DOCX = block_adapter("docx", "Word prose", MAX_DOCX_BYTES, _blocks)
