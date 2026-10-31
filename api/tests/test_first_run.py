"""Usability phase 4: first-run measures are recorded per account and readable by the admin only."""

import pytest
from litestar.testing import AsyncTestClient


@pytest.fixture
def as_admin(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STORYTOOL_ADMIN_EMAILS", "Author@Example.com")
    from storytool.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_first_run_is_admin_only(client: AsyncTestClient) -> None:
    assert (await client.get("/api/admin/funnel/first-run")).status_code == 403


async def test_tool_opens_and_checklist_steps_are_counted(
    client: AsyncTestClient, as_admin: None
) -> None:
    for tool in ("grid", "grid", "pacing"):
        assert (await client.post("/api/site/tool-open", json={"tool": tool})).status_code == 204
    assert (
        await client.post("/api/site/tool-open", json={"tool": "not-a-tool"})
    ).status_code == 400
    story = (await client.post("/api/stories", json={"title": "Mine"})).json()
    await client.post(f"/api/stories/{story['id']}/characters", json={"name": "Ada"})
    await client.patch("/api/auth/profile", json={"guide": {"check_run": True}})

    data = (await client.get("/api/admin/funnel/first-run")).json()
    tools = {row["tool"]: row for row in data["tools"]}
    # Opened just now, so nothing counts as dropped yet.
    assert tools["grid"] == {"tool": "grid", "accounts": 1, "dropped": 0}
    assert tools["pacing"]["accounts"] == 1
    assert data["checklist"]["added_a_character"] == 1
    assert data["checklist"]["ran_a_check"] == 1
    assert data["accounts"] >= 1
    assert data["hours_to_first_scene"][0]["label"] == "Under 1 hour"
