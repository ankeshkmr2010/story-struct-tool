"""Explicit library OAuth access lists/creates owned stories and targets story-specific tools."""

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.models import User, UserSession
from storytool.domain.auth.oauth import STORY_SCOPES
from tests.test_ai import story
from tests.test_oauth import approve, authorize, exchange, oauth_tool, register


async def connection(client, scopes):
    registered = await register(client)
    request_id, verifier, _ = await authorize(client, registered)
    code = await approve(client, request_id, None, scopes)
    response = await exchange(client, registered, code, verifier)
    assert response.status_code == 200
    return response.json()["access_token"]


async def result(client, token, name, args=None):
    response = await oauth_tool(client, token, name, args)
    assert response.status_code == 200, response.text
    data = response.json()["result"]
    assert not data.get("isError"), data
    return data["structuredContent"]


async def test_library_lists_creates_initial_version_and_targets_own_stories(client, engine):
    token = await connection(client, [*STORY_SCOPES, "library:read", "story:create"])
    assert (await result(client, token, "list_stories"))["stories"] == []
    created = await result(
        client,
        token,
        "create_story",
        {"story": {"title": "An agent-created story", "premise": "A clockmaker loses an hour."}},
    )
    sid = created["id"]
    assert (await result(client, token, "get_connection"))["story_id"] is None
    context = await result(client, token, "get_story_context", {"story_id": sid})
    assert context["entities"]["story"][0]["title"] == "An agent-created story"
    versions = await result(client, token, "list_story_versions", {"story_id": sid})
    assert versions["versions"][0]["source"] == "initial"
    proposal = {
        "summary": "Add a protagonist",
        "base_fingerprint": context["base_fingerprint"],
        "operations": [
            {
                "op": "create",
                "entity": "character",
                "ref": "new:keeper",
                "data": {"name": "Maya", "role": "protagonist"},
            }
        ],
    }
    staged = await result(
        client, token, "stage_story_changes", {"story_id": sid, "proposal": proposal}
    )
    await result(client, token, "apply_story_changes", {"story_id": sid, "run_id": staged["id"]})
    assert (
        await result(
            client, token, "query_story_entities", {"story_id": sid, "entity": "character"}
        )
    )["items"][0]["name"] == "Maya"
    second = await story(client, "Another owned story")
    listing = await result(client, token, "list_stories", {"limit": 1})
    assert listing["total"] == 2 and listing["next_offset"] == 1
    assert (await result(client, token, "get_story_context", {"story_id": second}))[
        "story_id"
    ] == second
    async with AsyncSession(engine) as db:
        other = User(google_sub="library-other", email="library-other@example.invalid")
        db.add(other)
        await db.flush()
        db.add(
            UserSession(
                user_id=other.id,
                token_hash=hashlib.sha256(b"library-other-session").hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
    client.cookies.set("storytool_session", "library-other-session", path="/api")
    foreign = await story(client, "Foreign story")
    listing = await result(client, token, "list_stories")
    assert {s["id"] for s in listing["stories"]} == {sid, second}
    denied = await oauth_tool(client, token, "get_story_context", {"story_id": foreign})
    assert denied.json()["result"]["isError"]


async def test_library_read_only_cannot_create_and_old_story_token_stays_scoped(client):
    sid = await story(client)
    token = await connection(client, ["story:read", "library:read"])
    denied = await oauth_tool(client, token, "create_story", {"story": {"title": "Not permitted"}})
    assert denied.json()["result"]["isError"]
    manual = (await client.post("/api/ai/agent-tokens", json={"story_id": sid})).json()["token"]
    await story(client, "Not in manual grant")
    listed = await result(client, manual, "list_stories")
    assert len(listed["stories"]) == 1 and listed["stories"][0]["id"] == sid
    assert (
        await client.get("/api/stories", headers={"Authorization": "Bearer " + manual})
    ).status_code == 401
    denied = await oauth_tool(client, manual, "create_story", {"story": {"title": "Not permitted"}})
    assert denied.json()["result"]["isError"]
