"""Word adapter. The document becomes numbered blocks (paragraphs) with their style and cues;
a plan says which blocks start chapters and scenes, which to skip, and any titles/summaries."""

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any, Literal

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from pydantic import BaseModel, ConfigDict, Field

from storytool.domain.story.import_model import (
    ImportAdapter,
    ImportedChapter,
    ImportedScene,
    ImportedStory,
)

MAX_DOCX_BYTES = 10 * 1024 * 1024
HEADINGS = {"heading1": "Heading 1", "heading2": "Heading 2", "heading3": "Heading 3"}
_CHAPTER_LINE = re.compile(
    r"^(chapter|part|book|prologue|epilogue|interlude)\b[\s.:\-\u2013\u2014]*\S*", re.IGNORECASE
)
_SEPARATOR = re.compile(r"^[\s*#~⁂•·_=+-]{1,15}$")


@dataclass
class Block:
    i: int
    text: str
    style: str
    page_break_before: bool
    italic: bool
    in_table: bool

    @property
    def heading(self) -> str | None:
        return self.style if self.style in HEADINGS.values() else None

    @property
    def chapter_line(self) -> bool:
        return len(self.text) <= 80 and bool(_CHAPTER_LINE.match(self.text.strip()))

    @property
    def separator(self) -> bool:
        stripped = self.text.strip()
        return bool(_SEPARATOR.match(stripped)) and any(c in stripped for c in "*#~⁂")

    @property
    def words(self) -> int:
        return len(self.text.split())


class DocxPlan(BaseModel):
    """How to split a Word document. Block numbers come from the inspection outline."""

    model_config = ConfigDict(extra="forbid")
    chapter_split: Literal[
        "heading1", "heading2", "heading3", "page_break", "chapter_lines", "explicit", "none"
    ] = "heading1"
    scene_split: Literal["none", "heading2", "heading3", "separators", "page_break", "explicit"] = (
        "none"
    )
    chapter_starts: list[int] = Field(default_factory=list, max_length=5000)
    scene_starts: list[int] = Field(default_factory=list, max_length=20000)
    skip: list[tuple[int, int]] = Field(default_factory=list, max_length=500)
    titles: dict[int, str] = Field(default_factory=dict, max_length=20000)
    summaries: dict[int, str] = Field(default_factory=dict, max_length=20000)
    italic_synopsis: bool = False


GUIDE = (
    "Word plan fields. chapter_split: heading1|heading2|heading3 (that heading style starts a "
    "chapter and becomes its title), page_break, chapter_lines (lines like 'Chapter 7' or "
    "'Prologue' start a chapter and become its title), explicit (use chapter_starts) or none. "
    "scene_split: none, heading2|heading3 (heading becomes the scene title), separators (lines "
    "such as *** or # start a new scene and are removed), page_break or explicit (use "
    "scene_starts). chapter_starts/scene_starts: block numbers whose block begins a new "
    "chapter/scene. skip: inclusive [from, to] block ranges to leave out, e.g. title page, "
    "dedication, table of contents, acknowledgements, author bio. titles: {block number: title} "
    "for the chapter or scene starting at that block. summaries: {block number: one or two "
    "sentence summary} for the scene starting at that block. italic_synopsis: a short fully "
    "italic paragraph opening a scene becomes its summary. Prose is never rewritten."
)


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


def _starts(blocks: list[Block], split: str) -> list[int]:
    if split in HEADINGS:
        return [b.i for b in blocks if b.heading == HEADINGS[split]]
    if split == "page_break":
        return [b.i for b in blocks if b.page_break_before]
    if split == "chapter_lines":
        return [b.i for b in blocks if b.chapter_line and not b.in_table]
    return []


def _recommended(blocks: list[Block]) -> dict[str, Any]:
    chapter = next(
        (
            split
            for split in ("heading1", "chapter_lines", "heading2", "page_break")
            if len(_starts(blocks, split)) >= 2
        ),
        "none",
    )
    level = int(chapter[-1]) if chapter.startswith("heading") else 0
    scene = "none"
    if any(b.separator for b in blocks):
        scene = "separators"
    elif level and level < 3 and _starts(blocks, f"heading{level + 1}"):
        scene = f"heading{level + 1}"
    plan: dict[str, Any] = {"chapter_split": chapter, "scene_split": scene}
    first = (_starts(blocks, chapter) or [0])[0]
    if first > 0 and sum(b.words for b in blocks[:first]) < 200:
        plan["skip"] = [[0, first - 1]]
    return plan


