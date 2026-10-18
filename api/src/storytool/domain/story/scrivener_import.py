"""Scrivener adapter: a zipped .scriv project. The Draft/Manuscript folder's binder becomes
the story: a plan picks which binder depth (or which items) are chapters; everything inside a
chapter is flattened into scenes in binder order. Synopses can become summaries and document
notes scene notes; research and items excluded from compile stay out unless asked for."""

import io
import re
import zipfile
from dataclasses import dataclass, field
from xml.etree import ElementTree

from pydantic import BaseModel, ConfigDict, Field

from storytool.domain.story.import_model import (
    ImportAdapter,
    ImportedChapter,
    ImportedScene,
    ImportedStory,
)

MAX_SCRIVENER_BYTES = 40 * 1024 * 1024
MAX_UNPACKED_READ = 48 * 1024 * 1024
MAX_FILE_BYTES = 10 * 1024 * 1024

# RTF destinations whose text is never prose (fonts, styles, metadata, pictures, comments).
_SKIP_DESTINATIONS = {
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "listtable",
    "listoverridetable",
    "generator",
    "expandedcolortbl",
    "header",
    "footer",
    "footnote",
    "annotation",
    "xmlnstbl",
    "rsidtbl",
    "themedata",
    "datastore",
    "latentstyles",
    "fldinst",
    "object",
    "nonshppict",
}
_TOKEN = re.compile(
    r"\\([a-zA-Z]+)(-?\d+)? ?"  # control word with optional numeric argument
    r"|\\'([0-9a-fA-F]{2})"  # hex-escaped byte
    r"|\\(.)"  # control symbol
    r"|([{}])"  # group start or end
    r"|([^\\{}\r\n]+)"  # text
    r"|[\r\n]+"
)


def rtf_to_text(rtf: str) -> str:
    """Plain prose from RTF: paragraphs separated by blank lines, formatting dropped."""
    out: list[str] = []
    stack: list[tuple[bool, int]] = []
    skip, uc, pending_skip = False, 1, 0
    for match in _TOKEN.finditer(rtf):
        word, arg, hexcode, symbol, brace, text = match.groups()
        if brace == "{":
            stack.append((skip, uc))
            continue
        if brace == "}":
            skip, uc = stack.pop() if stack else (False, 1)
            continue
        if pending_skip and (text or hexcode):
            # Fallback characters after a \uN escape are not prose.
            if text:
                drop = min(pending_skip, len(text))
                text, pending_skip = text[drop:], pending_skip - drop
            else:
                pending_skip -= 1
                continue
        if word:
            if word in _SKIP_DESTINATIONS:
                skip = True
            elif word == "uc":
                uc = int(arg or 1)
            elif skip:
                continue
            elif word in {"par", "line"}:
                out.append("\n")
            elif word == "tab":
                out.append("\t")
            elif word == "u":
                code = int(arg or 0)
                out.append(chr(code + 65536 if code < 0 else code))
                pending_skip = uc
            elif word in {"emdash", "endash"}:
                out.append("\u2014" if word == "emdash" else "\u2013")
            elif word in {"lquote", "rquote"}:
                out.append("‘" if word == "lquote" else "’")  # noqa: RUF001
            elif word in {"ldblquote", "rdblquote"}:
                out.append("“" if word == "ldblquote" else "”")
            continue
        if symbol:
            if symbol == "*":
                skip = True
            elif not skip and symbol in "\\{}":
                out.append(symbol)
            elif not skip and symbol == "~":
                out.append("\u00a0")
            continue
        if skip:
            continue
        if hexcode:
            out.append(bytes([int(hexcode, 16)]).decode("cp1252", errors="replace"))
        elif text:
            out.append(text)
    paragraphs = [line.strip() for line in "".join(out).split("\n")]
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


