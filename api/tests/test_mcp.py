"""Real HTTP MCP calls through the hosted adapter and the application's write boundary."""

import hashlib
from uuid import uuid4

from tests.test_ai import outline, story


async def connect(client):
    sid = await story(client, "MCP story")
    token = (await client.post("/api/ai/agent-tokens", json={"story_id": sid})).json()
    headers = {
        "Authorization": "Bearer " + token["token"],
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
    }
    return sid, token, headers


async def rpc(client, headers, method, params=None):
    response = await client.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params or {},
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "error" not in payload, payload
    return payload["result"]


async def tool(client, headers, name, arguments=None):
    result = await rpc(
        client,
        headers,
        "tools/call",
        {
            "name": name,
            "arguments": arguments or {},
        },
    )
    assert not result.get("isError"), result
    return result["structuredContent"]


async def test_hosted_mcp_discovery_auth_context_resources_and_revocation(client):
    sid, token, headers = await connect(client)
    assert (await client.post("/mcp", json={})).status_code == 401
    assert (
        await client.post("/mcp", headers={**headers, "Origin": "https://evil.invalid"}, json={})
    ).status_code == 403
    init = await rpc(
        client,
        headers,
        "initialize",
        {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "QA", "version": "1"},
        },
    )
    assert init["serverInfo"]["name"] == "StoryTool"
    tools = await rpc(client, headers, "tools/list")
    names = {t["name"] for t in tools["tools"]}
    assert {"stage_story_changes", "get_story_findings", "restore_story_version"} <= names
    assert (await tool(client, headers, "get_connection"))["story_id"] == sid
    context = await tool(client, headers, "get_story_context")
    assert len(context["base_fingerprint"]) == 64
    assert (await tool(client, headers, "get_entity_schema", {"entity": "character"}))["create"][
        "properties"
    ]["role"]
    assert (await rpc(client, headers, "resources/list"))["resources"]
    assert (await rpc(client, headers, "prompts/list"))["prompts"]
    resource = await rpc(client, headers, "resources/read", {"uri": "storytool://guidelines"})
    assert "World time" in resource["contents"][0]["text"]
    prompt = await rpc(
        client,
        headers,
        "prompts/get",
        {"name": "writing_workflow", "arguments": {"task": "review"}},
    )
    assert prompt["messages"]
    other = await story(client, "Other")
    assert (await client.get(f"/api/stories/{other}/versions", headers=headers)).status_code == 401
    assert (await client.delete(f"/api/stories/{sid}", headers=headers)).status_code == 401
    await client.delete(f"/api/ai/agent-tokens/{token['id']}")
    assert (await client.post("/mcp", headers=headers, json={})).status_code == 401


