"""Enforces access tiers on every request, after `StoryAccessMiddleware` has named the account.

MCP tools call the REST API in-process, so they pass through here too. A locked request gets
403 with `code` feature_locked or limit_reached, the key, and the tiers that would allow it.
With no tier or override restricting a request's features, nothing is looked up.
"""

import json
from typing import Any, cast

from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig
from litestar.types import ASGIApp, HTTPScope, Receive, Scope, Send
from sqlalchemy import func, select

from storytool.domain.plans.catalogue import creates_story, features_for
from storytool.domain.plans.models import AccessTier
from storytool.domain.plans.service import TierData, granting_tiers, resolve, restricted_keys


async def _locked(send: Send, body: dict[str, Any]) -> None:
    payload = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")],
        }
    )
    await send({"type": "http.response.body", "body": payload, "more_body": False})


class PlanAccessMiddleware:
    def __init__(self, app: ASGIApp, db_config: SQLAlchemyAsyncConfig) -> None:
        self.app = app
        self.db_config = db_config

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        state = scope.get("state", {}) if scope["type"] == "http" else {}
        user_id = state.get("storytool_user_id")
        if user_id is None:
            await self.app(scope, receive, send)
            return
        http_scope = cast(HTTPScope, scope)
        method, path = http_scope["method"], http_scope["path"]
        needed = features_for(method, path, delegated=state.get("storytool_write_origin") == "mcp")
        if creates_story(method, path):
            needed.append("stories.max")
        if not needed:
            await self.app(scope, receive, send)
            return
        async with self.db_config.get_session() as db:
            if (await restricted_keys(db)).intersection(needed):
                refusal = await self._refusal(db, user_id, needed)
                if refusal:
                    await _locked(send, refusal)
                    return
        await self.app(scope, receive, send)

    async def _refusal(self, db: Any, user_id: Any, needed: list[str]) -> dict[str, Any] | None:
        from storytool.domain.story.models import Story

        access = await resolve(db, user_id)
        for key in needed:
            if key == "stories.max":
                cap = access.limits.get(key)
                if cap is None:
                    continue
                owned = await db.scalar(
                    select(func.count(Story.id)).where(
                        Story.user_id == user_id, Story.deleted_at.is_(None)
                    )
                )
                if (owned or 0) >= cap:
                    return {
                        "detail": f"Your plan allows {cap} active stories. Move one to Trash "
                        "or upgrade to add another.",
                        "code": "limit_reached",
                        "limit": key,
                        "value": cap,
                    }
            elif not access.allows(key):
                tiers = [TierData.of(t) for t in await db.scalars(select(AccessTier))]
                return {
                    "detail": "This feature is not included in your plan.",
                    "code": "feature_locked",
                    "feature": key,
                    "tiers": granting_tiers(tiers, key),
                }
        return None
