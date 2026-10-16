"""Bounded SQL search: only matching excerpts leave the database for text searches."""

from typing import Any
from uuid import UUID

from sqlalchemy import String, case, cast, func, literal, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
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


def text_column(model: Any, field: str) -> Any:
    column = getattr(model, field)
    if field in ARRAY_FIELDS:
        array = case(
            (func.jsonb_typeof(column) == "array", column),
            else_=cast(literal("[]"), JSONB),
        )
        values = func.jsonb_array_elements_text(array).table_valued("value")
        return select(func.string_agg(values.c.value, "\n")).scalar_subquery()
    return column


def fields_query(story_id: Any, context: str, field: str | None = None) -> Any:
    queries = []
    for kind in CONTEXTS[context]:
        model, names = FIELDS[kind]
        if context == "timeline":
            names = tuple(
                name
                for name in names
                if name
                in {
                    "title",
                    "summary",
                    "label",
                    "description",
                    "display_label",
                }
            )
        title_field = next(
            (name for name in ("name", "term", "title", "label") if hasattr(model, name)), None
        )
        display_kind = "scene" if kind == "prose" else kind
        title = func.coalesce(getattr(model, title_field), f"Untitled {display_kind}")
        for name in names:
            if field and name != field:
                continue
            value = text_column(model, name)
            chapter_id = Scene.chapter_id if model is Scene else literal(None, type_=String)
            chapter_title = Chapter.title if model is Scene else literal(None, type_=String)
            chapter_sort = func.coalesce(Chapter.sort_key, 1e30) if model is Scene else literal(0)
            chapter_number = func.coalesce(Chapter.number, 0) if model is Scene else literal(0)
            chapter_tie = cast(Chapter.id, String) if model is Scene else literal("")
            sort = getattr(model, "sort_key", literal(0))
            query = select(
                cast(Story.id, String).label("story_id"),
                Story.title.label("story_title"),
                literal("scene" if kind == "prose" else kind).label("entity"),
                cast(model.id, String).label("id"),
                title.label("title"),
                cast(chapter_id, String).label("chapter_id"),
                chapter_title.label("chapter_title"),
                chapter_sort.label("chapter_sort"),
                chapter_number.label("chapter_number"),
                func.coalesce(chapter_tie, "").label("chapter_tie"),
                sort.label("sort"),
                literal(name).label("field"),
                value.label("value"),
            )
            owner_key = model.id if model is Story else model.story_id
            query = query.where(
                owner_key == story_id if isinstance(story_id, UUID) else owner_key.in_(story_id)
            )
            if model is Scene:
                query = query.outerjoin(Chapter, Scene.chapter_id == Chapter.id)
            if model is not Story:
                query = query.join(Story, Story.id == model.story_id)
            queries.append(query.where(value.is_not(None), value != ""))
    if not queries:
        raise ValueError("Field is not available in this search context")
    return union_all(*queries).cte("search_fields")


def allowed_fields(context: str) -> set[str]:
    fields = {name for kind in CONTEXTS[context] for name in FIELDS[kind][1]}
    return (
        fields & {"title", "summary", "label", "description", "display_label"}
        if context == "timeline"
        else fields
    )


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


def literal_pattern(query: str) -> str:
    return "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


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
    source = fields_query(story_id, context, field)
    if entity:
        source = select(source).where(source.c.entity == entity).cte("restricted_fields")
    c = source.c
    start = func.greatest(1, func.strpos(func.lower(c.value), query.lower()) - 65)
    window = len(query) + 150
    excerpt = func.substring(c.value, start, window)
    rank = case(
        (c.field.in_(TITLE_FIELDS) & (func.lower(c.value) == query.lower()), 0),
        (c.field.in_(TITLE_FIELDS), 1),
        else_=2,
    )
    columns = [
        c.story_id,
        c.story_title,
        c.entity,
        c.id,
        c.title,
        c.chapter_id,
        c.chapter_title,
        c.chapter_sort,
        c.chapter_number,
        c.chapter_tie,
        c.sort,
    ]
    matches = func.jsonb_agg(
        func.jsonb_build_object(
            "field",
            c.field,
            "excerpt",
            excerpt,
            "cut_start",
            start > 1,
            "cut_end",
            start + window <= func.length(c.value),
        )
    )
    results = await db.execute(
        select(*columns, matches.label("matches"), func.min(rank).label("rank"))
        .where(c.value.ilike(literal_pattern(query), escape="\\"))
        .group_by(*columns)
        .order_by(
            func.min(rank), c.chapter_sort, c.chapter_number, c.chapter_tie, c.sort, c.entity, c.id
        )
        .offset(offset)
        .limit(limit + 1)
    )
    rows = results.mappings().all()
    return SearchPage(
        items=[
            SearchHit(
                story_id=row["story_id"],
                story_title=row["story_title"],
                entity=row["entity"],
                id=row["id"],
                title=row["title"],
                chapter_id=row["chapter_id"],
                chapter_title=row["chapter_title"],
                matches=[
                    SearchMatch(
                        field=match["field"],
                        excerpt=tidy_excerpt(
                            match["excerpt"], match["cut_start"], match["cut_end"]
                        ),
                    )
                    for match in row["matches"]
                ],
            )
            for row in rows[:limit]
        ],
        next_offset=offset + limit if len(rows) > limit else None,
    )
