"""Optional semantic index. Disabled means no provider calls and no indexing worker."""

import asyncio
import hashlib
import json
import logging
import math
from contextlib import asynccontextmanager, suppress
from typing import Any
from uuid import UUID

import httpx
from litestar.exceptions import ClientException
from sqlalchemy import String, cast, column, delete, func, or_, select, text, values

from storytool.config import get_settings
from storytool.db.encryption import digest as content_digest
from storytool.domain.search.models import SearchChunk, SearchIndex
from storytool.domain.search.schemas import SearchHit, SearchMatch, SearchPage
from storytool.domain.search.service import load_fields, tidy_excerpt
from storytool.domain.story.models import Story

log = logging.getLogger("storytool.search")


def profile() -> str:
    settings = get_settings()
    return hashlib.sha256(
        json.dumps(
            [
                settings.search_embedding_url,
                settings.search_embedding_model,
                settings.search_embedding_dimensions,
                settings.search_embedding_max_input_bytes,
                "chunks-v2",
            ]
        ).encode()
    ).hexdigest()


def chunks(
    value: str, size: int = 2000, overlap: int = 200, max_bytes: int | None = None
) -> list[str]:
    if max_bytes:
        data = value.encode("utf-8")
        result, start = [], 0
        while start < len(data):
            end = min(start + max_bytes, len(data))
            while end < len(data) and data[end] & 0xC0 == 0x80:
                end -= 1
            result.append(data[start:end].decode("utf-8"))
            if end == len(data):
                break
            start = end - min(overlap, max_bytes // 5)
            while data[start] & 0xC0 == 0x80:
                start += 1
        return result
    result = []
    for start in range(0, len(value), size - overlap):
        result.append(value[start : start + size])
        if start + size >= len(value):
            break
    return result


async def embed(values: list[str]) -> list[list[float]]:
    settings = get_settings()
    if not settings.semantic_search_available:
        raise ClientException(status_code=503, detail="Meaning search is not enabled yet")
    if settings.search_embedding_max_input_bytes and any(
        len(value.encode("utf-8")) > settings.search_embedding_max_input_bytes for value in values
    ):
        raise ClientException(
            detail="This query exceeds the model's input limit. Shorten it and retry."
        )
    vectors = []
    # Adapter contract: OpenAI-compatible embeddings endpoint, with no default provider/model.
    async with httpx.AsyncClient(timeout=60) as client:
        for start in range(0, len(values), 32):
            batch = values[start : start + 32]
            response = await client.post(
                settings.search_embedding_url,
                headers={"Authorization": f"Bearer {settings.search_embedding_api_key}"},
                json={"model": settings.search_embedding_model, "input": batch},
            )
            response.raise_for_status()
            data = sorted(response.json()["data"], key=lambda row: row["index"])
            if [row["index"] for row in data] != list(range(len(batch))):
                raise ValueError("Embedding endpoint returned an incomplete batch")
            for row in data:
                vector = row["embedding"]
                if (
                    len(vector) != settings.search_embedding_dimensions
                    or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector)
                    or not any(vector)
                ):
                    raise ValueError("Embedding endpoint returned an invalid vector")
                vectors.append(vector)
    return vectors


async def index_story(config: Any, story_id: UUID) -> None:
    if not get_settings().semantic_search_available:
        return
    current_profile = profile()
    async with config.get_session() as db:
        story = await db.get(Story, story_id)
        if not story or story.deleted_at:
            return
        source_updated_at = story.updated_at
        rows = await load_fields(db, story_id, "all")
        cached = (
            await db.execute(
                select(SearchChunk.content_hash, SearchChunk.embedding).where(
                    SearchChunk.story_id == story_id, SearchChunk.profile == current_profile
                )
            )
        ).all()
    cache = dict(cached)
    documents = []
    missing: dict[str, str] = {}
    for row in rows:
        for ordinal, value in enumerate(
            chunks(row["value"], max_bytes=get_settings().search_embedding_max_input_bytes)
        ):
            # Keyed when story text is encrypted, so stored hashes cannot confirm guesses.
            digest = content_digest(value)
            documents.append(
                dict(
                    story_id=story_id,
                    entity=row["entity"],
                    entity_id=UUID(row["id"]),
                    field=row["field"],
                    ordinal=ordinal,
                    content=value,
                    content_hash=digest,
                    profile=current_profile,
                )
            )
            if digest not in cache:
                missing[digest] = value
    if missing:
        cache.update(zip(missing, await embed(list(missing.values())), strict=True))
    async with config.get_session() as db:
        # Recheck after provider calls. Concurrent edits are retried on the next pass.
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"search:{story_id}"}
        )
        source = (
            await db.execute(
                select(Story.updated_at, Story.deleted_at)
                .where(Story.id == story_id)
                .with_for_update()
            )
        ).one_or_none()
        if not source or source.deleted_at or source.updated_at != source_updated_at:
            return
        await db.execute(delete(SearchChunk).where(SearchChunk.story_id == story_id))
        db.add_all(
            [SearchChunk(**item, embedding=cache[item["content_hash"]]) for item in documents]
        )
        state = await db.scalar(select(SearchIndex).where(SearchIndex.story_id == story_id))
        if state:
            state.source_updated_at, state.profile = source_updated_at, current_profile
        else:
            db.add(
                SearchIndex(
                    story_id=story_id, source_updated_at=source_updated_at, profile=current_profile
                )
            )
        await db.commit()


