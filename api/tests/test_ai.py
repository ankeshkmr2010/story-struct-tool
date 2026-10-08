"""AI credentials, connected batches, rollback/undo and delegated story access."""

import json

import httpx
import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from storytool.domain.ai.credentials import decrypt_key
from storytool.domain.ai.models import AIConnection
from storytool.domain.ai.schemas import Proposal


async def story(client: AsyncTestClient, title: str = "AI story") -> str:
    return (await client.post("/api/stories", json={"title": title})).json()["id"]


def outline() -> dict:
    operations = [
        {
            "op": "create",
            "entity": "character",
            "ref": "new:maya",
            "data": {"name": "Maya", "role": "protagonist"},
        },
        {"op": "create", "entity": "location", "ref": "new:harbour", "data": {"name": "Harbour"}},
        {
            "op": "create",
            "entity": "act",
            "ref": "new:act",
            "data": {"number": 1, "title": "Departure"},
        },
        {
            "op": "create",
            "entity": "beat",
            "ref": "new:beat",
            "data": {"label": "Inciting Incident", "act_id": "new:act"},
        },
        {
            "op": "create",
            "entity": "thread",
            "ref": "new:thread",
            "data": {"type": "a_story", "title": "The theft", "owner_character_id": "new:maya"},
        },
        {
            "op": "create",
            "entity": "chapter",
            "ref": "new:chapter",
            "data": {"title": "A late confession", "act_id": "new:act", "sort_key": 100},
        },
        {
            "op": "create",
            "entity": "scene",
            "ref": "new:scene",
            "data": {
                "title": "Before the opening",
                "chapter_id": "new:chapter",
                "location_id": "new:harbour",
                "pov_character_id": "new:maya",
                "story_time_ordinal": 10,
                "is_flashback": True,
            },
        },
        {
            "op": "create",
            "entity": "event",
            "ref": "new:event",
            "data": {
                "label": "The theft",
                "sort_ordinal": 10,
                "scene_id": "new:scene",
                "location_id": "new:harbour",
            },
        },
        {
            "op": "create",
            "entity": "arc",
            "ref": "new:arc",
            "data": {"character_id": "new:maya", "resolution": "Truth"},
        },
        {
            "op": "create",
            "entity": "arc_stage",
            "ref": "new:stage",
            "data": {"arc_id": "new:arc", "label": "Doubt"},
        },
    ]
    for entity, left, right in [
        ("chapter_beat", "chapter", "beat"),
        ("scene_beat", "scene", "beat"),
        ("scene_thread", "scene", "thread"),
        ("scene_arc_advance", "scene", "stage"),
        ("event_character", "event", "maya"),
        ("scene_presence", "scene", "maya"),
    ]:
        operations.append(
            {
                "op": "link",
                "entity": entity,
                "ref": f"link:{entity}",
                "data": {"from_id": f"new:{left}", "to_id": f"new:{right}"},
            }
        )
    return {"summary": "Connect the mystery and its flashback.", "operations": operations}


async def test_connected_proposal_is_previewed_applied_once_and_undone(
    client: AsyncTestClient,
) -> None:
    sid = await story(client)
    base = f"/api/stories/{sid}"
    preview = await client.post(f"{base}/ai/stage", json=outline())
    assert preview.status_code == 201, preview.text
    run_id = preview.json()["id"]
    assert (await client.get(f"{base}/characters")).json() == []
    applied = await client.post(f"{base}/ai/runs/{run_id}/apply")
    assert applied.status_code == 201, applied.text
    assert applied.json()["result"]["operations_applied"] == 16
    repeat = await client.post(f"{base}/ai/runs/{run_id}/apply")
    assert repeat.json()["result"] == applied.json()["result"]
    assert len((await client.get(f"{base}/characters")).json()) == 1
    timeline = (await client.get(f"{base}/timeline")).json()["entries"]
    event = next(item for item in timeline if item["kind"] == "event")
    assert event["ordinal"] == 10 and event["is_flashback"] is True
    assert event["location_name"] == "Harbour"
    assert event["participants"][0]["name"] == "Maya"
    undo = await client.post(f"{base}/ai/runs/{run_id}/undo")
    assert undo.status_code == 201, undo.text
    assert undo.json()["status"] == "undone"
    assert (await client.get(f"{base}/timeline")).json()["entries"] == []


