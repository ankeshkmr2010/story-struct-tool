"""Google sessions and story isolation at the HTTP boundary."""

import hashlib
from datetime import UTC, datetime, timedelta

from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from storytool.domain.auth.models import User, UserSession
from storytool.domain.story.models import Story


async def test_anonymous_requests_cannot_read_or_write_stories(client: AsyncTestClient) -> None:
    client.cookies.clear()
    assert (await client.get("/api/auth/config")).status_code == 200
    assert (await client.get("/api/stories")).status_code == 401
    assert (await client.post("/api/stories", json={"title": "Intruder"})).status_code == 401


async def test_accounts_see_only_their_stories_and_references(
    client: AsyncTestClient, engine: AsyncEngine
) -> None:
    first = (await client.post("/api/stories", json={"title": "First"})).json()
    chapter = (
        await client.post(f"/api/stories/{first['id']}/chapters", json={"title": "Opening"})
    ).json()

    async with AsyncSession(engine) as session:
        second_user = User(google_sub="second-author", email="second@example.com")
        session.add(second_user)
        await session.flush()
        session.add(
            UserSession(
                user_id=second_user.id,
                token_hash=hashlib.sha256(b"second-session").hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await session.commit()

    client.cookies.set("storytool_session", "second-session", path="/api")
    assert (await client.get("/api/stories")).json() == []
    assert (await client.get(f"/api/stories/{first['id']}")).status_code == 404
    assert (await client.get(f"/api/stories/{first['id']}/chapters")).status_code == 404
    assert (await client.delete(f"/api/stories/{first['id']}")).status_code == 404

    second = (await client.post("/api/stories", json={"title": "Second"})).json()
    beat = (
        await client.post(f"/api/stories/{second['id']}/beats", json={"label": "A private beat"})
    ).json()
    client.cookies.set("storytool_session", "test-session", path="/api")
    assert (await client.get("/api/stories")).json()[0]["id"] == first["id"]
    assert (await client.get(f"/api/stories/{second['id']}")).status_code == 404
    assert (
        await client.post(
            f"/api/stories/{first['id']}/chapters/{chapter['id']}/beats",
            json={"beat_id": beat["id"]},
        )
    ).status_code == 404


async def test_verified_google_login_claims_only_configured_legacy_stories(
    client: AsyncTestClient, engine: AsyncEngine, monkeypatch
) -> None:
    from storytool.config import get_settings

    async with AsyncSession(engine) as session:
        legacy = Story(title="Legacy")
        session.add(legacy)
        await session.commit()

    monkeypatch.setenv("STORYTOOL_GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("STORYTOOL_LEGACY_OWNER_EMAIL", "owner@gmail.com")
    get_settings.cache_clear()
    monkeypatch.setattr(
        "storytool.domain.auth.controller.verify_google_credential",
        lambda _credential, _client_id: {
            "sub": "google-owner-sub",
            "email": "owner@gmail.com",
            "email_verified": True,
            "name": "Owner",
        },
    )
    try:
        client.cookies.clear()
        login = await client.post("/api/auth/google", json={"credential": "x" * 100})
        assert login.status_code == 201
        assert login.json()["email"] == "owner@gmail.com"
        assert "httponly" in login.headers["set-cookie"].lower()
        assert (await client.get("/api/auth/me")).json()["email"] == "owner@gmail.com"
        assert {s["title"] for s in (await client.get("/api/stories")).json()} == {
            "Legacy",
            "The Blue Carbuncle",
            "The Red-Headed League",
            "The Hobbit",
            "The Last Lantern — Timeline & Arc Tutorial",
        }
        assert (await client.post("/api/auth/logout")).status_code == 201
        assert (await client.get("/api/stories")).status_code == 401
    finally:
        get_settings.cache_clear()
