"""Beta feedback through AI connections: reader-scoped grants (T62), author beta:write tools,
beta status, the AI-use disclosure summary and consent scope handling."""

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.oauth import SCOPES
from tests.test_oauth import approve, authorize, exchange, oauth_tool, register

READER_COOKIE = "beta-reader-session"


async def add_reader(engine) -> None:
    from storytool.domain.auth.models import User, UserSession

    async with AsyncSession(engine) as db:
        reader = User(google_sub="beta-reader", email="reader@example.invalid", name="Rea Der")
        db.add(reader)
        await db.flush()
        db.add(
            UserSession(
                user_id=reader.id,
                token_hash=hashlib.sha256(READER_COOKIE.encode()).hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()


def as_author(client) -> None:
    client.cookies.set("storytool_session", "test-session", path="/api")


def as_reader(client) -> None:
    client.cookies.set("storytool_session", READER_COOKIE, path="/api")


async def published_round(client, engine, *, reader_ai: bool) -> dict:
    """An author's story with one chapter of prose, a round the reader has joined."""
    sid = (await client.post("/api/stories", json={"title": "Beta story"})).json()["id"]
    chapter = (await client.post(f"/api/stories/{sid}/chapters", json={"title": "Opening"})).json()
    scene = (
        await client.post(
            f"/api/stories/{sid}/scenes", json={"title": "Harbour", "chapter_id": chapter["id"]}
        )
    ).json()
    await client.put(
        f"/api/stories/{sid}/scenes/{scene['id']}/content",
        json={"content": "Maya left the harbour before dawn."},
    )
    created = await client.post(
        f"/api/beta/manage/{sid}/rounds", json={"title": "Round one", "auto_approve": True}
    )
    assert created.status_code == 201, created.text
    round_ = created.json()
    if reader_ai:
        toggled = await client.patch(
            f"/api/beta/manage/{sid}/rounds/{round_['id']}", json={"allow_reader_ai": True}
        )
        assert toggled.json()["allow_reader_ai"] is True
    await add_reader(engine)
    as_reader(client)
    token = round_["join_path"].rsplit("/", 1)[1]
    assert (await client.post(f"/api/beta/invite/{token}")).status_code == 201
    as_author(client)
    return {"sid": sid, "rid": round_["id"], "chapter": chapter["id"], "scene": scene["id"]}


async def reader_token(client, rid: str) -> str:
    as_reader(client)
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    pending = (await client.get(f"/api/mcp/consent/{request_id}")).json()
    assert [r["id"] for r in pending["beta_rounds"]] == [rid]
    approved = await client.post(
        f"/api/mcp/consent/{request_id}",
        json={"round_id": rid, "scopes": ["beta:read"]},
    )
    assert approved.status_code == 201, approved.text
    from urllib.parse import parse_qs, urlsplit

    code = parse_qs(urlsplit(approved.json()["redirect_url"]).query)["code"][0]
    tokens = (await exchange(client, registration, code, verifier)).json()
    return tokens["access_token"]


async def author_token(client, sid: str, scopes: list[str]) -> str:
    as_author(client)
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid, scopes)
    return (await exchange(client, registration, code, verifier)).json()["access_token"]


def result(response) -> dict:
    body = response.json()["result"]
    assert not body.get("isError"), body
    return body["structuredContent"]


def error_text(response) -> str:
    body = response.json()["result"]
    assert body.get("isError"), body
    return body["content"][0]["text"]


async def test_reader_grant_reads_only_its_round_while_author_allows(client, engine):
    setup = await published_round(client, engine, reader_ai=True)
    token = await reader_token(client, setup["rid"])

    connection = result(await oauth_tool(client, token, "get_connection"))
    assert connection["access_mode"] == "beta_reader"
    assert connection["permissions"] == ["beta:read"]
    overview = result(await oauth_tool(client, token, "get_beta_round_overview"))
    assert overview["round"]["title"] == "Round one"
    assert overview["chapters"][0]["words"] == 6
    chapter = result(
        await oauth_tool(client, token, "read_beta_chapter", {"chapter_id": setup["chapter"]})
    )
    assert chapter["scenes"][0]["content"] == "Maya left the harbour before dawn."
    assert result(await oauth_tool(client, token, "get_my_beta_feedback"))["count"] == 0
    assert "beta-reader connection" in error_text(await oauth_tool(client, token, "list_stories"))

    headers = {"Authorization": "Bearer " + token}
    rid = setup["rid"]
    assert (await client.get(f"/api/beta/rounds/{rid}/polls", headers=headers)).status_code == 200
    for method, path in [
        ("GET", f"/api/stories/{setup['sid']}/beta-status"),
        ("GET", f"/api/stories/{setup['sid']}/ai/context"),
        ("POST", f"/api/beta/rounds/{rid}/threads"),
    ]:
        response = await client.request(
            method, path, headers=headers, json={"body": "x"} if method == "POST" else None
        )
        assert response.status_code == 403, (method, path, response.text)

    as_author(client)
    await client.patch(
        f"/api/beta/manage/{setup['sid']}/rounds/{rid}", json={"allow_reader_ai": False}
    )
    assert (await client.get(f"/api/beta/rounds/{rid}", headers=headers)).status_code == 403
    assert "turned off" in error_text(await oauth_tool(client, token, "get_beta_round_overview"))


async def test_reader_consent_requires_author_opt_in_and_reader_only_scope(client, engine):
    setup = await published_round(client, engine, reader_ai=False)
    as_reader(client)
    registration = await register(client)
    request_id, _verifier, _ = await authorize(client, registration)
    assert (await client.get(f"/api/mcp/consent/{request_id}")).json()["beta_rounds"] == []
    refused = await client.post(
        f"/api/mcp/consent/{request_id}", json={"round_id": setup["rid"], "scopes": ["beta:read"]}
    )
    assert refused.status_code == 400
    as_author(client)
    await client.patch(
        f"/api/beta/manage/{setup['sid']}/rounds/{setup['rid']}", json={"allow_reader_ai": True}
    )
    as_reader(client)
    mixed = await client.post(
        f"/api/mcp/consent/{request_id}",
        json={"round_id": setup["rid"], "scopes": ["beta:read", "story:read"]},
    )
    assert mixed.status_code == 400


async def test_author_beta_tools_need_beta_write_and_keep_readers_anonymous(client, engine):
    setup = await published_round(client, engine, reader_ai=False)
    as_reader(client)
    posted = await client.post(
        f"/api/beta/rounds/{setup['rid']}/threads",
        json={"scene_id": setup["scene"], "body": "Who is Maya?", "submitted": True},
    )
    assert posted.status_code == 201, posted.text
    thread_id = posted.json()["id"]

    token = await author_token(client, setup["sid"], ["story:read", "prose:read", "beta:write"])
    rounds = result(await oauth_tool(client, token, "get_beta_rounds"))["rounds"]
    label = rounds[0]["readers"][0]["reader"]
    assert label.startswith("Reader ") and rounds[0]["open_feedback"] == 1
    feedback = result(await oauth_tool(client, token, "get_beta_feedback"))
    assert feedback["threads"][0]["messages"][0]["name"] == label
    raw = str(rounds) + str(feedback)
    assert "reader@example.invalid" not in raw and "Rea Der" not in raw

    drafted = result(
        await oauth_tool(
            client, token, "draft_beta_reply", {"thread_id": thread_id, "body": "Thanks!"}
        )
    )
    as_author(client)
    listed = (await client.get(f"/api/stories/{setup['sid']}/beta-feedback")).json()
    assert listed[0]["draft_replies"] == 1
    as_reader(client)
    seen = (await client.get(f"/api/beta/threads/{thread_id}")).json()
    assert all(m["id"] != drafted["message_id"] for m in seen["messages"])

    result(
        await oauth_tool(client, token, "mark_beta_feedback_addressed", {"thread_id": thread_id})
    )
    as_author(client)
    assert (await client.get(f"/api/stories/{setup['sid']}/beta-feedback")).json() == []

    plain = await author_token(client, setup["sid"], ["story:read", "prose:read"])
    assert "403" in error_text(
        await oauth_tool(client, plain, "draft_beta_reply", {"thread_id": thread_id, "body": "x"})
    )


async def test_story_grant_drops_beta_read_and_old_clients_see_new_scopes(client):
    sid = (await client.post("/api/stories", json={"title": "Scopes"})).json()["id"]
    token = await author_token(client, sid, SCOPES)
    permissions = result(await oauth_tool(client, token, "get_connection"))["permissions"]
    assert "beta:read" not in permissions and "beta:write" in permissions

    old = await register(client, scope=" ".join(SCOPES[:6]))
    request_id, _verifier, _ = await authorize(client, old)
    requested = (await client.get(f"/api/mcp/consent/{request_id}")).json()["requested_scopes"]
    assert {"beta:write", "beta:read"} <= set(requested)


async def test_disclosure_summary_counts_tracked_edits(client):
    sid = (await client.post("/api/stories", json={"title": "Disclosed"})).json()["id"]
    scene = (await client.post(f"/api/stories/{sid}/scenes", json={"title": "One"})).json()
    await client.put(
        f"/api/stories/{sid}/scenes/{scene['id']}/content", json={"content": "Words here."}
    )
    summary = (await client.get(f"/api/stories/{sid}/authorship/summary")).json()
    assert summary["story_title"] == "Disclosed"
    assert summary["prose"]["author"] >= 1
    assert summary["prose"]["mcp"] == summary["prose"]["assistant"] == 0
    assert summary["ai_tools"] == [] and summary["tracking_since"]


async def test_reader_shared_list_includes_beta_rounds(client, engine):
    """Regression: the beta rounds are read twice (summaries, then covers)."""
    beta = await published_round(client, engine, reader_ai=False)
    as_reader(client)
    listed = await client.get("/api/shared-stories")
    assert listed.status_code == 200, listed.text
    assert any(item["beta_round_id"] == beta["rid"] for item in listed.json())
    as_author(client)
