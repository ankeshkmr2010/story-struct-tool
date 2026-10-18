"""Scrivener adapter: a zipped .scriv project. The Draft/Manuscript folder's binder order
becomes the story: folders are chapters, their text documents are scenes (nested folders are
flattened into their chapter), synopses become scene summaries. Research, notes, comments
and items excluded from compile are left out."""

import io
import re
import zipfile
from xml.etree import ElementTree

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
        if kind == "content":
            raw = self.read(f"Files/Data/{item_id}/content.rtf") or self.read(
                f"Files/Docs/{item_id}.rtf"
            )
            return rtf_to_text(raw.decode("utf-8", errors="replace")) if raw else ""
        raw = self.read(f"Files/Data/{item_id}/synopsis.txt") or self.read(
            f"Files/Docs/{item_id}_synopsis.txt"
        )
        return raw.decode("utf-8", errors="replace").strip() if raw else ""


def _included(item: ElementTree.Element) -> bool:
    flag = item.findtext("MetaData/IncludeInCompile")
    return flag is None or flag.strip().lower() != "no"


def _scenes(project: _Project, item: ElementTree.Element) -> list[ImportedScene]:
    """A binder item and its descendants, flattened into scenes in binder order."""
    scenes: list[ImportedScene] = []
    if not _included(item):
        return scenes
    item_id = item.get("UUID") or item.get("ID") or ""
    prose = project.text(item_id, "content")
    if prose or item.get("Type") == "Text":
        scenes.append(
            ImportedScene(
                title=(item.findtext("Title") or "").strip()[:200] or None,
                prose=prose,
                summary=project.text(item_id, "synopsis") or None,
            )
        )
    for child in item.findall("Children/BinderItem"):
        scenes.extend(_scenes(project, child))
    return scenes


def read_scrivener(content: bytes) -> ImportedStory:
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
        chapters: list[ImportedChapter] = []
        for item in draft.findall("Children/BinderItem"):
            if not _included(item):
                continue
            # A folder is a chapter; a loose document directly in Draft is its own chapter.
            title = (item.findtext("Title") or "").strip()[:200] or None
            chapters.append(ImportedChapter(title, _scenes(project, item)))
    if not any(scene.prose for chapter in chapters for scene in chapter.scenes):
        raise ValueError("The Draft folder contains no prose to import")
    return ImportedStory(chapters)


SCRIVENER = ImportAdapter(
    name="scrivener",
    label="Scrivener project",
    max_bytes=MAX_SCRIVENER_BYTES,
    parse=read_scrivener,
)
