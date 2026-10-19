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
    "edit_distance",
    "lowercase_vocabulary",
    "markers",
    "near_miss_names",
    "paragraph_spans",
    "paragraphs",
    "scan",
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
    excerpt: str
    details: dict[str, str] = field(default_factory=dict)

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


def _excerpt(text: str, start: int, end: int) -> str:
    left = max(0, start - EXCERPT_CONTEXT)
    right = min(len(text), end + EXCERPT_CONTEXT)
    if left > 0 and " " in text[left:start]:
        left = text.index(" ", left) + 1
    if right < len(text) and " " in text[end:right]:
        right = text.rindex(" ", end, right)
    body = " ".join(text[left:right].split())
    return f"{'…' if left > 0 else ''}{body}{'…' if right < len(text) else ''}"


def scan(scenes: Iterable[Scene], matcher: Matcher) -> Iterator[ProseMatch]:
    """Every match in the given scenes, in the order given, paragraph by paragraph."""
    for scene in scenes:
        for number, (offset, text) in enumerate(paragraph_spans(scene.content), start=1):
            visible = _IMAGE.sub(lambda image: " " * len(image.group()), text)
            for start, end, details in matcher(visible):
                yield ProseMatch(
                    scene=scene,
                    paragraph=number,
                    start=offset + start,
                    end=offset + end,
                    text=text[start:end],
                    excerpt=_excerpt(text, start, end),
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


def edit_distance(a: str, b: str, limit: int) -> int:
    """Edit distance counting a swap of neighbouring letters as one edit; stops early
    and returns limit + 1 once the distance must exceed `limit`."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    previous2: list[int] = []
    previous = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        current = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                current[j] = min(current[j], previous2[j - 2] + 1)
        if min(current) > limit:
            return limit + 1
        previous2, previous = previous, current
    return previous[-1]


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


MIN_NAME_LENGTH = 4


def _allowed_edits(token: str) -> int:
    return 1 if len(token) <= 6 else 2


def near_miss_names(sources: Iterable[NameSource], common_words: set[str]) -> Matcher:
    """Capitalised words that are not a defined name but are one or two letters away from
    one (Maia for Maya, Ellowen for Elowen).

    `common_words` holds words (casefolded) known to be ordinary vocabulary, usually every
    word the manuscript also uses in lower case, so sentence-initial words such as "Many"
    are not mistaken for "Mary". Details carry the matched name's `entity_type`,
    `entity_id`, `name` and the defined `token` it resembles.
    """
    known: dict[str, NameSource] = {}
    for source in sources:
        for token in source.tokens():
            known.setdefault(token, source)
    targets = [(token, source) for token, source in known.items() if len(token) >= MIN_NAME_LENGTH]

    def match(text: str) -> Iterator[tuple[int, int, dict[str, str]]]:
        for found in _WORD.finditer(text):
            word = found.group()
            folded = word.casefold()
            if (
                len(word) < MIN_NAME_LENGTH
                or not word[0].isupper()
                or folded in known
                or folded in common_words
            ):
                continue
            best: tuple[int, str, NameSource] | None = None
            for token, source in targets:
                limit = _allowed_edits(token)
                distance = edit_distance(folded, token, limit)
                if distance <= limit and (best is None or distance < best[0]):
                    best = (distance, token, source)
            if best is not None:
                _, token, source = best
                yield (
                    found.start(),
                    found.end(),
                    {
                        "entity_type": source.entity_type,
                        "entity_id": str(source.entity_id),
                        "name": source.name,
                        "token": token,
                    },
                )

    return match


def lowercase_vocabulary(scenes: Iterable[Scene]) -> set[str]:
    """Every word the prose uses at least once starting with a lower-case letter."""
    words: set[str] = set()
    for scene in scenes:
        for word in _WORD.findall(_IMAGE.sub(" ", scene.content or "")):
            if word[0].islower():
                words.add(word.casefold())
    return words