async def test_invalid_or_foreign_references_leave_no_partial_writes(
    client: AsyncTestClient,
) -> None:
    sid = await story(client)
    other = await story(client, "Other")
    character = (
        await client.post(f"/api/stories/{other}/characters", json={"name": "Private"})
    ).json()
    payload = outline()
    payload["operations"].append(
        {"op": "update", "entity": "character", "ref": character["id"], "data": {"name": "Stolen"}}
    )
    assert (await client.post(f"/api/stories/{sid}/ai/stage", json=payload)).status_code == 404
    assert (await client.get(f"/api/stories/{sid}/characters")).json() == []
    bad = outline()
    bad["operations"][0]["data"]["user_id"] = sid
    assert (await client.post(f"/api/stories/{sid}/ai/stage", json=bad)).status_code == 400
    assert (await client.get(f"/api/stories/{sid}/characters")).json() == []


async def test_apply_and_undo_refuse_to_overwrite_later_manual_edits(
    client: AsyncTestClient,
) -> None:
    sid = await story(client)
    base = f"/api/stories/{sid}"
    run_id = (await client.post(f"{base}/ai/stage", json=outline())).json()["id"]
    await client.patch(base, json={"premise": "A manual change"})
    assert (await client.post(f"{base}/ai/runs/{run_id}/apply")).status_code == 409
    fresh = (await client.post(f"{base}/ai/stage", json=outline())).json()["id"]
    assert (await client.post(f"{base}/ai/runs/{fresh}/apply")).status_code == 201
    await client.patch(base, json={"premise": "Keep this later change"})
    assert (await client.post(f"{base}/ai/runs/{fresh}/undo")).status_code == 409
    assert (await client.get(base)).json()["premise"] == "Keep this later change"


