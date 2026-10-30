"""Manuscript exports beyond Markdown and Word: HTML, plain text and EPUB.

All of them lay out the same compiled Markdown (`compile_manuscript`) with the same small
block grammar the .docx export understands -- headings, epigraph quotes, scene breaks and
paragraphs with bold/italic runs -- so every format says the same thing.
"""

import base64
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from html import escape
from uuid import UUID

_INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)")
_HEADING = re.compile(r"^(#{1,4})\s+(.*)$")
SCENE_BREAK = "* * *"
_IMAGE = re.compile(r"!\[([^\]\n]*)\]\(storytool-image:([0-9a-fA-F-]{36})\)")
ImageFiles = dict[str, tuple[bytes, str, str, str]]


@dataclass(frozen=True, slots=True)
class Block:
    kind: str  # "heading" | "quote" | "break" | "para"
    text: str = ""
    level: int = 0
    image_id: str = ""


def blocks(markdown: str) -> list[Block]:
    out: list[Block] = []
    for chunk in re.split(r"\n\s*\n", markdown):
        images = list(_IMAGE.finditer(chunk))
        if images:
            cursor = 0
            for image in images:
                out.extend(blocks(chunk[cursor:image.start()]))
                out.append(Block("image", image[1], image_id=image[2]))
                cursor = image.end()
            out.extend(blocks(chunk[cursor:]))
            continue
        lines = [line.rstrip() for line in chunk.strip().splitlines()]
        if not lines:
            continue
        heading = _HEADING.match(lines[0])
        if heading and len(lines) == 1:
            out.append(Block("heading", heading.group(2), len(heading.group(1))))
        elif all(line.startswith(">") for line in lines):
            out.append(Block("quote", " ".join(line.lstrip("> ").strip() for line in lines)))
        elif lines == [SCENE_BREAK]:
            out.append(Block("break"))
        else:
            out.append(Block("para", " ".join(line.strip() for line in lines)))
    return out


def inline_html(text: str) -> str:
    parts = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            parts.append(f"<strong>{escape(part[2:-2])}</strong>")
        elif len(part) > 2 and part[0] == part[-1] and part[0] in "*_":
            parts.append(f"<em>{escape(part[1:-1])}</em>")
        else:
            parts.append(escape(part))
    return "".join(parts)


def plain(text: str) -> str:
    return "".join(
        part[2:-2]
        if part.startswith("**") and part.endswith("**") and len(part) > 4
        else part[1:-1]
        if len(part) > 2 and part[0] == part[-1] and part[0] in "*_"
        else part
        for part in _INLINE.split(text)
    )


def _block_html(block: Block, images: ImageFiles | None = None, *, epub: bool = False) -> str:
    if block.kind == "image":
        data = (images or {}).get(block.image_id)
        if data is None:
            return f"<p>[Image: {escape(block.text)}]</p>"
        raw, mime, alt, caption = data
        source = (
            f"images/{block.image_id}.{mime.split('/')[1]}"
            if epub
            else f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
        )
        return (
            f'<figure><img src="{source}" alt="{escape(alt or block.text, quote=True)}"/>'
            + (f"<figcaption>{escape(caption)}</figcaption>" if caption else "")
            + "</figure>"
        )
    if block.kind == "heading":
        return f"<h{block.level}>{inline_html(block.text)}</h{block.level}>"
    if block.kind == "quote":
        return f"<blockquote><p>{inline_html(block.text)}</p></blockquote>"
    if block.kind == "break":
        return '<p class="scene-break">* * *</p>'
    return f"<p>{inline_html(block.text)}</p>"


_CSS = (
    "body{font-family:Georgia,'Times New Roman',serif;line-height:1.6;max-width:40em;"
    "margin:2em auto;padding:0 1em}"
    "h1,h2{text-align:center}h2{margin-top:3em}"
    "blockquote{font-style:italic;margin:1.5em 2em}"
    ".scene-break{text-align:center;margin:1.5em 0}"
    "figure{margin:1.5em 0;break-inside:avoid}img{max-width:100%;height:auto}figcaption{text-align:center;font-size:.85em}"
    ".cover{text-align:center;margin:0}.cover img{max-height:95vh}"
)


