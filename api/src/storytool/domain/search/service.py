"""Text search over a story's authored fields.

Story text is encrypted at rest, so fields are read and decrypted, then matched in Python
(accent- and case-insensitive), ranked and paged the way the SQL version did."""

import json
import unicodedata
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Character
from storytool.domain.glossary import GlossaryEntry
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.search.schemas import SearchHit, SearchMatch, SearchPage
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread
from storytool.domain.world.models import Location

# Explicit authored fields, never UUIDs, revision history, reports or agent conversations.
FIELDS: dict[str, tuple[Any, tuple[str, ...]]] = {
    "story": (
        Story,
        (
            "title",
            "premise",
            "blurb",
            "thematic_statement",
            "notes",
            "motifs",
            "world_rules",
            "style_rules",
        ),
    ),
    "scene": (Scene, ("title", "summary", "notes", "goal", "conflict", "outcome")),
    "prose": (Scene, ("content",)),
    "character": (
        Character,
        (
            "name",
            "aliases",
            "description",
            "wound",
            "misbelief",
            "want",
            "need",
            "voice_notes",
            "relation_to_protagonist",
            "notes",
        ),
    ),
    "location": (Location, ("name", "description", "atmosphere_notes")),
    "glossary_entry": (GlossaryEntry, ("term", "aliases", "definition")),
    "chapter": (Chapter, ("title", "summary", "epigraph", "opening_note", "closing_note")),
    "event": (Event, ("label", "description", "display_label")),
    "act": (Act, ("title", "summary")),
    "beat": (Beat, ("label", "description")),
    "thread": (Thread, ("title",)),
}
CONTEXTS = {key: (key,) for key in FIELDS}
CONTEXTS["timeline"] = ("event", "scene")
CONTEXTS["all"] = tuple(FIELDS)
ARRAY_FIELDS = {"aliases", "motifs", "world_rules", "style_rules"}
TITLE_FIELDS = {"name", "title", "term", "label", "aliases"}
TIMELINE_FIELDS = {"title", "summary", "label", "description", "display_label"}


def field_text(value: Any, name: str) -> str | None:
    """A field's searchable text; list fields (aliases, rules) are one line per item."""
    if name in ARRAY_FIELDS:
        if not isinstance(value, list):
            return None
        return "\n".join(item if isinstance(item, str) else json.dumps(item) for item in value)
    return value if isinstance(value, str) else None


async def load_fields(
    db: AsyncSession,
    story_id: Any,
    context: str,
    field: str | None = None,
    entity: str | None = None,
) -> list[dict[str, Any]]:
    """Every searchable field of the story (or stories), read and decrypted.

    Story text is encrypted at rest, so searching happens in Python over these rows; each row
    carries what a hit shows (titles, chapter) and what results are ordered by.
    """
    # One story, a list of ids, or a query of ids (library: owner and trash filters stay in SQL).
    scope = [story_id] if isinstance(story_id, UUID) else story_id
    stories = {
        story.id: story for story in await db.scalars(select(Story).where(Story.id.in_(scope)))
    }
    if not stories:
        return []
    chapters: dict[Any, Chapter] | None = None
    rows: list[dict[str, Any]] = []
    for kind in CONTEXTS[context]:
        display_kind = "scene" if kind == "prose" else kind
        if entity and display_kind != entity:
            continue
        model, names = FIELDS[kind]
        if context == "timeline":
            names = tuple(name for name in names if name in TIMELINE_FIELDS)
        names = tuple(name for name in names if not field or name == field)
        if not names:
            continue
        title_field = next(
            (name for name in ("name", "term", "title", "label") if hasattr(model, name)), None
        )
        if model is Story:
            records: Any = list(stories.values())
        else:
            records = await db.scalars(select(model).where(model.story_id.in_(list(stories))))
        if model is Scene and chapters is None:
            chapters = {
                chapter.id: chapter
                for chapter in await db.scalars(
                    select(Chapter).where(Chapter.story_id.in_(list(stories)))
                )
            }
        for record in records:
            story = record if model is Story else stories.get(record.story_id)
            if story is None:
                continue
            chapter = (chapters or {}).get(record.chapter_id) if model is Scene else None
            title = getattr(record, title_field) if title_field else None
            for name in names:
                value = field_text(getattr(record, name), name)
                if not value:
                    continue
                rows.append(
                    {
                        "story_id": str(story.id),
                        "story_title": story.title,
                        "entity": display_kind,
                        "id": str(record.id),
                        "title": title if title is not None else f"Untitled {display_kind}",
                        "chapter_id": str(record.chapter_id)
                        if model is Scene and record.chapter_id
                        else None,
                        "chapter_title": chapter.title if chapter else None,
                        "chapter_sort": (
                            chapter.sort_key
                            if chapter and chapter.sort_key is not None
                            else (1e30 if model is Scene else 0)
                        ),
                        "chapter_number": (chapter.number or 0) if chapter else 0,
                        "chapter_tie": str(chapter.id) if chapter else "",
                        "sort": getattr(record, "sort_key", 0),
                        "field": name,
                        "value": value,
                    }
                )
    return rows


