from typing import Literal
from uuid import UUID

from litestar import Controller, get
from litestar.exceptions import ClientException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.search.schemas import SearchCapabilities, SearchContext, SearchHit, SearchPage
from storytool.domain.search.service import CONTEXTS, FIELDS, allowed_fields, text_search


class SearchController(Controller):
    path = "/api/stories/{story_id:uuid}/search"
    tags = ["search"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/capabilities")
    async def capabilities(self, story_id: UUID) -> SearchCapabilities:
        return SearchCapabilities(semantic_available=get_settings().semantic_search_available)

    @get()
    async def search(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        context: SearchContext,
        q: str,
        field: str | None = None,
        mode: Literal["text", "semantic"] = "text",
        offset: int = 0,
        limit: int = 20,
        entity: str | None = None,
    ) -> SearchPage:
        q = q.strip()
        if not q or len(q) > 300 or not 0 <= offset <= 100000 or not 1 <= limit <= 50:
            raise ClientException(detail="Enter 1-300 characters; limit must be 1-50")
        if field and field not in allowed_fields(context):
            raise ClientException(detail="Field is not available in this search context")
        kinds = {"scene" if kind == "prose" else kind for kind in CONTEXTS[context]}
        if entity and entity not in kinds:
            raise ClientException(detail="Entity is not available in this search context")
        if mode == "semantic":
            if not get_settings().semantic_search_available:
                raise ClientException(status_code=503, detail="Meaning search is not enabled yet")
            from storytool.domain.search.semantic import semantic_search

            return await semantic_search(
                db_session, story_id, context, q, field, offset, limit, entity
            )
        result = await text_search(db_session, story_id, context, q, field, offset, limit, entity)
        result.semantic_available = get_settings().semantic_search_available
        return result

    @get("/target")
    async def target(
        self, db_session: AsyncSession, story_id: UUID, entity: str, id: UUID
    ) -> SearchHit:
        if entity not in FIELDS or entity == "prose":
            raise ClientException(detail="Unknown search destination")
        model = FIELDS[entity][0]
        scope = model.id == story_id if entity == "story" else model.story_id == story_id
        row = await db_session.scalar(select(model).where(model.id == id, scope))
        if not row:
            raise ClientException(
                status_code=404, detail="This item no longer exists. Refresh search results."
            )
        return SearchHit(
            entity=entity, id=id, title="", chapter_id=getattr(row, "chapter_id", None), matches=[]
        )