class _Project:
    def __init__(self, archive: zipfile.ZipFile):
        self.archive = archive
        self.names = {info.filename: info for info in archive.infolist()}
        scrivx = [name for name in self.names if name.lower().endswith(".scrivx")]
        if not scrivx:
            raise ValueError("Zip the whole .scriv project folder; no .scrivx file was found")
        self.root = scrivx[0].rsplit("/", 1)[0] + "/" if "/" in scrivx[0] else ""
        self.scrivx = scrivx[0]
        self.read_bytes = 0

    def read(self, path: str) -> bytes | None:
        info = self.names.get(self.root + path)
        if info is None:
            return None
        if info.file_size > MAX_FILE_BYTES:
            raise ValueError("A document in this project is too large to import")
        self.read_bytes += info.file_size
        if self.read_bytes > MAX_UNPACKED_READ:
            raise ValueError("This project's manuscript is too large to import")
        return self.archive.read(info)

    def text(self, item_id: str, kind: str) -> str:
        """Scrivener 3 keeps Files/Data/<UUID>/; Scrivener 2 keeps Files/Docs/<ID>."""
        if kind in {"content", "notes"}:
            name = "content" if kind == "content" else "notes"
            suffix = "" if kind == "content" else "_notes"
            raw = self.read(f"Files/Data/{item_id}/{name}.rtf") or self.read(
                f"Files/Docs/{item_id}{suffix}.rtf"
            )
            return rtf_to_text(raw.decode("utf-8", errors="replace")) if raw else ""
        raw = self.read(f"Files/Data/{item_id}/synopsis.txt") or self.read(
            f"Files/Docs/{item_id}_synopsis.txt"
        )
        return raw.decode("utf-8", errors="replace").strip() if raw else ""


@dataclass
class _Node:
    id: str
    kind: str
    title: str | None
    included: bool
    depth: int
    prose: str
    synopsis: str
    notes: str
    children: list["_Node"] = field(default_factory=list)

    @property
    def folder(self) -> bool:
        return self.kind != "Text"


def _tree(content: bytes) -> list[_Node]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ValueError("Choose a .zip of your .scriv project folder") from None
    with archive:
        if len(archive.infolist()) > 50000:
            raise ValueError("This project contains too many files to import")
        project = _Project(archive)
        try:
            binder = ElementTree.fromstring(project.read(project.scrivx.removeprefix(project.root)))
        except ElementTree.ParseError:
            raise ValueError("The Scrivener project file could not be read") from None
        draft = next(
            (
                item
                for item in binder.iter("BinderItem")
                if item.get("Type") in {"DraftFolder", "Draft"}
            ),
            None,
        )
        if draft is None:
            raise ValueError("No Draft or Manuscript folder was found in this project")

        def node(item: ElementTree.Element, depth: int) -> _Node:
            item_id = item.get("UUID") or item.get("ID") or ""
            flag = item.findtext("MetaData/IncludeInCompile")
            return _Node(
                id=item_id,
                kind=item.get("Type") or "Text",
                title=(item.findtext("Title") or "").strip()[:200] or None,
                included=flag is None or flag.strip().lower() != "no",
                depth=depth,
                prose=project.text(item_id, "content"),
                synopsis=project.text(item_id, "synopsis"),
                notes=project.text(item_id, "notes"),
                children=[node(child, depth + 1) for child in item.findall("Children/BinderItem")],
            )

        return [node(item, 1) for item in draft.findall("Children/BinderItem")]


def _walk(nodes: list[_Node]):
    for item in nodes:
        yield item
        yield from _walk(item.children)


class ScrivenerPlan(BaseModel):
    """How to map the Draft folder. Item ids come from the inspection outline."""

    model_config = ConfigDict(extra="forbid")
    chapter_level: int = Field(default=1, ge=1, le=6)
    chapter_items: list[str] = Field(default_factory=list, max_length=5000)
    synopsis_as_summary: bool = True
    include_notes: bool = False
    include_excluded: bool = False
    exclude: list[str] = Field(default_factory=list, max_length=20000)
    titles: dict[str, str] = Field(default_factory=dict, max_length=20000)
    summaries: dict[str, str] = Field(default_factory=dict, max_length=20000)


GUIDE = (
    "Scrivener plan fields (item ids from the outline). chapter_level: binder depth inside "
    "Draft whose items become chapters (1 = top-level folders; 2 when the top level holds parts "
    "or acts); everything inside a chapter is flattened into its scenes in binder order, and "
    "documents above that depth become their own chapters. chapter_items: explicit item ids "
    "that start chapters (overrides chapter_level; documents between them join the previous "
    "chapter). synopsis_as_summary: use Scrivener synopses as scene summaries. include_notes: "
    "keep document notes as scene notes. include_excluded: also import items excluded from "
    "compile. exclude: item ids to leave out with their children (front matter, cut scenes). "
    "titles: {item id: title}. summaries: {item id: summary}, overriding synopses. Prose is "
    "never rewritten."
)


