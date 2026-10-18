"""Markdown and plain-text adapter: blank lines separate paragraphs, `#` (or underlined)
headings become heading styles, form feeds are page breaks. Planning is shared (block_import)."""

import re

from storytool.domain.story.block_import import Block, block_adapter

MAX_TEXT_BYTES = 10 * 1024 * 1024
_ATX = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_SETEXT = re.compile(r"^(.+)\n(=+|-+)\s*$")
_EMPHASIS = re.compile(r"^(\*[^*].*[^*]\*|_[^_].*[^_]_)$", re.DOTALL)


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Save the file as UTF-8 text and try again")


def text_blocks(content: bytes) -> list[Block]:
    if b"\x00" in content[:4096]:
        raise ValueError("Choose a Markdown or plain-text file (.md or .txt)")
    text = _decode(content).replace("\r\n", "\n").replace("\r", "\n")
    blocks: list[Block] = []
    for page_number, page in enumerate(text.split("\f")):
        first_on_page = page_number > 0
        for raw in re.split(r"\n\s*\n", page):
            paragraph = raw.strip("\n")
            if not paragraph.strip():
                continue
            style = "Normal"
            if match := _ATX.match(paragraph.strip()):
                style, paragraph = f"Heading {min(len(match.group(1)), 3)}", match.group(2)
            elif (match := _SETEXT.match(paragraph.strip())) and "\n" not in match.group(1):
                style = "Heading 1" if match.group(2).startswith("=") else "Heading 2"
                paragraph = match.group(1)
            blocks.append(
                Block(
                    i=len(blocks),
                    text=paragraph.strip(),
                    style=style,
                    page_break_before=first_on_page,
                    italic=style == "Normal" and bool(_EMPHASIS.match(paragraph.strip())),
                    in_table=False,
                )
            )
            first_on_page = False
    if not blocks:
        raise ValueError("This file contains no prose to import")
    return blocks


TEXT = block_adapter("text", "Markdown or text", MAX_TEXT_BYTES, text_blocks)