async def test_mcp_connected_outline_prose_versions_and_recovery(client):
    sid, _, headers = await connect(client)
    base = f"/api/stories/{sid}"
    context = await tool(client, headers, "get_story_context")
    proposal = {**outline(), "base_fingerprint": context["base_fingerprint"]}
    staged = await tool(client, headers, "stage_story_changes", {"proposal": proposal})
    assert (await client.get(base + "/characters")).json() == []
    applied = await tool(client, headers, "apply_story_changes", {"run_id": staged["id"]})
    assert applied["status"] == "applied"
    assert (await tool(client, headers, "apply_story_changes", {"run_id": staged["id"]}))[
        "result"
    ] == applied["result"]
    scene = (await client.get(base + "/scenes")).json()[0]
    scene_context = await tool(client, headers, "get_scene_context", {"scene_id": scene["id"]})
    assert scene_context["chapter_brief"]
    prose = await tool(client, headers, "read_scene_prose", {"scene_id": scene["id"]})
    assert prose["content_hash"] == hashlib.sha256(b"").hexdigest()
    checkpoint = await tool(client, headers, "create_story_version", {"label": "Before drafting"})
    context = await tool(client, headers, "get_story_context")
    proposal = {
        "summary": "Draft the opening",
        "base_fingerprint": context["base_fingerprint"],
        "operations": [
            {
                "op": "write_prose",
                "entity": "scene",
                "ref": scene["id"],
                "data": {
                    "content": "Maya gave Eli the lantern.",
                    "expected_content_hash": prose["content_hash"],
                },
            }
        ],
    }
    staged = await tool(client, headers, "stage_story_changes", {"proposal": proposal})
    await tool(client, headers, "apply_story_changes", {"run_id": staged["id"]})
    text = await tool(client, headers, "read_scene_prose", {"scene_id": scene["id"], "limit": 5})
    assert text["content"] == "Maya " and text["next_offset"] == 5 and text["word_count"] == 5
    versions = await tool(client, headers, "list_story_versions")
    assert any(v["source"] == "automatic" for v in versions["versions"])
    old = await tool(
        client, headers, "read_story_version", {"version_id": checkpoint["id"], "entity": "scene"}
    )
    assert "content" not in old["items"][0]
    preview = await tool(
        client, headers, "preview_version_restore", {"version_id": checkpoint["id"]}
    )
    restored = await tool(
        client,
        headers,
        "restore_story_version",
        {"version_id": checkpoint["id"], "expected_fingerprint": preview["current_fingerprint"]},
    )
    assert restored["recovery_version"]["source"] == "recovery"
    assert (await tool(client, headers, "read_scene_prose", {"scene_id": scene["id"]}))[
        "content"
    ] == ""
    assert (await tool(client, headers, "get_story_findings"))["readiness"]
    arc = (await client.get(base + "/arcs")).json()[0]
    assert (await tool(client, headers, "get_arc_trace", {"arc_id": arc["id"]}))["trace"]
    comparison = await tool(
        client,
        headers,
        "compare_story_versions",
        {
            "from_version_id": checkpoint["id"],
            "to_version_id": restored["recovery_version"]["id"],
            "include_prose": True,
        },
    )
    assert comparison["change_count"] > 0
    page = await tool(client, headers, "query_story_entities", {"entity": "character", "limit": 1})
    assert len(page["items"]) == 1 and page["prose_included"] is False


async def test_mcp_stale_context_bad_references_and_atomic_prose_undo(client):
    sid, _, headers = await connect(client)
    base = f"/api/stories/{sid}"
    context = await tool(client, headers, "get_story_context")
    await client.patch(base, json={"title": "Author edit"})
    stale = await rpc(
        client,
        headers,
        "tools/call",
        {
            "name": "stage_story_changes",
            "arguments": {
                "proposal": {**outline(), "base_fingerprint": context["base_fingerprint"]}
            },
        },
    )
    assert stale["isError"]
    scene = (await client.post(base + "/scenes", json={"title": "Draft"})).json()
    await client.put(base + f"/scenes/{scene['id']}/content", json={"content": "Maya waits."})
    note = (
        await client.post(
            base + f"/scenes/{scene['id']}/annotations",
            json={"start_offset": 0, "end_offset": 4, "quoted_text": "Maya", "note": "Keep"},
        )
    ).json()
    context = await tool(client, headers, "get_story_context")
    prose = await tool(client, headers, "read_scene_prose", {"scene_id": scene["id"]})
    operation = {
        "op": "write_prose",
        "entity": "scene",
        "ref": scene["id"],
        "data": {"content": "Eli leaves.", "expected_content_hash": prose["content_hash"]},
    }
    proposal = {
        "summary": "Targeted rewrite",
        "base_fingerprint": context["base_fingerprint"],
        "operations": [operation],
    }
    bad = await rpc(
        client,
        headers,
        "tools/call",
        {
            "name": "stage_story_changes",
            "arguments": {
                "proposal": {
                    **proposal,
                    "operations": [
                        operation,
                        {
                            "op": "update",
                            "entity": "character",
                            "ref": str(uuid4()),
                            "data": {"name": "Bad"},
                        },
                    ],
                }
            },
        },
    )
    assert bad["isError"]
    assert (await client.get(base + f"/scenes/{scene['id']}/content")).json()[
        "content"
    ] == "Maya waits."
    staged = await tool(client, headers, "stage_story_changes", {"proposal": proposal})
    await tool(client, headers, "apply_story_changes", {"run_id": staged["id"]})
    await tool(client, headers, "undo_story_changes", {"run_id": staged["id"]})
    assert (await client.get(base + f"/scenes/{scene['id']}/content")).json()[
        "content"
    ] == "Maya waits."
    annotations = (await client.get(base + f"/scenes/{scene['id']}/annotations")).json()
    assert annotations[0]["id"] == note["id"] and not annotations[0]["is_orphaned"]


