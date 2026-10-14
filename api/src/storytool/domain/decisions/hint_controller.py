"""Opt-in writing hints, with owned-scene and bounded public-sandbox routes."""

import hashlib
import hmac
import secrets
import time
from collections import OrderedDict
from uuid import UUID

from litestar import Controller, Request, Response, post
from litestar.datastructures import Cookie
from litestar.exceptions import (
    NotFoundException,
    PermissionDeniedException,
    TooManyRequestsException,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.cast.models import Character
from storytool.domain.decisions.hints import HintInput, HintReading, read_hints
from storytool.domain.decisions.providers import shared_provider
from storytool.domain.decisions.service import Actor, DecisionService
from storytool.domain.glossary import GlossaryEntry
from storytool.domain.narrative.models import Scene

_secret = secrets.token_bytes(32)
_peers: OrderedDict[str, tuple[int, int, int]] = OrderedDict()
_cookie = "storytool_hint_session"


def sandbox_identity(request: Request) -> tuple[str, Cookie | None]:
    # Hash the socket peer; never trust a client-supplied visitor ID or forwarded header.
    # Peer caps also bound cookie-reset abuse. Global persisted spend caps cover workers.
    key = (get_settings().ai_encryption_key or "").encode() or _secret
    peer = request.client.host if request.client else "unknown"
    peer_hash = hmac.new(key, peer.encode(), hashlib.sha256).hexdigest()
    minute = int(time.time()) // 60
    previous, calls, issued = _peers.pop(peer_hash, (minute, 0, 0))
    if previous != minute:
        calls, issued = 0, 0
    token = request.cookies.get(_cookie, "")
    identifier, _, signature = token.partition(".")
    expected = hmac.new(key, identifier.encode(), hashlib.sha256).hexdigest()
    valid = len(identifier) == 32 and hmac.compare_digest(signature, expected)
    calls += 1
    issued += not valid
    _peers[peer_hash] = (minute, calls, issued)
    while len(_peers) > 4096:
        _peers.popitem(last=False)
    if calls > 120 or issued > 10:
        raise TooManyRequestsException(detail="Sandbox hint limit reached. Try again later.")
    if valid:
        return identifier, None
    identifier = secrets.token_hex(16)
    signature = hmac.new(key, identifier.encode(), hashlib.sha256).hexdigest()
    cookie = Cookie(
        key=_cookie,
        value=f"{identifier}.{signature}",
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/api/site/try/hints",
        max_age=86400,
    )
    return identifier, cookie


async def hints(db: AsyncSession, actor: Actor, data: HintInput) -> HintReading:
    if not get_settings().shared_reader_available:
        return HintReading(
            content_hash=hashlib.sha256(data.content.encode()).hexdigest(),
            unavailable="The shared reader is not configured yet.",
        )
    provider, model = shared_provider()
    service = DecisionService(db, actor, provider)
    await db.commit()  # Release read-only DB connection before the provider request.
    return await read_hints(service, model, data)


class WritingHintsController(Controller):
    path = "/api/stories/{story_id:uuid}/scenes/{scene_id:uuid}/hints"
    tags = ["noticing"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @post(summary="Read the current scene draft for advisory writing hints")
    async def read(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        scene_id: UUID,
        data: HintInput,
    ) -> HintReading:
        if not await db_session.scalar(
            select(Scene.id).where(Scene.id == scene_id, Scene.story_id == story_id)
        ):
            raise NotFoundException(detail="Scene not found")
        names = []
        for model, field in ((Character, Character.name), (GlossaryEntry, GlossaryEntry.term)):
            rows = await db_session.execute(
                select(field, model.aliases).where(model.story_id == story_id)
            )
            for name, aliases in rows:
                names.extend([name, *(aliases or [])])
        # A partial glossary would produce misleading unknown-name hints.
        data.known_names = list(dict.fromkeys(names))
        if len(data.known_names) > 255:
            data.known_names = []
            data.known_names_complete = False
        return await hints(
            db_session, Actor.user(request.scope["state"]["storytool_user_id"]), data
        )


class SandboxHintsController(Controller):
    path = "/api/site/try/hints"
    tags = ["site"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @post(summary="Read an opted-in sandbox scene for advisory hints")
    async def read(
        self, request: Request, db_session: AsyncSession, data: HintInput
    ) -> Response[HintReading]:
        # Browsers must initiate this on the site's own origin, including cookie issuance.
        from urllib.parse import urlsplit

        origin = request.headers.get("origin", "")
        if not origin or urlsplit(origin).netloc.lower() != request.headers.get("host", "").lower():
            raise PermissionDeniedException(detail="Use this site's own origin")
        identity, cookie = sandbox_identity(request)
        result = await hints(db_session, Actor.anonymous(identity), data)
        return Response(
            result, cookies=[cookie] if cookie else [], headers={"Cache-Control": "no-store"}
        )
