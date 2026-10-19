"""Deterministic prose scanning: find text in scene prose and say exactly where it is.

One walker serves every check that reads prose without AI -- Evaluate checks, the export
warning and the MCP check tool -- so they agree on what was found and where. Positions use
the writer's paragraph convention (blank-line separated, empty blocks skipped, numbered from
1), so a match opens at the same passage in Write. Image markup is masked before matching,
so alt text and file names never produce findings. Nothing here is stored.
"""

import re
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from uuid import UUID

from storytool.domain.narrative.models import Scene

__all__ = (
    "Matcher",
    "NameSource",
    "Passage",
    "ProseMatch",
    "excerpt_around",
    "markers",
    "paragraph_spans",
    "paragraphs",
    "scan",
    "visible_text",
)

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_IMAGE = re.compile(r"!\[[^\]\n]*\]\([^\n)]*\)")
_MARKER = re.compile(r"\[(?P<kind>[A-Za-z]+)(?:[ \t]*:[ \t]*(?P<note>[^\]\n]*))?\]")
_WORD = re.compile(r"[^\W\d_]+")
EXCERPT_CONTEXT = 40

Matcher = Callable[[str], Iterable[tuple[int, int, dict[str, str]]]]
"""Takes one paragraph; yields (start, end, details) for each match within it."""


@dataclass(frozen=True, slots=True)
class Passage:
    """Where a finding sits: the exact text to select inside a numbered paragraph, and its
    character offsets in the scene's saved content, so an edit can verify and replace it."""

    scene_id: UUID
    paragraph: int
    find: str
    start: int
    end: int
    excerpt: str


@dataclass(frozen=True, slots=True)
class ProseMatch:
    scene: Scene
    paragraph: int
    start: int
    """Offset in the scene's whole content, not in the paragraph."""
    end: int
    text: str
    paragraph_text: str = field(repr=False)
    paragraph_offset: int = field(repr=False)
    details: dict[str, str] = field(default_factory=dict)

    @property
    def excerpt(self) -> str:
        """Computed on demand: a scan can match every word, but few become findings."""
        start = self.start - self.paragraph_offset
        return excerpt_around(self.paragraph_text, start, start + len(self.text))

    @property
    def passage(self) -> Passage:
        return Passage(
            scene_id=self.scene.id,
            paragraph=self.paragraph,
            find=self.text,
            start=self.start,
            end=self.end,
            excerpt=self.excerpt,
        )


def paragraph_spans(content: str | None) -> list[tuple[int, str]]:
    """(offset in content, text) of each non-empty paragraph."""
    text, spans, start = content or "", [], 0
    for brk in _PARAGRAPH_BREAK.finditer(text):
        spans.append((start, text[start : brk.start()]))
        start = brk.end()
    spans.append((start, text[start:]))
    return [(offset, part) for offset, part in spans if part.strip()]


def paragraphs(content: str | None) -> list[str]:
    return [part for _, part in paragraph_spans(content)]


def excerpt_around(text: str, start: int, end: int) -> str:
    left = max(0, start - EXCERPT_CONTEXT)
    right = min(len(text), end + EXCERPT_CONTEXT)
    if left > 0 and " " in text[left:start]:
        left = text.index(" ", left) + 1
    if right < len(text) and " " in text[end:right]:
        right = text.rindex(" ", end, right)
    body = " ".join(text[left:right].split())
    return f"{'…' if left > 0 else ''}{body}{'…' if right < len(text) else ''}"


def visible_text(paragraph: str) -> str:
    """The paragraph with image markup blanked out, keeping every offset."""
    return _IMAGE.sub(lambda image: " " * len(image.group()), paragraph)


def scan(scenes: Iterable[Scene], matcher: Matcher) -> Iterator[ProseMatch]:
    """Every match in the given scenes, in the order given, paragraph by paragraph."""
    for scene in scenes:
        for number, (offset, text) in enumerate(paragraph_spans(scene.content), start=1):
            for start, end, details in matcher(visible_text(text)):
                yield ProseMatch(
                    scene=scene,
                    paragraph=number,
                    start=offset + start,
                    end=offset + end,
                    text=text[start:end],
                    paragraph_text=text,
                    paragraph_offset=offset,
                    details=details,
                )


def markers(*kinds: str) -> Matcher:
    """Bracketed author markers such as `[TK]` or `[TK: name of the inn]`, any case.

    Details carry `kind` (upper case) and `note` (possibly empty). Bare words never match,
    so a marker kind can share its letters with a name or an ordinary word.
    """
    wanted = {kind.upper() for kind in kinds}

    def match(text: str) -> Iterator[tuple[int, int, dict[str, str]]]:
        for found in _MARKER.finditer(text):
            kind = found["kind"].upper()
            if kind in wanted:
                yield (
                    found.start(),
                    found.end(),
                    {"kind": kind, "note": (found["note"] or "").strip()},
                )

    return match


@dataclass(frozen=True, slots=True)
class NameSource:
    """A name the author has defined (character, place, glossary term) and its aliases."""

    entity_type: str
    entity_id: UUID
    name: str
    aliases: tuple[str, ...] = ()

    def tokens(self) -> set[str]:
        return {
            word.casefold() for value in (self.name, *self.aliases) for word in _WORD.findall(value)
        }
