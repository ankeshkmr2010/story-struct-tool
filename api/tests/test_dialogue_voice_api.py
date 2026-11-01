"""Dialogue voice through the API: Run reaches its route, and the shared-reader pass survives
releasing its database transaction before the remote calls (both broke on first deploy)."""

from types import SimpleNamespace

import pytest
from litestar.testing import AsyncTestClient

from storytool.config import Settings

STORIES = "/api/stories"


async def story_with_dialogue(client: AsyncTestClient) -> str:
    sid = (await client.post(STORIES, json={"title": "Voices"})).json()["id"]
    base = f"{STORIES}/{sid}"
    for name in ("Maya", "Finn"):
        await client.post(f"{base}/characters", json={"name": name})
    chapter = (await client.post(f"{base}/chapters", json={"title": "One"})).json()
    scene = (
        await client.post(f"{base}/scenes", json={"title": "Dock", "chapter_id": chapter["id"]})
    ).json()
    prose = "\n\n".join(
        [f"“Well, I just think we should go, take {n}.” said Maya." for n in range(11)]
        + [f"“Well, I just think we should go, try {n}.” said Finn." for n in range(11)]
        + ["“Who goes first?”"]
    )
    await client.put(f"{base}/scenes/{scene['id']}/content", json={"content": prose})
    return sid


async def test_run_reaches_the_check_and_flags_alike_voices(client: AsyncTestClient) -> None:
    sid = await story_with_dialogue(client)
    response = await client.get(f"{STORIES}/{sid}/evaluations/dialogue_voice")
    assert response.status_code == 200
    body = response.json()
    assert body["visual"]["attributed"] == 22 and body["visual"]["lines"] == 23
    assert [f["code"] for f in body["findings"]] == ["dialogue.similar_voices"]


async def test_shared_reader_pass_runs_after_its_transaction_is_released(
    client: AsyncTestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = await story_with_dialogue(client)
    import storytool.domain.decisions.providers as providers
    import storytool.domain.decisions.service as service

    class Reader:
        def __init__(self, *args: object) -> None:
            pass

        async def evaluate(self, *, model, state, questions):
            return SimpleNamespace(answers={})

    monkeypatch.setattr(Settings, "shared_reader_available", property(lambda self: True))
    monkeypatch.setattr(providers, "shared_provider", lambda: (object(), "jev"))
    monkeypatch.setattr(service, "DecisionService", Reader)
    response = await client.post(f"{STORIES}/{sid}/evaluations/dialogue_voice/shared-reader")
    assert response.status_code == 201, response.text
    assert response.json()["evaluator_id"] == "dialogue_voice"
    other = await client.post(f"{STORIES}/{sid}/evaluations/mice_nesting/shared-reader")
    assert other.status_code == 404