def inspect_docx(content: bytes) -> dict[str, Any]:
    blocks = _blocks(content)
    counts = {
        "heading1": len(_starts(blocks, "heading1")),
        "heading2": len(_starts(blocks, "heading2")),
        "heading3": len(_starts(blocks, "heading3")),
        "page_break": len(_starts(blocks, "page_break")),
        "chapter_lines": len(_starts(blocks, "chapter_lines")),
        "separators": sum(b.separator for b in blocks),
    }
    return {
        "stats": {
            "blocks": len(blocks),
            "words": sum(b.words for b in blocks),
            "italic_blocks": sum(b.italic for b in blocks),
            **counts,
        },
        "options": {
            "chapter_split": [
                {"value": key, "count": counts[key]}
                for key in ("heading1", "heading2", "heading3", "page_break", "chapter_lines")
                if counts[key]
            ]
            + [{"value": "explicit"}, {"value": "none"}],
            "scene_split": [{"value": "none"}]
            + [
                {"value": key, "count": counts[key]}
                for key in ("heading2", "heading3", "separators", "page_break")
                if counts[key]
            ]
            + [{"value": "explicit"}],
        },
        "recommended": _recommended(blocks),
        "outline": [
            {
                "block": b.i,
                "style": b.style,
                "words": b.words,
                "text": b.text.strip()[:140],
                "cues": [
                    cue
                    for cue, on in (
                        ("page_break", b.page_break_before),
                        ("chapter_line", b.chapter_line),
                        ("separator", b.separator),
                        ("italic", b.italic),
                        ("table", b.in_table),
                    )
                    if on
                ],
            }
            for b in blocks
        ],
        "guide": GUIDE,
    }


@dataclass
class _Scene:
    start: int
    title: str | None
    blocks: list[Block] = field(default_factory=list)


@dataclass
class _Chapter:
    start: int
    title: str | None
    scenes: list[_Scene]


def _title(block: Block) -> str:
    title = block.text.strip()
    if len(title) > 200:
        raise ValueError(f"Block {block.i} would become a title over 200 characters")
    return title


def _chapter_start(block: Block, plan: DocxPlan) -> tuple[bool, str | None, bool]:
    """(starts a chapter, its title, whether the block is used up as that title)."""
    heading = HEADINGS.get(plan.chapter_split)
    if heading and block.heading == heading:
        return True, _title(block), True
    if plan.chapter_split == "page_break" and block.page_break_before:
        return True, None, False
    if plan.chapter_split == "chapter_lines" and block.chapter_line and not block.in_table:
        return True, _title(block), True
    if plan.chapter_split == "explicit" and block.i in plan.chapter_starts:
        return (True, _title(block), True) if block.heading else (True, None, False)
    return False, None, False


def _scene_start(block: Block, plan: DocxPlan) -> tuple[bool, str | None, bool]:
    heading = HEADINGS.get(plan.scene_split)
    if heading and heading != HEADINGS.get(plan.chapter_split) and block.heading == heading:
        return True, _title(block), True
    if plan.scene_split == "page_break" and block.page_break_before:
        return True, None, False
    if plan.scene_split == "explicit" and block.i in plan.scene_starts:
        return (True, _title(block), True) if block.heading else (True, None, False)
    return False, None, False


def read_docx(content: bytes, plan: DocxPlan | None = None) -> ImportedStory:
    blocks = _blocks(content)
    plan = plan or DocxPlan.model_validate(_recommended(blocks))
    skipped = {i for start, end in plan.skip for i in range(start, end + 1)}
    chapters = [_Chapter(-1, None, [_Scene(-1, None)])]
    pending_scene = False
    for block in blocks:
        if block.i in skipped:
            continue
        starts, title, consumed = _chapter_start(block, plan)
        if starts:
            current = chapters[-1]
            if current.title is None and not any(s.blocks for s in current.scenes):
                chapters[-1] = _Chapter(block.i, title, [_Scene(block.i, None)])
            else:
                chapters.append(_Chapter(block.i, title, [_Scene(block.i, None)]))
            pending_scene = False
        else:
            if plan.scene_split == "separators" and block.separator:
                pending_scene = True
                continue
            starts, scene_title, consumed = _scene_start(block, plan)
            if starts or pending_scene:
                pending_scene = False
                scenes = chapters[-1].scenes
                if not scenes[-1].blocks and scenes[-1].title is None:
                    scenes[-1] = _Scene(block.i, scene_title)
                else:
                    scenes.append(_Scene(block.i, scene_title))
        if not consumed:
            chapters[-1].scenes[-1].blocks.append(block)

    story: list[ImportedChapter] = []
    for chapter in chapters:
        scenes: list[ImportedScene] = []
        for scene in chapter.scenes:
            body = scene.blocks
            summary = plan.summaries.get(scene.start)
            opener = body[0] if body else None
            if (
                plan.italic_synopsis
                and not summary
                and opener
                and opener.italic
                and opener.words <= 80
            ):
                summary, body = opener.text.strip(), body[1:]
            title = scene.title
            if scene.start != chapter.start:
                title = plan.titles.get(scene.start, title)
            if body or title or summary:
                scenes.append(
                    ImportedScene(
                        title=title,
                        prose="\n\n".join(block.text for block in body),
                        summary=summary,
                    )
                )
        title = plan.titles.get(chapter.start, chapter.title)
        if scenes or title:
            story.append(ImportedChapter(title, scenes or [ImportedScene()]))
    if not any(scene.prose for chapter in story for scene in chapter.scenes):
        raise ValueError("This plan leaves no body prose to import")
    return ImportedStory(story)


DOCX = ImportAdapter(
    name="docx",
    label="Word prose",
    max_bytes=MAX_DOCX_BYTES,
    plan_model=DocxPlan,
    inspect=inspect_docx,
    parse=read_docx,
)
