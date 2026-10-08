"""OAuth wire flow: discovery, SDK PKCE, author consent, scope enforcement and revocation."""

import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

from storytool.domain.auth.oauth import SCOPES, issuer, resource
from tests.test_ai import story


async def register(client, **overrides):
    response = await client.post(
        "/register",
        json={
            "client_name": "Gemini test",
            "redirect_uris": ["https://gemini.google.com/oauth/callback"],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            **overrides,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def authorize(client, registration, expected_status=302, **overrides):
    verifier = "v" * 64
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    response = await client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": registration["client_id"],
            "redirect_uri": registration["redirect_uris"][0],
            "state": "oauth-state",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "resource": resource(),
            **overrides,
        },
        follow_redirects=False,
    )
    assert response.status_code == expected_status, response.text
    if expected_status != 302:
        return None, verifier, response.text
    target = response.headers["location"]
    return parse_qs(urlsplit(target).query).get("request_id", [None])[0], verifier, target


async def approve(client, request_id, sid, scopes=None):
    response = await client.post(
        f"/api/mcp/consent/{request_id}",
        json={
            "story_id": sid,
            "scopes": scopes if scopes is not None else SCOPES,
        },
    )
    assert response.status_code == 201, response.text
    query = parse_qs(urlsplit(response.json()["redirect_url"]).query)
    assert query["state"] == ["oauth-state"]
    return query["code"][0]


async def exchange(client, registration, code, verifier, **overrides):
    return await client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "client_id": registration["client_id"],
            "redirect_uri": registration["redirect_uris"][0],
            "code": code,
            "code_verifier": verifier,
            "resource": resource(),
            **overrides,
        },
    )


async def oauth_tool(client, token, name, arguments=None):
    return await client.post(
        "/mcp",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-11-25",
            "Origin": "https://gemini.google.com",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
    )


async def test_oauth_discovery_pkce_consent_and_story_scope(client):
    response = await client.get("/mcp")
    assert response.status_code == 401
    assert "resource_metadata=" in response.headers["www-authenticate"]
    metadata = (await client.get("/.well-known/oauth-authorization-server")).json()
    assert metadata["registration_endpoint"].endswith("/register")
    assert metadata["issuer"] == issuer()
    assert metadata["code_challenge_methods_supported"] == ["S256"]
    protected = (await client.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert protected["resource"] == resource()
    sid = await story(client)
    other = await story(client, "Not authorized")
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    assert request_id
    pending = (await client.get(f"/api/mcp/consent/{request_id}")).json()
    assert pending["redirect_host"] == "gemini.google.com"
    code = await approve(client, request_id, sid)
    bad = await exchange(client, registration, code, "x" * 64)
    assert bad.status_code == 400 and bad.json()["error"] == "invalid_grant"
    exchanged = await exchange(client, registration, code, verifier)
    assert exchanged.status_code == 200, exchanged.text
    tokens = exchanged.json()
    headers = {"Authorization": "Bearer " + tokens["access_token"]}
    assert (await client.get(f"/api/stories/{sid}/ai/context", headers=headers)).status_code == 200
    assert (
        await client.get(f"/api/stories/{other}/ai/context", headers=headers)
    ).status_code == 401
    assert (await client.get("/api/ai/connections", headers=headers)).status_code == 401
    response = await oauth_tool(client, tokens["access_token"], "get_connection")
    assert response.status_code == 200
    result = response.json()["result"]["structuredContent"]
    assert result["auth"] == "OAuth" and result["story_id"] == sid
    assert (await exchange(client, registration, code, verifier)).status_code == 400
    assert (
        await client.post(
            f"/api/mcp/consent/{request_id}", json={"story_id": sid, "scopes": SCOPES}
        )
    ).status_code == 400


async def test_oauth_read_only_blocks_prose_writes_versions_and_all_token_paths(client):
    sid = await story(client)
    scene = (
        await client.post(f"/api/stories/{sid}/scenes", json={"title": "Private prose"})
    ).json()
    await client.put(
        f"/api/stories/{sid}/scenes/{scene['id']}/content", json={"content": "Private draft."}
    )
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid, ["story:read"])
    tokens = (await exchange(client, registration, code, verifier)).json()
    bearer = {"Authorization": "Bearer " + tokens["access_token"]}
    base = f"/api/stories/{sid}"
    assert (await client.get(base + "/ai/context", headers=bearer)).status_code == 200
    for suffix in [
        "/ai/context?include_prose=true",
        f"/scenes/{scene['id']}/content",
        "/ai/runs",
        "/ai/observations",
        f"/scenes/{scene['id']}/annotations",
    ]:
        assert (await client.get(base + suffix, headers=bearer)).status_code == 403
    assert (
        await client.post(base + "/ai/stage", headers=bearer, json={"summary": "Unapproved"})
    ).status_code == 403
    assert (
        await client.post(base + "/versions", headers=bearer, json={"label": "Unapproved"})
    ).status_code == 403
    denied = await oauth_tool(
        client, tokens["access_token"], "read_scene_prose", {"scene_id": scene["id"]}
    )
    assert denied.json()["result"]["isError"]
    grants = (await client.get("/api/mcp/grants")).json()
    assert len(grants) == 1 and grants[0]["scopes"] == ["story:read"]
    assert (await client.delete("/api/mcp/grants/" + grants[0]["id"])).status_code == 204
    assert (await client.get(base + "/ai/context", headers=bearer)).status_code == 401
    refresh = await client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "client_id": registration["client_id"],
            "refresh_token": tokens["refresh_token"],
        },
    )
    assert refresh.status_code == 400


