"""Authenticate every API request and enforce ownership at the story boundary."""

import hashlib
import json
import re
from datetime import UTC, datetime
from http.cookies import SimpleCookie
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig
from litestar.types import (
    ASGIApp,
    HTTPResponseBodyEvent,
    HTTPResponseStartEvent,
    HTTPScope,
    Receive,
    Scope,
    Send,
)
from sqlalchemy import select, text

from storytool.domain.ai.models import AgentToken, AIRun
from storytool.domain.auth.models import User, UserSession
from storytool.domain.auth.oauth import STORY_SCOPES, Delegation, delegated_access
from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread
from storytool.domain.world.models import Location

SESSION_COOKIE = "storytool_session"
_STORY_PATH = re.compile(r"^/api/stories/([^/]+)(?:/|$)")
_ARC_PATH = re.compile(r"^/api/arcs/([^/]+)(?:/|$)")
_PUBLIC_PATHS = {"/api/health", "/api/auth/config", "/api/auth/google"}
_REFERENCE_MODELS = {
    "act_id": Act,
    "beat_id": Beat,
    "beat_ids": Beat,
    "chapter_id": Chapter,
    "location_id": Location,
    "scene_id": Scene,
    "scene_ids": Scene,
    "thread_id": Thread,
    "thread_ids": Thread,
    "character_id": Character,
    "character_ids": Character,
    "character_a_id": Character,
    "character_b_id": Character,
    "owner_character_id": Character,
    "pov_character_id": Character,
    "relationship_id": Relationship,
    "opening_turning_point_id": Event,
    "closing_turning_point_id": Event,
    "event_id": Event,
    "after_scene_id": Scene,
    "before_scene_id": Scene,
    "after_chapter_id": Chapter,
    "before_chapter_id": Chapter,
}