async def test_provider_keys_are_encrypted_and_not_returned_or_put_in_context(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    raw_key = "secret-test-provider-key"
    response = await client.put(
        "/api/ai/connections",
        json={"provider": "openai", "model": "test-model", "api_key": raw_key},
    )
    assert response.status_code == 200, response.text
    assert raw_key not in response.text
    assert response.json()["key_suffix"] == "-key"
    async with AsyncSession(engine) as db:
        record = (await db.execute(select(AIConnection))).scalar_one()
        assert record.encrypted_key != raw_key
        assert decrypt_key(record.encrypted_key) == raw_key
    assert raw_key not in (await client.get("/api/ai/connections")).text
    sid = await story(client)
    assert raw_key not in (await client.get(f"/api/stories/{sid}/ai/context")).text
    assert (await client.delete(f"/api/ai/connections/{response.json()['id']}")).status_code == 204


async def test_model_proposal_uses_saved_connection_and_does_not_apply_automatically(
    client: AsyncTestClient,
    monkeypatch,
) -> None:
    sid = await story(client)
    conn = (
        await client.put(
            "/api/ai/connections",
            json={"provider": "anthropic", "model": "test-model", "api_key": "secret-test-key"},
        )
    ).json()

    async def fake(provider, model, api_key, prompt, context):
        assert provider == "anthropic" and api_key == "secret-test-key"
        assert api_key not in json.dumps(context)
        return Proposal.model_validate(outline()), {"input_tokens": 100, "output_tokens": 200}

    monkeypatch.setattr("storytool.domain.ai.runner.generate_proposal", fake)
    response = await client.post(
        f"/api/stories/{sid}/ai/propose",
        json={
            "connection_id": conn["id"],
            "prompt": "Build a mystery",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "proposed"
    assert response.json()["usage"]["input_tokens"] == 100
    assert (await client.get(f"/api/stories/{sid}/characters")).json() == []


async def test_chat_remembers_advice_and_populates_only_when_applied(
    client: AsyncTestClient, monkeypatch
) -> None:
    sid = await story(client)
    base = f"/api/stories/{sid}"
    conn = (
        await client.put(
            "/api/ai/connections",
            json={"provider": "openai", "model": "test-model", "api_key": "secret-test-key"},
        )
    ).json()
    calls = []

    async def fake(provider, model, api_key, prompt, context):
        calls.append(context)
        if len(calls) == 1:
            return Proposal(summary="Should Maya learn to trust her companion?"), {}
        if len(calls) == 2:
            return Proposal.model_validate(outline()), {}
        return Proposal(summary="Maya now has a connected outline and timeline."), {}

    monkeypatch.setattr("storytool.domain.ai.runner.generate_proposal", fake)
    first = await client.post(
        base + "/ai/propose",
        json={"connection_id": conn["id"], "prompt": "Help me choose an arc"},
    )
    assert first.status_code == 201, first.text
    assert first.json()["proposal"]["operations"] == []
    assert calls[0]["conversation"] == []
    assert (await client.get(base + "/characters")).json() == []
    second = await client.post(
        base + "/ai/propose",
        json={
            "connection_id": conn["id"],
            "prompt": "Yes, populate the outline and timeline with that idea",
            "conversation_run_ids": [first.json()["id"]],
        },
    )
    assert second.status_code == 201, second.text
    previous = calls[1]["conversation"][0]
    assert previous["user"] == "Help me choose an arc"
    assert previous["assistant"] == "Should Maya learn to trust her companion?"
    assert previous["change_status"] == "proposed"
    assert (await client.get(base + "/characters")).json() == []
    assert (await client.post(f"{base}/ai/runs/{second.json()['id']}/apply")).status_code == 201
    assert (await client.get(base + "/characters")).json()[0]["name"] == "Maya"
    assert len((await client.get(base + "/ai/runs")).json()) == 2
    other = await story(client, "Other conversation")
    invalid = await client.post(
        f"/api/stories/{other}/ai/propose",
        json={
            "connection_id": conn["id"],
            "prompt": "Continue",
            "conversation_run_ids": [first.json()["id"]],
        },
    )
    assert invalid.status_code == 404
    assert len(calls) == 2
    third = await client.post(
        base + "/ai/propose",
        json={
            "connection_id": conn["id"],
            "prompt": "Review my current story",
            "conversation_run_ids": [second.json()["id"]],
        },
    )
    assert third.status_code == 201, third.text
    assert calls[2]["conversation"][0]["change_status"] == "applied"
    assert calls[2]["entities"]["character"][0]["name"] == "Maya"
    conflict = await client.post(base + "/ai/stage", json=outline())
    assert conflict.status_code == 400
    assert "conflicts with existing story data" in conflict.json()["detail"]
    assert len((await client.get(base + "/characters")).json()) == 1


async def test_external_agent_token_is_story_scoped_and_revocable(client: AsyncTestClient) -> None:
    sid = await story(client)
    other = await story(client, "Other")
    token = (await client.post("/api/ai/agent-tokens", json={"story_id": sid})).json()
    headers = {"Authorization": "Bearer " + token["token"]}
    assert (await client.get(f"/api/stories/{sid}/ai/context", headers=headers)).status_code == 200
    assert (
        await client.get(f"/api/stories/{other}/ai/context", headers=headers)
    ).status_code == 401
    assert (await client.get("/api/ai/connections", headers=headers)).status_code == 401
    assert (
        await client.post(f"/api/stories/{sid}/ai/propose", headers=headers, json={})
    ).status_code == 401
    staged = await client.post(f"/api/stories/{sid}/ai/stage", headers=headers, json=outline())
    assert staged.status_code == 201, staged.text
    assert (await client.delete(f"/api/ai/agent-tokens/{token['id']}")).status_code == 204
    assert (await client.get(f"/api/stories/{sid}/ai/context", headers=headers)).status_code == 401


@pytest.mark.parametrize("provider", ["anthropic", "openai", "openrouter"])
async def test_real_provider_sdk_tool_call_adapters_without_live_billing(
    provider, monkeypatch
) -> None:
    from storytool.domain.ai.runner import generate_proposal

    captured = []

    def response(request):
        payload = json.loads(request.content)
        captured.append(payload)
        assert "adapter-secret-key" not in request.content.decode()
        if provider == "anthropic":
            body = {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": "test-model",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool_test",
                        "name": "propose_story_changes",
                        "input": outline(),
                    }
                ],
                "stop_reason": "tool_use",
                "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 20},
            }
        elif provider == "openrouter":
            assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
            assert payload["model"] == "nvidia/nemotron-3.5-lightning:free"
            assert "models" not in payload
            assert payload["provider"] == {
                "require_parameters": True,
                "max_price": {"prompt": 0, "completion": 0},
            }
            assert payload["tool_choice"]["function"]["name"] == "propose_story_changes"
            body = {
                "id": "chatcmpl_test",
                "object": "chat.completion",
                "created": 1,
                "model": payload["model"],
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_test",
                                    "type": "function",
                                    "function": {
                                        "name": "propose_story_changes",
                                        "arguments": json.dumps(outline()),
                                    },
                                }
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
            }
        else:
            body = {
                "id": "resp_test",
                "object": "response",
                "created_at": 1,
                "model": "test-model",
                "status": "completed",
                "output": [
                    {
                        "type": "function_call",
                        "id": "fc_test",
                        "call_id": "call_test",
                        "name": "propose_story_changes",
                        "arguments": json.dumps(outline()),
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
            }
        return response_class(200, json=body)

    if provider == "anthropic":
        import anthropic
        import httpx2

        response_class = httpx2.Response
        http_client = httpx2.AsyncClient(transport=httpx2.MockTransport(response))

        real_client = anthropic.AsyncAnthropic
        monkeypatch.setattr(
            anthropic,
            "AsyncAnthropic",
            lambda **kwargs: real_client(**kwargs, http_client=http_client),
        )
    else:
        import openai

        response_class = httpx.Response
        http_client = httpx.AsyncClient(transport=httpx.MockTransport(response))

        real_client = openai.AsyncOpenAI
        monkeypatch.setattr(
            openai, "AsyncOpenAI", lambda **kwargs: real_client(**kwargs, http_client=http_client)
        )
    proposal, usage = await generate_proposal(
        provider,
        "nvidia/nemotron-3.5-lightning:free" if provider == "openrouter" else "test-model",
        "adapter-secret-key",
        "Build a mystery",
        {"entities": {}},
    )
    assert proposal.summary == outline()["summary"]
    assert len(proposal.operations) == 16
    assert usage["output_tokens"] == 20
    assert len(captured) == 1
    tool = captured[0]["tools"][0]
    assert (tool["function"] if provider == "openrouter" else tool)[
        "name"
    ] == "propose_story_changes"
    if provider == "openai":
        assert captured[0]["store"] is False


async def test_reader_observations_retain_probabilities_and_expire_on_changed_source(
    client, monkeypatch
) -> None:
    from storytool.domain.noticing.types import SceneElements, SceneNotices, StructureNotice

    sid = await story(client)
    base = f"/api/stories/{sid}"
    scene = (await client.post(f"{base}/scenes", json={"title": "The harbour"})).json()
    await client.put(
        f"{base}/scenes/{scene['id']}/content", json={"content": "Maya left the harbour."}
    )

    class Reader:
        name = "jev"

        async def notice_scene(self, *args):
            return SceneNotices(
                noticed_by="jev",
                structure=StructureNotice(
                    probability=0.7,
                    elements=SceneElements(goal=0.2, conflict=0.4, outcome=0.8),
                ),
            )

    async def fake_reader(*args):
        return Reader(), {
            "noticer": "jev",
            "model": "test",
            "claude_available": False,
            "jev_available": True,
        }

    monkeypatch.setattr("storytool.domain.noticing.controller.user_noticer", fake_reader)
    assert (await client.post(f"{base}/notice")).status_code == 201
    context = (await client.get(f"{base}/ai/context")).json()
    assert context["observations"][0]["source"] == "jev"
    assert context["observations"][0]["payload"]["structure"]["probability"] == 0.7
    assert context["observations"][0]["payload"]["structure"]["elements"]["goal"] == 0.2
    await client.put(
        f"{base}/scenes/{scene['id']}/content", json={"content": "An entirely different scene."}
    )
    assert (await client.get(f"{base}/ai/context")).json()["observations"] == []


async def test_openrouter_connection_checks_key_and_tools_without_inference(client, monkeypatch):
    import httpx

    from storytool.domain.ai import runner

    seen = []
    model = "nvidia/nemotron-3.5-lightning:free"

    def response(request):
        seen.append(request.url.path)
        assert request.method == "GET"
        if request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {"label": "Test key"}})
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": model,
                        "supported_parameters": ["tools", "tool_choice"],
                    }
                ]
            },
        )

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(response)),
    )
    await runner.test_provider("openrouter", model, "test-secret-key")
    assert seen == ["/api/v1/key", "/api/v1/models"]
    saved = await client.put(
        "/api/ai/connections",
        json={
            "provider": "openrouter",
            "model": model,
            "api_key": "test-secret-key",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["provider"] == "openrouter"
    assert "test-secret-key" not in saved.text


@pytest.mark.parametrize("status", [429, 200])
async def test_openrouter_rejects_limits_and_invalid_tool_output_safely(monkeypatch, status):
    import openai
    from litestar.exceptions import ServiceUnavailableException

    from storytool.domain.ai.runner import generate_proposal

    def response(request):
        if status == 429:
            return httpx.Response(429, json={"error": {"message": "private-debug-details"}})
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl_bad",
                "object": "chat.completion",
                "created": 1,
                "model": "test-model",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_bad",
                                    "type": "function",
                                    "function": {
                                        "name": "propose_story_changes",
                                        "arguments": "invalid JSON",
                                    },
                                }
                            ],
                        },
                    }
                ],
            },
        )

    real_client = openai.AsyncOpenAI
    monkeypatch.setattr(
        openai,
        "AsyncOpenAI",
        lambda **kwargs: real_client(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(response))
        ),
    )
    with pytest.raises(ServiceUnavailableException) as error:
        await generate_proposal(
            "openrouter",
            "nvidia/nemotron-3.5-lightning:free",
            "test-secret-key",
            "Populate beats",
            {"entities": {}},
        )
    assert "private-debug-details" not in error.value.detail
    assert "test-secret-key" not in error.value.detail
    if status == 429:
        assert "limit or provider capacity" in error.value.detail