def _scenes(node: _Node, plan: ScrivenerPlan) -> list[ImportedScene]:
    if node.id in plan.exclude or not (node.included or plan.include_excluded):
        return []
    scenes: list[ImportedScene] = []
    if node.prose or not node.folder:
        summary = plan.summaries.get(node.id) or (
            node.synopsis if plan.synopsis_as_summary and node.synopsis else None
        )
        scenes.append(
            ImportedScene(
                title=plan.titles.get(node.id, node.title),
                prose=node.prose,
                summary=summary,
                notes=node.notes if plan.include_notes and node.notes else None,
            )
        )
    for child in node.children:
        scenes.extend(_scenes(child, plan))
    return scenes


def _build(nodes: list[_Node], plan: ScrivenerPlan) -> ImportedStory:
    chapters: list[ImportedChapter] = []

    def active(node: _Node) -> bool:
        return node.id not in plan.exclude and (node.included or plan.include_excluded)

    def chapter(node: _Node) -> None:
        title = plan.titles.get(node.id, node.title)
        chapters.append(ImportedChapter(title, _scenes(node, plan)))

    if plan.chapter_items:
        wanted = set(plan.chapter_items)

        def visit(items: list[_Node]) -> None:
            for node in items:
                if not active(node):
                    continue
                if node.id in wanted:
                    chapter(node)
                elif node.folder and any(n.id in wanted for n in _walk(node.children)):
                    visit(node.children)
                elif chapters:
                    chapters[-1].scenes.extend(_scenes(node, plan))
                else:
                    chapter(node)

        visit(nodes)
    else:

        def visit_level(items: list[_Node]) -> None:
            for node in items:
                if not active(node):
                    continue
                if node.depth >= plan.chapter_level or not node.folder:
                    chapter(node)
                else:
                    visit_level(node.children)

        visit_level(nodes)
    chapters = [c for c in chapters if c.scenes or c.title]
    if not any(scene.prose for c in chapters for scene in c.scenes):
        raise ValueError("This plan leaves no prose to import")
    return ImportedStory(chapters)


def _recommended(nodes: list[_Node]) -> dict:
    tops = [n for n in nodes if n.included]
    parts = (
        tops
        and all(n.folder for n in tops)
        and all(any(child.folder for child in n.children) for n in tops)
    )
    return {"chapter_level": 2 if parts else 1}


def inspect_scrivener(content: bytes) -> dict:
    nodes = _tree(content)
    items = list(_walk(nodes))
    words = sum(len(n.prose.split()) for n in items if n.included)
    max_depth = max((n.depth for n in items if n.folder), default=1)
    levels = []
    for level in range(1, max_depth + 1):
        count = len(_build(nodes, ScrivenerPlan(chapter_level=level)).chapters) if words else 0
        levels.append({"value": level, "chapters": count})
    return {
        "stats": {
            "items": len(items),
            "folders": sum(n.folder for n in items),
            "documents": sum(not n.folder for n in items),
            "words": words,
            "synopses": sum(bool(n.synopsis) for n in items),
            "notes": sum(bool(n.notes) for n in items),
            "excluded_from_compile": sum(not n.included for n in items),
            "max_folder_depth": max_depth,
        },
        "options": {"chapter_level": levels},
        "recommended": _recommended(nodes),
        "outline": [
            {
                "item": n.id,
                "type": n.kind,
                "depth": n.depth,
                "title": n.title,
                "words": len(n.prose.split()),
                "synopsis": n.synopsis[:140] or None,
                "has_notes": bool(n.notes),
                "included_in_compile": n.included,
            }
            for n in items
        ],
        "guide": GUIDE,
    }


def read_scrivener(content: bytes, plan: ScrivenerPlan | None = None) -> ImportedStory:
    nodes = _tree(content)
    return _build(nodes, plan or ScrivenerPlan.model_validate(_recommended(nodes)))


SCRIVENER = ImportAdapter(
    name="scrivener",
    label="Scrivener project",
    max_bytes=MAX_SCRIVENER_BYTES,
    plan_model=ScrivenerPlan,
    inspect=inspect_scrivener,
    parse=read_scrivener,
)