def session_token(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name.lower() != b"cookie":
            continue
        cookie = SimpleCookie()
        try:
            cookie.load(value.decode("latin-1"))
        except Exception:
            return None
        return cookie[SESSION_COOKIE].value if SESSION_COOKIE in cookie else None
    return None


async def _reject(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        HTTPResponseStartEvent(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
    )
    await send(
        HTTPResponseBodyEvent({"type": "http.response.body", "body": body, "more_body": False})
    )


class StoryAccessMiddleware:
    def __init__(self, app: ASGIApp, db_config: SQLAlchemyAsyncConfig) -> None:
        self.app = app
        self.db_config = db_config

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        http_scope = cast(HTTPScope, scope)
        path = http_scope["path"]
        # Public OAuth protocol endpoints authenticate with PKCE/client credentials, not cookies.
        if path in {"/authorize", "/token", "/register", "/revoke"} or path.startswith(
            "/.well-known/"
        ):
            await self.app(scope, receive, send)
            return
        if http_scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
            headers = dict(scope.get("headers", []))
            origin = headers.get(b"origin")
            host = headers.get(b"host", b"").decode("latin-1").lower()
            if (
                path.startswith("/api/")
                and origin
                and urlsplit(origin.decode("latin-1")).netloc.lower() != host
            ):
                await _reject(send, 403, "Use this site's own origin for browser writes")
                return
        if not path.startswith("/api/") or path in _PUBLIC_PATHS or path.startswith("/api/schema"):
            await self.app(scope, receive, send)
            return

        bearer = next(
            (
                value.decode().removeprefix("Bearer ")
                for name, value in scope.get("headers", [])
                if name.lower() == b"authorization" and value.startswith(b"Bearer ")
            ),
            None,
        )
        token = bearer or session_token(scope)
        if not token:
            await _reject(send, 401, "Sign in to continue")
            return

        replay: list[Any] = []
        lock_story_id: UUID | None = None
        async with self.db_config.get_session() as db:
            delegated: AgentToken | Delegation | None = None
            if bearer:
                delegated = await db.scalar(
                    select(AgentToken).where(
                        AgentToken.token_hash == hashlib.sha256(bearer.encode()).hexdigest(),
                        AgentToken.expires_at > datetime.now(UTC),
                    )
                )
                if delegated is None:
                    delegated = await delegated_access(db, bearer)
                scopes = getattr(delegated, "scopes", STORY_SCOPES)
                library = (
                    isinstance(delegated, Delegation)
                    and delegated.story_id is None
                    and "library:read" in scopes
                )
                addressed_story = _STORY_PATH.match(path)
                story_prefix = (
                    f"/api/stories/{addressed_story.group(1)}"
                    if library and addressed_story
                    else f"/api/stories/{delegated.story_id}"
                    if delegated
                    else ""
                )
                suffix = path.removeprefix(story_prefix) if delegated else ""
                allowed = bool(delegated and path.startswith(story_prefix + "/")) and (
                    http_scope["method"] == "GET"
                    or (
                        http_scope["method"] == "POST"
                        and (
                            suffix == "/ai/stage"
                            or (
                                suffix.startswith("/ai/runs/")
                                and suffix.endswith(("/apply", "/undo", "/dismiss"))
                            )
                            or suffix == "/versions"
                            or (suffix.startswith("/versions/") and suffix.endswith("/restore"))
                        )
                    )
                )
                allowed = allowed or bool(
                    delegated and path == story_prefix and http_scope["method"] == "GET"
                )
                collection = path.rstrip("/") == "/api/stories"
                allowed = allowed or bool(
                    delegated
                    and collection
                    and (
                        (http_scope["method"] == "GET" and "library:read" in scopes)
                        or (http_scope["method"] == "POST" and "story:create" in scopes)
                    )
                )
                if not delegated or not allowed:
                    await _reject(send, 401, "Invalid or out-of-scope agent token")
                    return
                scopes = getattr(delegated, "scopes", STORY_SCOPES)
                needed = {"story:read"}
                query = parse_qs(http_scope.get("query_string", b"").decode())
                prose_query = query.get("include_prose", ["false"])[0].lower() in {
                    "true",
                    "1",
                    "yes",
                }
                if (
                    prose_query
                    or suffix.endswith(
                        ("/content", "/annotations", "/mentions", "/revisions", "/preview")
                    )
                    or suffix in {"/ai/runs", "/ai/observations"}
                ):
                    needed.add("prose:read")
                if collection:
                    needed.add("story:create" if http_scope["method"] == "POST" else "library:read")
                elif http_scope["method"] != "GET":
                    needed.add("story:write")
                if suffix.startswith("/versions/") and suffix.endswith("/restore"):
                    needed.update({"versions:restore", "prose:read"})
                if not needed <= set(scopes):
                    await _reject(send, 403, "Connection lacks required story permissions")
                    return
            user_id = (
                await db.execute(
                    select(User.id)
                    .join(UserSession, UserSession.user_id == User.id)
                    .where(
                        UserSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
                        UserSession.expires_at > datetime.now(UTC),
                    )
                )
            ).scalar_one_or_none()
            if delegated:
                user_id = delegated.user_id
            if user_id is None:
                await _reject(send, 401, "Session expired. Sign in again")
                return

            story_match = _STORY_PATH.match(path)
            arc_match = _ARC_PATH.match(path)
            if story_match:
                try:
                    story_id = UUID(story_match.group(1))
                except ValueError:
                    await _reject(send, 404, "Story not found")
                    return
                owner = (
                    await db.execute(
                        select(Story.user_id, Story.deleted_at).where(Story.id == story_id)
                    )
                ).one_or_none()
                if owner is None or owner.user_id != user_id:
                    await _reject(send, 404, "Story not found")
                    return
                if (
                    delegated
                    and "/ai/runs/" in path
                    and "prose:read" not in getattr(delegated, "scopes", STORY_SCOPES)
                ):
                    run_ref = path.split("/ai/runs/", 1)[1].split("/", 1)[0]
                    try:
                        run_id = UUID(run_ref)
                    except ValueError:
                        run_id = None
                    run = await db.scalar(
                        select(AIRun).where(
                            AIRun.id == run_id,
                            AIRun.story_id == story_id,
                            AIRun.user_id == user_id,
                        )
                    )
                    if run and any(
                        op.get("op") == "write_prose" for op in run.proposal.get("operations", [])
                    ):
                        await _reject(send, 403, "Prose permission is required for this proposal")
                        return
                trash_action = (
                    http_scope["method"] == "POST"
                    and path
                    in {f"/api/stories/{story_id}/restore", f"/api/stories/{story_id}/purge"}
                ) or (http_scope["method"] == "DELETE" and path == f"/api/stories/{story_id}")
                if owner.deleted_at is not None and not trash_action:
                    await _reject(send, 410, "Story is in Trash. Restore it from your library.")
                    return

                # References sent in create/update bodies must belong to this story too.
                # Otherwise a known UUID could link another author's character or beat.
                if http_scope["method"] in {"POST", "PATCH", "PUT"}:
                    while True:
                        message = await receive()
                        replay.append(message)
                        if message["type"] != "http.request" or not message.get("more_body", False):
                            break
                    body = b"".join(message.get("body", b"") for message in replay)
                    try:
                        payload = json.loads(body)
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        payload = None
                    if isinstance(payload, dict):
                        if delegated and path.endswith("/ai/stage"):
                            operations = payload.get("operations", [])
                            if (
                                isinstance(operations, list)
                                and any(
                                    isinstance(op, dict) and op.get("op") == "write_prose"
                                    for op in operations
                                )
                                and "prose:read" not in getattr(delegated, "scopes", STORY_SCOPES)
                            ):
                                await _reject(send, 403, "Prose permission is required")
                                return
                        for key, value in payload.items():
                            if value is None or (
                                key not in _REFERENCE_MODELS and key != "arc_stage_id"
                            ):
                                continue
                            values = value if isinstance(value, list) else [value]
                            for item in values:
                                try:
                                    ref_id = UUID(str(item))
                                except ValueError:
                                    continue  # Let Pydantic report malformed input.
                                if key == "arc_stage_id":
                                    ref_owner = (
                                        await db.execute(
                                            select(Arc.story_id)
                                            .join(ArcStage, ArcStage.arc_id == Arc.id)
                                            .where(ArcStage.id == ref_id)
                                        )
                                    ).scalar_one_or_none()
                                else:
                                    model = _REFERENCE_MODELS[key]
                                    ref_owner = (
                                        await db.execute(
                                            select(cast(Any, model).story_id).where(
                                                model.id == ref_id
                                            )
                                        )
                                    ).scalar_one_or_none()
                                if ref_owner is not None and ref_owner != story_id:
                                    await _reject(send, 404, "Referenced item not found")
                                    return
                if http_scope["method"] in {"POST", "PATCH", "PUT", "DELETE"} and not path.endswith(
                    ("/ai/propose", "/notice")
                ):
                    lock_story_id = story_id
            elif arc_match:
                try:
                    arc_id = UUID(arc_match.group(1))
                except ValueError:
                    await _reject(send, 404, "Arc not found")
                    return
                owner_id = (
                    await db.execute(
                        select(Story.user_id)
                        .join(Arc, Arc.story_id == Story.id)
                        .where(Arc.id == arc_id, Story.deleted_at.is_(None))
                    )
                ).scalar_one_or_none()
                if owner_id != user_id:
                    await _reject(send, 404, "Arc not found")
                    return
                if http_scope["method"] in {"POST", "PATCH", "PUT", "DELETE"}:
                    lock_story_id = await db.scalar(select(Arc.story_id).where(Arc.id == arc_id))

        scope.setdefault("state", {})["storytool_user_id"] = user_id

        async def replay_receive() -> Any:
            return replay.pop(0) if replay else await receive()

        if lock_story_id is not None:
            async with self.db_config.get_session() as lock_db:
                await lock_db.execute(
                    text("SELECT pg_advisory_xact_lock(:key)"),
                    {"key": int.from_bytes(lock_story_id.bytes[:8], "big", signed=True)},
                )
                deleting_story = (
                    http_scope["method"] == "DELETE"
                    and path.rstrip("/") == f"/api/stories/{lock_story_id}"
                )
                deleting_story = deleting_story or (
                    http_scope["method"] == "POST" and path == f"/api/stories/{lock_story_id}/purge"
                )
                restoring_story = (
                    http_scope["method"] == "POST"
                    and path == f"/api/stories/{lock_story_id}/restore"
                )
                locked_story = (
                    await lock_db.execute(
                        select(Story.id, Story.deleted_at).where(Story.id == lock_story_id)
                    )
                ).one_or_none()
                if locked_story is None:
                    await _reject(send, 404, "Story not found")
                    return
                if locked_story.deleted_at is not None and not (deleting_story or restoring_story):
                    await _reject(send, 410, "Story is in Trash. Restore it from your library.")
                    return
                if "/versions" not in path and not deleting_story:
                    from storytool.domain.versioning import service as versions
                    from storytool.domain.versioning.models import StoryVersion

                    before = await versions.full_state(lock_db, lock_story_id)
                    if not before["story"]:
                        await _reject(send, 404, "Story not found")
                        return
                    existing = await lock_db.scalar(
                        select(StoryVersion.id)
                        .where(StoryVersion.story_id == lock_story_id)
                        .limit(1)
                    )
                    scope["state"]["storytool_version_context"] = {
                        "story_id": lock_story_id,
                        "user_id": user_id,
                        "before": before,
                        "initial": existing is None,
                        "ai_batch": "/ai/runs/" in path and path.endswith(("/apply", "/undo")),
                    }
                    await self.app(scope, replay_receive if replay else receive, send)
                else:
                    await self.app(scope, replay_receive if replay else receive, send)
        else:
            await self.app(scope, replay_receive if replay else receive, send)
