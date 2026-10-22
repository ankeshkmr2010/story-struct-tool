"""Where a renamed character or place still appears in the prose, and what to write instead.

Renaming an entity changes its sheet, not the manuscript. This finds every use of the old
name in placed scenes (reading order, via `prose_scan`, so passages open and edit exactly as
other checks do) and pairs each with its replacement. The page shows them for the author to
untick any, then applies the rest as verified, snapshotted edits. Nothing here edits a story.

Matching is whole-word and case-aware: "Maya" and "MAYA" are found, "Mayan" is not, and a
possessive keeps its ending ("Maya's" becomes "Kate's"). For a multi-word name the full name
is offered first, then each changed word on its own ("Maya" alone for "Maya Torres" →
"Kate Torres"), kept as a separate group so a surname shared with relatives can be skipped.
"""

import re
from uuid import UUID

from litestar import Controller, get
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.evaluation.controller import PassageOut
from storytool.domain.graph import StoryGraph
from storytool.domain.prose_scan import scan

__all__ = ("NameUsesOut", "RenameController", "name_uses", "replacement_plan")

_LETTER = r"[^\W_]"


def replacement_plan(old: str, new: str) -> list[tuple[str, str, str]]:
    """(find, replace with, group) pairs, longest first; group is "full" or "part"."""
    old, new = " ".join(old.split()), " ".join(new.split())
    if not old or not new or old == new:
        return []
    plan = [(old, new, "full")]
    old_words, new_words = old.split(), new.split()
    if len(old_words) > 1:
        pairs = (
            list(zip(old_words, new_words, strict=True))
            if len(old_words) == len(new_words)
            else [(old_words[0], new_words[0])]
        )
        for before, after in pairs:
            if before != after and len(before) > 1 and not before.endswith("."):
                plan.append((before, after, "part"))
    variants = []
    for find, replace, group in plan:
        variants.append((find, replace, group))
        if find.upper() != find:
            variants.append((find.upper(), replace.upper(), group))
    return sorted(variants, key=lambda item: -len(item[0]))


def name_uses(g: StoryGraph, old: str, new: str) -> list[dict]:
    plan = replacement_plan(old, new)
    if not plan:
        return []
    lookup = {find: (replace, group) for find, replace, group in plan}
    pattern = re.compile(
        rf"(?<!{_LETTER})(?<![-\u2010])(?:{'|'.join(re.escape(find) for find, _, _ in plan)})"
        rf"(?![-\u2010]?{_LETTER})"
    )

    def matcher(text: str):
        for found in pattern.finditer(text):
            replace, group = lookup[found.group()]
            yield found.start(), found.end(), {"replacement": replace, "group": group}

    return [
        {
            "passage": PassageOut.of(match.passage),
            "replacement": match.details["replacement"],
            "group": match.details["group"],
        }
        for match in scan(g.scenes_in_reading_order(), matcher)
    ]


class NameUseOut(BaseModel):
    passage: PassageOut
    replacement: str
    group: str
    """"full" for the whole old name, "part" for one changed word of it."""


class NameUsesOut(BaseModel):
    name: str
    replacement: str
    uses: list[NameUseOut]


class RenameController(Controller):
    path = "/api/stories/{story_id:uuid}/name-uses"
    tags = ["story"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get(summary="Where an old name still appears in the prose, with its replacement")
    async def uses(
        self, db_session: AsyncSession, story_id: UUID, name: str, replacement: str
    ) -> NameUsesOut:
        if not name.strip() or not replacement.strip():
            raise ClientException(detail="Both the old and the new name are needed")
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return NameUsesOut(
            name=name,
            replacement=replacement,
            uses=[NameUseOut(**use) for use in name_uses(graph, name, replacement)],
        )