def manuscript_html(
    markdown: str, title: str, author_name: str | None = None, images: ImageFiles | None = None
) -> str:
    body = "\n".join(_block_html(b, images) for b in blocks(markdown))
    author_meta = f'<meta name="author" content="{escape(author_name)}"/>\n' if author_name else ""
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{escape(title)}</title>\n{author_meta}<style>{_CSS}</style>\n</head>\n"
        f"<body>\n{body}\n</body>\n</html>\n"
    )


def manuscript_text(markdown: str) -> str:
    lines: list[str] = []
    for block in blocks(markdown):
        if block.kind == "heading":
            text = plain(block.text)
            lines.append(text.upper() if block.level == 1 else text)
        elif block.kind == "quote":
            lines.append("    " + plain(block.text))
        elif block.kind == "break":
            lines.append(SCENE_BREAK)
        elif block.kind == "image":
            lines.append("[Image: " + block.text + "]")
        else:
            lines.append(plain(block.text))
    return "\n\n".join(lines) + "\n"


def _xhtml(title: str, body: str) -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" '
        'lang="en" xml:lang="en">\n<head>\n'
        f'<title>{escape(title)}</title>\n<link rel="stylesheet" href="style.css"/>\n</head>\n'
        f"<body>\n{body}\n</body>\n</html>\n"
    )


def manuscript_epub(
    markdown: str,
    title: str,
    identifier: UUID,
    author_name: str | None = None,
    images: ImageFiles | None = None,
    cover_id: str | None = None,
) -> bytes:
    """An EPUB 3 book: a cover (when `cover_id` names one of `images`), a title page, then one
    file per chapter (level-2 heading)."""
    sections: list[tuple[str, list[Block]]] = [(title, [])]
    for block in blocks(markdown):
        if block.kind == "heading" and block.level == 2:
            sections.append((plain(block.text), [block]))
        else:
            sections[-1][1].append(block)

    files = [
        (
            f"section-{index}.xhtml",
            label,
            _xhtml(label, "\n".join(_block_html(b, images, epub=True) for b in body)),
        )
        for index, (label, body) in enumerate(sections)
    ]
    if cover_id and images and cover_id in images:
        data = images[cover_id]
        src = f"images/{cover_id}.{data[1].split('/')[1]}"
        page = f'<div class="cover"><img src="{src}" alt="{escape(data[2])}"/></div>'
        files.insert(0, ("cover.xhtml", "Cover", _xhtml("Cover", page)))
    modified = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = "\n".join(
        f'<item id="s{i}" href="{name}" media-type="application/xhtml+xml"/>'
        for i, (name, _, _) in enumerate(files)
    )
    spine = "\n".join(f'<itemref idref="s{i}"/>' for i in range(len(files)))
    manifest += "\n" + "\n".join(
        f'<item id="img-{id_}" href="images/{id_}.{data[1].split("/")[1]}" media-type="{data[1]}"'
        + (' properties="cover-image"' if id_ == cover_id else "")
        + "/>"
        for id_, data in (images or {}).items()
    )
    creator = f"<dc:creator>{escape(author_name)}</dc:creator>\n" if author_name else ""
    opf = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        f'<dc:identifier id="uid">urn:uuid:{identifier}</dc:identifier>\n'
        f"<dc:title>{escape(title)}</dc:title>\n<dc:language>en</dc:language>\n"
        f"{creator}"
        f'<meta property="dcterms:modified">{modified}</meta>\n</metadata>\n'
        '<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" '
        'properties="nav"/>\n<item id="css" href="style.css" media-type="text/css"/>\n'
        f"{manifest}\n</manifest>\n<spine>\n{spine}\n</spine>\n</package>\n"
    )
    toc = "\n".join(f'<li><a href="{name}">{escape(label)}</a></li>' for name, label, _ in files)
    nav = _xhtml("Contents", f'<nav epub:type="toc"><h1>Contents</h1><ol>\n{toc}\n</ol></nav>')
    container = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n'
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as book:
        # The spec requires `mimetype` first and uncompressed.
        book.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        book.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        book.writestr("OEBPS/style.css", _CSS, compress_type=zipfile.ZIP_DEFLATED)
        for name, _, content in files:
            book.writestr(f"OEBPS/{name}", content, compress_type=zipfile.ZIP_DEFLATED)
        for id_, data in (images or {}).items():
            book.writestr(f"OEBPS/images/{id_}.{data[1].split('/')[1]}", data[0])
    return buffer.getvalue()
