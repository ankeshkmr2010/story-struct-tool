"""EPUB adapter: chapters in spine (reading) order become blocks. Headings keep their level, each
new spine document starts on a new page, and the contents page and DRM-protected books are
refused or skipped. Planning is shared with Word and Markdown (block_import)."""

import io
import posixpath
import zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree

from storytool.domain.story.block_import import Block, block_adapter

MAX_EPUB_BYTES = 40 * 1024 * 1024
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_UNPACKED_READ = 48 * 1024 * 1024
_BLOCK_TAGS = {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "div", "dt", "dd",
    "figcaption", "section", "article",
}  # fmt: skip
_SKIP_TAGS = {"head", "script", "style", "nav", "svg", "math", "aside"}
_HEADINGS = {"h1": "Heading 1", "h2": "Heading 2"}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


class _Paragraphs(HTMLParser):
    """Block-level text from one XHTML document, with heading level and whole-block italics."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[tuple[str, str, bool]] = []
        self.parts: list[str] = []
        self.style = "Normal"
        self.skip = 0
        self.italic = 0
        self.chars = 0
        self.italic_chars = 0

    def flush(self) -> None:
        text = " ".join("".join(self.parts).split())
        if text:
            self.out.append((text, self.style, self.chars > 0 and self.italic_chars == self.chars))
        self.parts, self.style, self.chars, self.italic_chars = [], "Normal", 0, 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in _SKIP_TAGS:
            self.skip += 1
        elif tag in _BLOCK_TAGS:
            self.flush()
            if tag.startswith("h"):
                self.style = _HEADINGS.get(tag, "Heading 3")
        elif tag in {"em", "i"}:
            self.italic += 1
        elif tag == "br":
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self.skip = max(self.skip - 1, 0)
        elif tag in _BLOCK_TAGS:
            self.flush()
        elif tag in {"em", "i"}:
            self.italic = max(self.italic - 1, 0)

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        self.parts.append(data)
        visible = len(data.strip())
        self.chars += visible
        if self.italic:
            self.italic_chars += visible


def epub_blocks(content: bytes) -> list[Block]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ValueError("Choose a valid .epub file") from None
    with archive:
        names = {info.filename: info for info in archive.infolist()}
        if len(names) > 5000:
            raise ValueError("This book contains too many files to import")
        read_total = 0

        def read(name: str) -> bytes:
            nonlocal read_total
            info = names.get(name)
            if info is None:
                raise ValueError("This EPUB is missing part of its contents")
            if info.file_size > MAX_FILE_BYTES:
                raise ValueError("A chapter in this book is too large to import")
            read_total += info.file_size
            if read_total > MAX_UNPACKED_READ:
                raise ValueError("This book is too large to import")
            return archive.read(info)

        if "META-INF/encryption.xml" in names and b"EncryptedData" in read(
            "META-INF/encryption.xml"
        ):
            raise ValueError("This EPUB is DRM-protected; import a DRM-free copy instead")
        try:
            container = ElementTree.fromstring(read("META-INF/container.xml"))
            rootfile = next(e for e in container.iter() if _local(e.tag) == "rootfile")
            opf_path = rootfile.get("full-path") or ""
            opf = ElementTree.fromstring(read(opf_path))
        except (ElementTree.ParseError, StopIteration):
            raise ValueError("This EPUB's package file could not be read") from None
        base = posixpath.dirname(opf_path)
        manifest = {
            item.get("id"): item
            for item in opf.iter()
            if _local(item.tag) == "item" and item.get("id")
        }
        spine = [item for item in opf.iter() if _local(item.tag) == "itemref"]
        blocks: list[Block] = []
        for number, itemref in enumerate(spine):
            item = manifest.get(itemref.get("idref"))
            if item is None or itemref.get("linear") == "no":
                continue
            if "nav" in (item.get("properties") or "").split():
                continue
            if "html" not in (item.get("media-type") or ""):
                continue
            path = posixpath.normpath(posixpath.join(base, item.get("href") or ""))
            parser = _Paragraphs()
            parser.feed(read(path).decode("utf-8", errors="replace"))
            parser.flush()
            for index, (text, style, italic) in enumerate(parser.out):
                blocks.append(
                    Block(
                        i=len(blocks),
                        text=text,
                        style=style,
                        page_break_before=index == 0 and number > 0,
                        italic=italic,
                        in_table=False,
                    )
                )
    if not blocks:
        raise ValueError("This book contains no prose to import")
    return blocks


EPUB = block_adapter("epub", "EPUB book", MAX_EPUB_BYTES, epub_blocks)