async def test_modern_mcp_protocol_and_foreign_scene_denial(client):
    sid, _, headers = await connect(client)
    metadata = {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {"name": "QA", "version": "1"},
        "io.modelcontextprotocol/clientCapabilities": {},
    }
    for method, params in (
        ("server/discover", {}),
        ("tools/list", {}),
        ("tools/call", {"name": "get_connection", "arguments": {}}),
    ):
        response = await client.post(
            "/mcp",
            headers={
                **headers,
                "MCP-Protocol-Version": "2026-07-28",
                "Mcp-Method": method,
                **({"Mcp-Name": params["name"]} if "name" in params else {}),
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": {**params, "_meta": metadata},
            },
        )
        assert response.status_code == 200, response.text
        assert "error" not in response.json(), response.text
    other = await story(client, "Foreign story")
    scene = (await client.post(f"/api/stories/{other}/scenes", json={"title": "Private"})).json()
    denied = await rpc(
        client,
        headers,
        "tools/call",
        {
            "name": "read_scene_prose",
            "arguments": {"scene_id": scene["id"]},
        },
    )
    assert denied["isError"]
    assert (await client.get(f"/api/stories/{sid}/characters")).json() == []


async def test_stdio_proxy_preserves_catalog_and_auth_without_tokens_in_results(monkeypatch):
    import httpx
    from mcp import Client

    from scripts.story_mcp_remote import create_proxy

    real_client = httpx.AsyncClient

    def respond(request):
        import json

        assert request.headers["Authorization"] == "Bearer proxy-only-test"
        body = json.loads(request.content)
        if body["method"] == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "get_connection",
                        "description": "Read connection",
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                ]
            }
        else:
            result = {
                "content": [{"type": "text", "text": "selected story"}],
                "structuredContent": {"story_id": "owned-story"},
            }
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})

    monkeypatch.setattr(
        "scripts.story_mcp_remote.httpx.AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond)),
    )
    async with Client(create_proxy("https://example.invalid", "proxy-only-test")) as remote:
        tools = await remote.list_tools()
        assert tools.tools[0].name == "get_connection"
        response = await remote.call_tool("get_connection", {})
        assert response.structured_content["story_id"] == "owned-story"
        assert "proxy-only-test" not in response.model_dump_json()


async def test_mcp_reads_dismissed_notices_and_checkpoint_failure_rolls_back(
    client, engine, monkeypatch
):
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from storytool.domain.narrative.models import Suggestion
    from storytool.domain.versioning import service

    sid, _, headers = await connect(client)
    async with AsyncSession(engine) as db:
        for dismissed in (False, True):
            db.add(
                Suggestion(
                    story_id=UUID(sid),
                    code="scene.prose_missing_element",
                    message="A scene needs a clearer goal.",
                    subject_key=str(dismissed),
                    noticed_by="deterministic",
                    is_dismissed=dismissed,
                )
            )
        await db.commit()
    findings = await tool(client, headers, "get_story_findings")
    assert len(findings["notices"]) == 1
    findings = await tool(client, headers, "get_story_findings", {"include_dismissed": True})
    assert len(findings["notices"]) == 2
    assert findings["dismissed_feedback"] and findings["observations_fresh_only"]
    context = await tool(client, headers, "get_story_context")
    staged = await tool(
        client,
        headers,
        "stage_story_changes",
        {
            "proposal": {**outline(), "base_fingerprint": context["base_fingerprint"]},
        },
    )

    async def fail(*args, **kwargs):
        raise RuntimeError("Injected checkpoint failure")

    monkeypatch.setattr(service, "automatic_checkpoint", fail)
    result = await rpc(
        client,
        headers,
        "tools/call",
        {
            "name": "apply_story_changes",
            "arguments": {"run_id": staged["id"]},
        },
    )
    assert result["isError"]
    assert (await client.get(f"/api/stories/{sid}/characters")).json() == []
    assert (await tool(client, headers, "inspect_story_proposals"))["runs"][0][
        "status"
    ] == "proposed"
