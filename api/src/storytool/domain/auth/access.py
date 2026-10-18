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
from sqlalchemy.ext.asyncio import AsyncSession

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
_PUBLIC_PATHS = {
    "/api/site/try/hints",
    "/api/site/try/hints/feedback",
    "/api/health",
    "/api/auth/config",
    "/api/auth/google",
    "/api/shoutouts",
    "/api/roadmap",
    "/api/site/visit",
    "/api/site/try",
}
_REFERENCE_MODELS = {
    "act_id": Act,
    "beat_id": Beat,
    "beat_ids": Beat,
    "chapter_id": Chapter,
    "location_id": Location,
    "scene_id": Scene,
    "first_explained_scene_id": Scene,
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


_READER_ROUND_PATH = re.compile(r"^/api/beta/rounds/([0-9a-fA-F-]{36})(?:/threads|/polls)?/?$")
_READER_THREAD_PATH = re.compile(r"^/api/beta/threads/([0-9a-fA-F-]{36})/?$")


async def _reader_request_allowed(
    db: AsyncSession, delegated: Delegation, path: str, method: str
) -> bool:
    """Round-scoped reader grants may only GET their own round's reader endpoints."""
    from storytool.domain.story.beta import BetaMember, BetaRound, BetaThread

    if method != "GET" or "beta:read" not in delegated.scopes:
        return False
    try:
        if match := _READER_ROUND_PATH.match(path):
            round_id = UUID(match.group(1))
        elif match := _READER_THREAD_PATH.match(path):
            round_id = await db.scalar(
                select(BetaThread.round_id).where(BetaThread.id == UUID(match.group(1)))
            )
        else:
            return False
    except ValueError:
        return False
    if round_id != delegated.round_id:
        return False
    allowed = await db.scalar(
        select(BetaRound.id)
        .join(BetaMember, BetaMember.round_id == BetaRound.id)
        .join(Story, Story.id == BetaRound.story_id)
        .where(
            BetaRound.id == round_id,
            BetaRound.allow_reader_ai.is_(True),
            BetaMember.user_id == delegated.user_id,
            BetaMember.status == "approved",
            Story.deleted_at.is_(None),
        )
    )
    return allowed is not None


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
        if (
            not path.startswith("/api/")
            or path in _PUBLIC_PATHS
            or path.startswith(("/api/schema", "/api/showcase/"))
        ):
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
                # A beta reader's own AI: GET-only reader endpoints of its one round, re-checked
                # on every call (still approved, author still allows it, story not deleted).
                if isinstance(delegated, Delegation) and delegated.round_id:
                    if not await _reader_request_allowed(db, delegated, path, http_scope["method"]):
                        await _reject(send, 403, "This connection can only read its beta round")
                        return
                    scope.setdefault("state", {})["storytool_user_id"] = delegated.user_id
                    scope["state"]["storytool_write_origin"] = "mcp"
                    await self.app(scope, receive, send)
                    return
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
                # Author-side beta actions: draft a reply (POST) or mark addressed (PATCH).
                beta_write = bool(
                    re.fullmatch(r"/beta-feedback/[0-9a-fA-F-]{36}(?:/draft-reply)?", suffix)
                ) and http_scope["method"] == (
                    "POST" if suffix.endswith("/draft-reply") else "PATCH"
                )
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
                            # An AI review report: stored beside the story, never edits it.
                            or (
                                suffix.startswith("/evaluations/")
                                and suffix.endswith("/reports")
                                and suffix.count("/") == 3
                            )
                        )
                    )
                )
                allowed = allowed or bool(
                    delegated and path == story_prefix and http_scope["method"] == "GET"
                )
                collection = path.rstrip("/") == "/api/stories"
                product_feedback = (
                    path == "/api/product-feedback" and http_scope["method"] == "POST"
                )
                allowed = allowed or bool(delegated and product_feedback)
                allowed = allowed or bool(delegated and beta_write)
                allowed = allowed or bool(
                    delegated
                    and collection
                    and (
                        (http_scope["method"] == "GET" and "library:read" in scopes)
                        or (http_scope["method"] == "POST" and "story:create" in scopes)
                    )
                )
                validator_path = bool(
                    re.fullmatch(r"/api/validators(?:/[0-9a-fA-F-]{36}|/preview)?/?", path)
                )
                validator_scope = (
                    "validators:read"
                    if http_scope["method"] == "GET" and "validators:read" in scopes
                    else "validators:write"
                )
                allowed = allowed or bool(
                    delegated
                    and validator_path
                    and http_scope["method"] in {"GET", "POST", "PATCH", "DELETE"}
                    and validator_scope in scopes
                )
                # Manuscript import uploads: an agent helping the author plan and run an import.
                # It creates a story, so it needs story:create; handlers check upload ownership.
                import_path = bool(
                    re.fullmatch(
                        r"/api/imports/uploads/[0-9a-fA-F-]{36}(?:/preview|/import)?", path
                    )
                )
                allowed = allowed or bool(
                    delegated
                    and import_path
                    and http_scope["method"] in {"GET", "POST"}
                    and "story:create" in scopes
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
                prose_query = prose_query or (
                    suffix == "/search" and "prose" in query.get("context", [])
                )
                if (
                    prose_query
                    or suffix.endswith(
                        (
                            "/content",
                            "/annotations",
                            "/mentions",
                            "/revisions",
                            "/preview",
                            "/reader",
                            "/manuscript",
                            "/manuscript.docx",
                            "/manuscript.pdf",
                            "/manuscript.html",
                            "/manuscript.txt",
                            "/manuscript.epub",
                            "/manuscript.zip",
                            "/beta-feedback",
                            "/beta-status",
                            "/backup",
                            "/file",
                        )
                    )
                    or suffix in {"/ai/runs", "/ai/observations", "/ai/catchup"}
                    or (
                        suffix.startswith("/evaluations/")
                        and suffix.endswith("/reports")
                        and http_scope["method"] == "GET"
                    )
                    or suffix.startswith(
                        (
                            "/evaluations/value_shift/",
                            "/evaluations/misbelief_midpoint/",
                            "/evaluations/scene-reader",
                        )
                    )
                ):
                    needed.add("prose:read")
                if collection:
                    needed.add("story:create" if http_scope["method"] == "POST" else "library:read")
                elif http_scope["method"] != "GET" and not product_feedback:
                    needed.add("beta:write" if beta_write else "story:write")
                if suffix.startswith("/versions/") and suffix.endswith("/restore"):
                    needed.update({"versions:restore", "prose:read"})
                if validator_path:
                    needed = {validator_scope}
                if import_path:
                    needed = {"story:create"}
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
                if delegated and ("/shares" in path or path.endswith("/showcase")):
                    await _reject(send, 403, "Manage sharing in StoryTool's browser interface")
                    return
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
                        op.get("op") in {"write_prose", "patch_prose"}
                        or (op.get("op") == "delete" and op.get("entity") in {"scene", "chapter"})
                        for op in run.proposal.get("operations", [])
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
                                    isinstance(op, dict)
                                    and (
                                        op.get("op") in {"write_prose", "patch_prose"}
                                        or (
                                            op.get("op") == "delete"
                                            and op.get("entity") in {"scene", "chapter"}
                                        )
                                    )
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
                if (
                    http_scope["method"] in {"POST", "PATCH", "PUT", "DELETE"}
                    and "/beta-feedback/" not in path
                    and not path.endswith(
                        (
                            "/ai/propose",
                            "/notice",
                            "/ai-review",
                            "/scene-reader",
                            "/reader-verify",
                            "/hints",
                        )
                    )
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
        scope["state"]["storytool_write_origin"] = "mcp" if delegated else "author"

        async def replay_receive() -> Any:
            return replay.pop(0) if replay else await receive()

        if lock_story_id is not None:
            scope["state"]["storytool_live_story_id"] = lock_story_id
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