async def test_oauth_refresh_rotation_and_reuse_revokes_connection(client):
    sid = await story(client)
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid)
    tokens = (await exchange(client, registration, code, verifier)).json()
    refreshed = await client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "client_id": registration["client_id"],
            "refresh_token": tokens["refresh_token"],
            "resource": resource(),
        },
    )
    assert refreshed.status_code == 200, refreshed.text
    new = refreshed.json()
    assert new["refresh_token"] != tokens["refresh_token"]
    assert (await oauth_tool(client, new["access_token"], "get_connection")).status_code == 200
    reuse = await client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "client_id": registration["client_id"],
            "refresh_token": tokens["refresh_token"],
        },
    )
    assert reuse.status_code == 400
    assert (await oauth_tool(client, new["access_token"], "get_connection")).status_code == 401


async def test_oauth_rejects_bad_redirect_resource_scope_and_denial_has_no_grant(client):
    registration = await register(client)
    request_id, _verifier, target = await authorize(
        client, registration, expected_status=400, redirect_uri="https://evil.invalid/callback"
    )
    assert request_id is None and "invalid_request" in target
    request_id, _, _ = await authorize(client, registration, resource="https://evil.invalid/mcp")
    assert request_id is None
    request_id, _, _ = await authorize(client, registration)
    denied = await client.post(f"/api/mcp/consent/{request_id}", json={"deny": True})
    assert denied.status_code == 201
    assert parse_qs(urlsplit(denied.json()["redirect_url"]).query)["error"] == ["access_denied"]
    assert (await client.get("/api/mcp/grants")).json() == []


async def test_oauth_tokens_are_hashed_and_confidential_secret_is_encrypted(client, engine):
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    from storytool.domain.auth.oauth_models import MCPClient, MCPToken

    sid = await story(client)
    registration = await register(client, token_endpoint_auth_method="client_secret_post")
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid)
    response = await exchange(
        client, registration, code, verifier, client_secret=registration["client_secret"]
    )
    assert response.status_code == 200
    tokens = response.json()
    async with AsyncSession(engine) as db:
        saved = await db.scalar(
            select(MCPClient).where(MCPClient.client_id == registration["client_id"])
        )
        assert saved.metadata_json["client_secret"] != registration["client_secret"]
        rows = list((await db.scalars(select(MCPToken))).all())
        serialized = str([(r.token_hash, r.parameters) for r in rows])
        assert (
            tokens["access_token"] not in serialized and tokens["refresh_token"] not in serialized
        )
        assert code not in serialized