def allowed_fields(context: str) -> set[str]:
    fields = {name for kind in CONTEXTS[context] for name in FIELDS[kind][1]}
    return fields & TIMELINE_FIELDS if context == "timeline" else fields


def tidy_excerpt(text: str, cut_start: bool, cut_end: bool) -> str:
    """Trim a window's partial first/last words and mark the cuts with ellipses."""
    if cut_start:
        space = next((i for i, ch in enumerate(text[:25]) if ch.isspace()), -1)
        text = "…" + (text[space + 1 :] if space >= 0 else text).lstrip()
    if cut_end:
        space = max(
            (i for i, ch in enumerate(text) if ch.isspace() and i >= len(text) - 25), default=-1
        )
        text = (text[:space] if space > 0 else text).rstrip() + "…"
    return text


def fold(text: str) -> tuple[str, list[int]]:
    """Lower-case, accent-free text, with each folded character's index in the original.

    "Jose" finds "José" and "José" finds "Jose"; mapping back keeps excerpts aligned even when
    folding changes the length (a ligature becomes two letters).
    """
    folded: list[str] = []
    origin: list[int] = []
    for index, char in enumerate(text):
        plain = "".join(
            c for c in unicodedata.normalize("NFKD", char) if not unicodedata.combining(c)
        ).lower()
        folded.append(plain)
        origin.extend([index] * len(plain))
    return "".join(folded), origin


def order_key(row: dict[str, Any], rank: int) -> tuple[Any, ...]:
    sort = row["sort"]
    return (
        rank,
        row["chapter_sort"],
        row["chapter_number"],
        row["chapter_tie"],
        (sort is None, sort if sort is not None else 0),
        row["entity"],
        row["id"],
    )


async def text_search(
    db: AsyncSession,
    story_id: Any,
    context: str,
    query: str,
    field: str | None,
    offset: int,
    limit: int,
    entity: str | None = None,
) -> SearchPage:
    plain_query = fold(query)[0]
    window = len(query) + 150
    hits: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in await load_fields(db, story_id, context, field, entity):
        plain, origin = fold(row["value"])
        at = plain.find(plain_query)
        if at < 0 or not plain_query:
            continue
        # Same window as before: from 65 characters ahead of the match, query length + 150.
        start = max(1, origin[at] + 1 - 65)
        excerpt = row["value"][start - 1 : start - 1 + window]
        rank = (0 if plain == plain_query else 1) if row["field"] in TITLE_FIELDS else 2
        key = (row["story_id"], row["entity"], row["id"])
        hit = hits.setdefault(key, {"row": row, "rank": rank, "matches": []})
        hit["rank"] = min(hit["rank"], rank)
        hit["matches"].append(
            SearchMatch(
                field=row["field"],
                excerpt=tidy_excerpt(excerpt, start > 1, start + window <= len(row["value"])),
            )
        )
    ordered = sorted(hits.values(), key=lambda hit: order_key(hit["row"], hit["rank"]))
    page = ordered[offset : offset + limit + 1]
    return SearchPage(
        items=[
            SearchHit(
                story_id=hit["row"]["story_id"],
                story_title=hit["row"]["story_title"],
                entity=hit["row"]["entity"],
                id=hit["row"]["id"],
                title=hit["row"]["title"],
                chapter_id=hit["row"]["chapter_id"],
                chapter_title=hit["row"]["chapter_title"],
                matches=hit["matches"],
            )
            for hit in page[:limit]
        ],
        next_offset=offset + limit if len(page) > limit else None,
    )
