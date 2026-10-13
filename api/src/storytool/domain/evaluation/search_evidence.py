"""Bounded scene retrieval for existing reviews; excerpts are evidence candidates."""

from typing import Any
from uuid import UUID

from litestar.exceptions import ClientException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.search.semantic import embed, index_ready, semantic_search
from storytool.domain.search.service import text_search

MAX_QUERIES = 12
MAX_HITS = 5


async def retrieve_evidence(
    db: AsyncSession, story_id: UUID, inputs: dict[str, Any], motifs: list[str],
) -> dict[str, Any]:
    queries = [("motif", str(motif)[:300]) for motif in motifs if str(motif).strip()]
    for thread in inputs.get("threads", []):
        scenes = thread.get("scenes", [])
        opening = str(scenes[0].get("summary") or "")[:80] if scenes else ""
        closing = str(scenes[-1].get("summary") or "")[:80] if scenes else ""
        queries.append((
            "setup/payoff", f"{thread.get('title', '')}: setup {opening}; payoff {closing}"[:300]
        ))
    for character in inputs.get("characters", []):
        query = (
            f"{character.get('name', '')}: {character.get('misbelief', '')}; "
            "challenge and consequence"
        )
        queries.append(("misbelief", query[:300]))
    if not inputs.get("characters"):
        for scene in inputs.get("scenes", []):
            query = (
                f"{scene.get('title') or ''}: {str(scene.get('goal') or '')[:80]}; "
                f"{str(scene.get('outcome') or '')[:80]}"
            )
            queries.append(("setup/payoff", query[:300]))
    queries = list(dict.fromkeys(queries))
    skipped = max(0, len(queries) - MAX_QUERIES)
    queries = queries[:MAX_QUERIES]
    related_vectors = None
    status = "disabled"
    if get_settings().semantic_search_available and queries:
        from storytool.domain.search.semantic import profile

        try:
            ready = await index_ready(db, story_id, profile())
            if ready:
                await db.rollback()  # Release all read locks before the embedding request.
                prefix = get_settings().search_embedding_query_prefix
                related_vectors = await embed([prefix + query for _, query in queries])
                status = "ready"
            else:
                status = "indexing"
        except Exception:
            await db.rollback()
            status = "unavailable"
    evidence = []
    for index, (purpose, query) in enumerate(queries):
        hits = []
        next_offset = None
        if purpose == "motif":
            exact = await text_search(db, story_id, "prose", query, "content", 0, MAX_HITS)
            next_offset = exact.next_offset
            hits.extend({"match_kind": "exact", **hit.model_dump(mode="json")} for hit in exact.items)
        if related_vectors is not None:
            try:
                related = await semantic_search(
                    db, story_id, "prose", query, "content", 0, MAX_HITS,
                    query_vector=related_vectors[index],
                )
                if related.indexing:
                    status = "indexing"
                seen = {hit["id"] for hit in hits}
                hits.extend(
                    {"match_kind": "related", **hit.model_dump(mode="json")}
                    for hit in related.items if str(hit.id) not in seen
                )
                next_offset = next_offset if next_offset is not None else related.next_offset
            except (ClientException, SQLAlchemyError):
                await db.rollback()
                status = "unavailable"
        evidence.append(dict(purpose=purpose, query=query, hits=hits, next_offset=next_offset))
    return dict(
        semantic_status=status, queries_skipped=skipped, searches=evidence,
        note="Bounded candidate passages, not exhaustive coverage. Exact means literal text; "
        "related means semantic similarity, not proof. Verify against supplied prose/summaries; "
        "if an excerpt lacks context, express uncertainty. Missing/limited/indexing results "
        "do not establish absence.",
    )