async def test_review_mode_preserves_actual_chat_request(client, monkeypatch):
    from storytool.domain.ai.schemas import Proposal

    sid = await story(client)
    conn = (
        await client.put(
            "/api/ai/connections",
            json={
                "provider": "openrouter",
                "model": "nvidia/nemotron-3.5-lightning:free",
                "api_key": "test-secret-key",
            },
        )
    ).json()

    async def fake(provider, model, api_key, prompt, context):
        assert prompt == "hello"
        assert context["assistant_mode"] == "review"
        from storytool.domain.ai.runner import proposal_schema

        schema = proposal_schema(context)
        variants = schema["properties"]["operations"]["items"]["anyOf"]
        scene = next(
            v
            for v in variants
            if v["properties"]["op"]["const"] == "create"
            and v["properties"]["entity"]["const"] == "scene"
        )
        assert scene["properties"]["data"]["additionalProperties"] is False
        assert "characters_present" not in scene["properties"]["data"]["properties"]
        assert "pov_character_id" in scene["properties"]["data"]["properties"]
        return Proposal(summary="Hello! What would you like to work on?"), {}

    monkeypatch.setattr("storytool.domain.ai.runner.generate_proposal", fake)
    response = await client.post(
        f"/api/stories/{sid}/ai/propose",
        json={
            "connection_id": conn["id"],
            "prompt": "hello",
            "mode": "review",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["proposal"]["operations"] == []


async def test_model_request_has_a_total_deadline(monkeypatch):
    import asyncio

    from litestar.exceptions import ServiceUnavailableException

    from storytool.domain.ai import runner

    real_timeout = asyncio.timeout
    monkeypatch.setattr(runner.asyncio, "timeout", lambda seconds: real_timeout(0.01))

    async def slow(*args):
        await asyncio.sleep(1)
        raise AssertionError("should have been cancelled")

    monkeypatch.setattr(runner, "_generate_proposal", slow)
    with pytest.raises(ServiceUnavailableException) as error:
        await runner.generate_proposal("openrouter", "test-model", "test-key", "hello", {})
    assert "took too long" in error.value.detail


async def test_invalid_edits_keep_the_assistant_reply_but_cannot_be_applied(client, monkeypatch):
    sid = await story(client)
    conn = (
        await client.put(
            "/api/ai/connections",
            json={
                "provider": "openrouter",
                "model": "nvidia/nemotron-3.5-lightning:free",
                "api_key": "test-secret-key",
            },
        )
    ).json()

    async def fake(*args):
        return Proposal(
            summary="I suggest giving Maya a clearer goal.",
            operations=[
                {
                    "op": "create",
                    "entity": "character",
                    "ref": "new:maya",
                    "data": {"name": "Maya", "unsupported_field": "bad"},
                }
            ],
        ), {}

    monkeypatch.setattr("storytool.domain.ai.runner.generate_proposal", fake)
    base = f"/api/stories/{sid}"
    response = await client.post(
        base + "/ai/propose",
        json={
            "connection_id": conn["id"],
            "prompt": "Improve Maya",
        },
    )
    assert response.status_code == 201, response.text
    run = response.json()
    assert run["summary"] == "I suggest giving Maya a clearer goal."
    assert run["status"] == "invalid"
    assert "unsupported fields" in run["result"]["validation_error"]
    assert (await client.get(base + "/characters")).json() == []
    assert (await client.post(f"{base}/ai/runs/{run['id']}/apply")).status_code == 409
    assert (await client.get(base + "/ai/runs")).json()[0]["summary"] == run["summary"]


async def test_openrouter_plain_text_and_text_with_edits_are_returned(monkeypatch):
    import openai

    from storytool.domain.ai.runner import generate_proposal

    with_tools = False

    def response(request):
        message = {"role": "assistant", "content": "Hello! We can work on Maya's arc."}
        if with_tools:
            message["tool_calls"] = [
                {
                    "id": "call_test",
                    "type": "function",
                    "function": {
                        "name": "propose_story_changes",
                        "arguments": json.dumps(outline()),
                    },
                }
            ]
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl_reply",
                "object": "chat.completion",
                "created": 1,
                "model": "test-model",
                "choices": [{"index": 0, "finish_reason": "stop", "message": message}],
            },
        )

    real_client = openai.AsyncOpenAI
    monkeypatch.setattr(
        openai,
        "AsyncOpenAI",
        lambda **kwargs: real_client(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(response))
        ),
    )
    plain, _ = await generate_proposal("openrouter", "test-model", "test-key", "hello", {})
    assert plain.summary == "Hello! We can work on Maya's arc."
    assert plain.operations == []
    with_tools = True
    edited, _ = await generate_proposal("openrouter", "test-model", "test-key", "populate", {})
    assert edited.summary.startswith(plain.summary)
    assert outline()["summary"] in edited.summary
    assert len(edited.operations) == 16


async def test_response_logs_preserve_reply_and_redact_credentials(caplog):
    import logging

    from storytool.domain.ai.diagnostics import response_log

    caplog.set_level(logging.INFO, logger="storytool.ai")
    response_log(
        "ai_model_response",
        reply="Hello! sk-or-v1-test-secret-key\nBearer private-token",
        operations=0,
        recommendations=0,
    )
    message = caplog.records[-1].getMessage()
    assert "Hello!" in message
    assert "sk-or-v1-test-secret-key" not in message
    assert "private-token" not in message
    assert "[REDACTED_API_KEY]" in message
    assert "\n" not in message
    assert json.loads(message.split(" ", 1)[1])["operations"] == 0
