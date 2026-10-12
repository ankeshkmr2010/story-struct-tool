"""The /thanks shoutouts: public read, owner-only edits."""

import pytest
from litestar.testing import AsyncTestClient

from storytool.config import get_settings


@pytest.fixture
def as_admin(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STORYTOOL_ADMIN_EMAILS", "someone@else.com, Author@Example.com")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_non_admin_cannot_edit(client: AsyncTestClient) -> None:
    assert (await client.get("/api/admin/status")).json() == {"is_admin": False}
    response = await client.post("/api/admin/shoutouts", json={"name": "X", "thanks": "Y"})
    assert response.status_code == 403


async def test_list_is_public(client: AsyncTestClient) -> None:
    client.cookies.clear()
    assert (await client.get("/api/shoutouts")).status_code == 200
    assert (await client.get("/api/admin/status")).status_code == 401


async def test_admin_adds_edits_and_removes(client: AsyncTestClient, as_admin: None) -> None:
    assert (await client.get("/api/admin/status")).json() == {"is_admin": True}
    before = len((await client.get("/api/shoutouts")).json())

    created = await client.post(
        "/api/admin/shoutouts", json={"name": "Ananya", "thanks": "The positive vibes."}
    )
    assert created.status_code == 201, created.text
    shoutout = created.json()
    listed = (await client.get("/api/shoutouts")).json()
    assert len(listed) == before + 1
    assert listed[-1]["id"] == shoutout["id"], "new shoutouts go last"

    edited = await client.patch(
        f"/api/admin/shoutouts/{shoutout['id']}", json={"thanks": "Vibes.", "sort_key": -1}
    )
    assert edited.json()["thanks"] == "Vibes."
    assert (await client.get("/api/shoutouts")).json()[0]["id"] == shoutout["id"]

    assert (await client.delete(f"/api/admin/shoutouts/{shoutout['id']}")).status_code == 204
    assert len((await client.get("/api/shoutouts")).json()) == before
