"""Bounded relevance scoring for Related results; preserve fallback pagination."""

from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.decisions.providers import shared_provider
from storytool.domain.decisions.service import Actor, DecisionService, DecisionUnavailable
from storytool.domain.decisions.types import Score
from storytool.domain.search.schemas import SearchPage


async def rerank_related(
    db: AsyncSession, actor: Actor, query: str, page: SearchPage
) -> SearchPage:
    if not page.items or not get_settings().shared_reader_available:
        return page
    provider, model = shared_provider()
    service = DecisionService(db, actor, provider)
    state = {
        "query": query,
        "candidates": [
            {
                "index": index,
                "title": hit.title[:200],
                "excerpts": [match.excerpt[:300] for match in hit.matches[:2]],
            }
            for index, hit in enumerate(page.items)
        ],
    }
    questions = {
        str(index): Score(
            instructions=(
                f"How relevant is candidate {index} to the query's intended meaning? "
                "Use only the supplied excerpt; do not invent missing context."
            ),
            criteria=[
                "Unrelated.",
                "Weak or incidental connection.",
                "Relevant supporting passage.",
                "Directly answers or strongly matches the query.",
            ],
        )
        for index in range(len(page.items))
    }
    await db.commit()
    try:
        reading = await service.evaluate(model=model, state=state, questions=questions)
    except DecisionUnavailable:
        return page
    if any((answer.confidence or 0) < 0.7 for answer in reading.answers.values()):
        return page
    # Reorder only this page; retain the original offset and all candidates.
    page.items = [
        hit
        for index, hit in sorted(
            enumerate(page.items),
            key=lambda pair: (-(reading.answers[str(pair[0])].score or 0), pair[0]),
        )
    ]
    return page