def search_lifespan(config: Any) -> Any:
    @asynccontextmanager
    async def lifespan(app: Any) -> Any:
        async def worker() -> None:
            while True:
                try:
                    async with config.get_session() as db:
                        ids = (
                            await db.scalars(
                                select(Story.id)
                                .outerjoin(
                                    SearchIndex,
                                    SearchIndex.story_id == Story.id,
                                )
                                .where(
                                    Story.deleted_at.is_(None),
                                    or_(
                                        SearchIndex.id.is_(None),
                                        SearchIndex.profile != profile(),
                                        SearchIndex.source_updated_at != Story.updated_at,
                                    ),
                                )
                                .order_by(Story.updated_at)
                                .limit(10)
                            )
                        ).all()
                    for story_id in ids:
                        try:
                            await index_story(config, story_id)
                        except Exception as exc:
                            log.warning("Semantic indexing retry needed (%s)", type(exc).__name__)
                except Exception as exc:
                    log.warning("Semantic indexing unavailable (%s)", type(exc).__name__)
                await asyncio.sleep(30)

        task = asyncio.create_task(worker()) if get_settings().semantic_search_available else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return lifespan


def ready_stories(story_id: Any, current_profile: str) -> Any:
    return (
        select(Story.id)
        .join(SearchIndex, Story.id == SearchIndex.story_id)
        .where(
            Story.id == story_id if isinstance(story_id, UUID) else Story.id.in_(story_id),
            Story.deleted_at.is_(None),
            SearchIndex.profile == current_profile,
            SearchIndex.source_updated_at == Story.updated_at,
        )
    )


async def index_ready(db: Any, story_id: UUID, current_profile: str) -> bool:
    return bool(await db.scalar(ready_stories(story_id, current_profile)))


async def library_indexing(db: Any, story_scope: Any, current_profile: str) -> bool:
    ready = ready_stories(story_scope, current_profile)
    return bool(
        await db.scalar(
            select(
                select(Story.id)
                .where(
                    Story.id.in_(story_scope),
                    Story.id.not_in(ready),
                    Story.deleted_at.is_(None),
                )
                .exists()
            )
        )
    )


async def semantic_search(
    db: Any,
    story_id: Any,
    context: str,
    query: str,
    field: str | None,
    offset: int,
    limit: int,
    entity: str | None = None,
    *, query_vector: list[float] | None = None,
) -> SearchPage:
    current_profile = profile()
    library = not isinstance(story_id, UUID)
    scope = ready_stories(story_id, current_profile) if library else story_id
    if library and not await db.scalar(select(scope.exists())):
        return SearchPage(
            items=[],
            semantic_available=True,
            indexing=await library_indexing(db, story_id, current_profile),
        )
    if not library and not await index_ready(db, story_id, current_profile):
        return SearchPage(items=[], semantic_available=True, indexing=True)
    await db.rollback()  # No transaction held across the remote call.
    try:
        vector = query_vector if query_vector is not None else (
            await embed([get_settings().search_embedding_query_prefix + query])
        )[0]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise ClientException(
            status_code=503, detail="Meaning search is unavailable. Retry shortly."
        ) from exc
    # Story text is encrypted at rest: the allowed fields are read and decrypted here and
    # handed to SQL as plain identifiers only.
    scope_ids = list(await db.scalars(scope)) if library else story_id
    fields = await load_fields(db, scope_ids, context, field, entity)
    if not fields:
        return SearchPage(
            items=[],
            semantic_available=True,
            indexing=await library_indexing(db, story_id, current_profile) if library else False,
        )
    info_by_key = {(row["story_id"], row["entity"], row["id"]): row for row in fields}
    allowed = values(
        column("entity", String),
        column("entity_id", String),
        column("field", String),
        name="allowed_fields",
    ).data(sorted({(row["entity"], row["id"], row["field"]) for row in fields}))
    distance = SearchChunk.embedding.op("<=>")(vector)
    ranked = (
        select(
            SearchChunk.story_id,
            SearchChunk.entity,
            SearchChunk.entity_id,
            SearchChunk.field,
            SearchChunk.content,
            distance.label("distance"),
            func.row_number()
            .over(
                partition_by=(SearchChunk.story_id, SearchChunk.entity, SearchChunk.entity_id),
                order_by=(distance, SearchChunk.field, SearchChunk.ordinal),
            )
            .label("position"),
        )
        .join(
            allowed,
            (allowed.c.entity == SearchChunk.entity)
            & (allowed.c.entity_id == cast(SearchChunk.entity_id, String))
            & (allowed.c.field == SearchChunk.field),
        )
        .where(
            SearchChunk.story_id == story_id if not library else SearchChunk.story_id.in_(scope),
            SearchChunk.profile == current_profile,
        )
        .cte("ranked_search")
    )
    rows = (
        (
            await db.execute(
                select(ranked)
                .where(ranked.c.position == 1)
                .order_by(ranked.c.distance, ranked.c.entity, ranked.c.entity_id)
                .offset(offset)
                .limit(limit + 1)
            )
        )
        .mappings()
        .all()
    )
    if not library and not await index_ready(db, story_id, current_profile):
        return SearchPage(items=[], semantic_available=True, indexing=True)
    hits = []
    for row in rows[:limit]:
        info = info_by_key.get((str(row["story_id"]), row["entity"], str(row["entity_id"])))
        if info:
            hits.append(
                SearchHit(
                    story_id=info["story_id"],
                    story_title=info["story_title"],
                    entity=row["entity"],
                    id=row["entity_id"],
                    title=info["title"],
                    chapter_id=info["chapter_id"],
                    chapter_title=info["chapter_title"],
                    matches=[
                        SearchMatch(
                            field=row["field"],
                            excerpt=tidy_excerpt(
                                row["content"][:300], False, len(row["content"]) > 300
                            ),
                        )
                    ],
                )
            )
    return SearchPage(
        items=hits,
        next_offset=offset + limit if len(rows) > limit else None,
        semantic_available=True,
        indexing=await library_indexing(db, story_id, current_profile) if library else False,
    )