async def test_oauth_rejects_token_resource_expired_code_and_scope_escalation(client, engine):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    from storytool.domain.auth.oauth import digest
    from storytool.domain.auth.oauth_models import MCPToken

    sid = await story(client)
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid, ["story:read"])
    bad_target = await exchange(
        client, registration, code, verifier, resource="https://evil.invalid/mcp"
    )
    assert bad_target.status_code == 400 and bad_target.json()["error"] == "invalid_target"
    tokens = (await exchange(client, registration, code, verifier)).json()
    escalated = await client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "client_id": registration["client_id"],
            "refresh_token": tokens["refresh_token"],
            "scope": "story:read story:write",
        },
    )
    assert escalated.status_code == 400 and escalated.json()["error"] == "invalid_scope"
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid)
    async with AsyncSession(engine) as db:
        row = await db.scalar(select(MCPToken).where(MCPToken.token_hash == digest(code)))
        row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await db.commit()
    assert (await exchange(client, registration, code, verifier)).status_code == 400


async def test_oauth_consent_and_grants_cannot_access_other_authors(client, engine):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy.ext.asyncio import AsyncSession

    from storytool.domain.auth.models import User, UserSession
    from storytool.domain.story.models import Story

    async with AsyncSession(engine) as db:
        second = User(google_sub="oauth-other", email="oauth-other@example.invalid")
        db.add(second)
        await db.flush()
        foreign = Story(user_id=second.id, title="Private other story")
        db.add(foreign)
        await db.flush()
        foreign_id = str(foreign.id)
        db.add(
            UserSession(
                user_id=second.id,
                token_hash=hashlib.sha256(b"oauth-other-session").hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
    registration = await register(client)
    request_id, _verifier, _ = await authorize(client, registration)
    rejected = await client.post(
        f"/api/mcp/consent/{request_id}", json={"story_id": foreign_id, "scopes": SCOPES}
    )
    assert rejected.status_code == 400
    sid = await story(client)
    await approve(client, request_id, sid)
    grant = (await client.get("/api/mcp/grants")).json()[0]
    client.cookies.set("storytool_session", "oauth-other-session", path="/api")
    assert (await client.get("/api/mcp/grants")).json() == []
    assert (await client.delete("/api/mcp/grants/" + grant["id"])).status_code == 404


async def test_oauth_revocation_endpoint_invalidates_access_and_refresh(client):
    sid = await story(client)
    registration = await register(client)
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid)
    tokens = (await exchange(client, registration, code, verifier)).json()
    revoked = await client.post(
        "/revoke",
        data={
            "client_id": registration["client_id"],
            "token": tokens["access_token"],
            "token_type_hint": "access_token",
        },
    )
    assert revoked.status_code == 200
    assert (await oauth_tool(client, tokens["access_token"], "get_connection")).status_code == 401


async def test_oauth_http_basic_without_form_client_id_is_supported(client):
    sid = await story(client)
    registration = await register(client, token_endpoint_auth_method="client_secret_basic")
    request_id, verifier, _ = await authorize(client, registration)
    code = await approve(client, request_id, sid)
    raw = f"{registration['client_id']}:{registration['client_secret']}"
    header = {"Authorization": "Basic " + base64.b64encode(raw.encode()).decode()}
    exchanged = await client.post(
        "/token",
        headers=header,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": registration["redirect_uris"][0],
            "resource": resource(),
        },
    )
    assert exchanged.status_code == 200, exchanged.text
    access = exchanged.json()["access_token"]
    assert (await oauth_tool(client, access, "get_connection")).status_code == 200
    assert (await client.post("/revoke", headers=header, data={"token": access})).status_code == 200
    assert (await oauth_tool(client, access, "get_connection")).status_code == 401
