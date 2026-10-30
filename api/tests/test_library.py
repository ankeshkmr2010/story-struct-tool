"""Your stories: card arrangement, derived status and open items, and open items."""

from tests.test_ai import outline


async def _story_with_scene(client, title: str) -> tuple[str, str]:
    story = (await client.post("/api/stories", json={"title": title})).json()
    base = f"/api/stories/{story['id']}"
    proposal = (await client.post(base + "/ai/stage", json=outline())).json()
    await client.post(base + f"/ai/runs/{proposal['id']}/apply")
    scene = (await client.get(base + "/scenes")).json()[0]
    return story["id"], scene["id"]


async def test_cards_pin_archive_and_move_without_versioning(client):
    first = (await client.post("/api/stories", json={"title": "First"})).json()["id"]
    second = (await client.post("/api/stories", json={"title": "Second"})).json()["id"]
    versions = (await client.get(f"/api/stories/{first}/versions")).json()

    assert (
        await client.patch(f"/api/library/cards/{first}", json={"position": 200, "pinned": True})
    ).status_code == 200
    assert (
        await client.patch(f"/api/library/cards/{second}", json={"archived": True})
    ).status_code == 200
    cards = {
        card["story_id"]: card
        for card in (await client.get("/api/library/overview")).json()["cards"]
    }
    assert (
        cards[first]["position"] == 200 and cards[first]["pinned"] and not cards[first]["archived"]
    )
    assert cards[second]["archived"] and cards[second]["position"] is None
    assert cards[first]["status"] == "planning"
    # Arranging cards is not a story edit: no new checkpoint.
    assert (await client.get(f"/api/stories/{first}/versions")).json() == versions

    await client.patch(f"/api/library/cards/{first}", json={"pinned": False})
    card = next(
        card
        for card in (await client.get("/api/library/overview")).json()["cards"]
        if card["story_id"] == first
    )
    assert card["position"] == 200 and not card["pinned"]


async def test_cards_reject_other_accounts_and_agents(client):
    story_id, _ = await _story_with_scene(client, "Mine")
    missing = "00000000-0000-7000-8000-000000000000"
    assert (
        await client.patch(f"/api/library/cards/{missing}", json={"pinned": True})
    ).status_code == 404
    token = (await client.post("/api/ai/agent-tokens", json={"story_id": story_id})).json()
    headers = {"Authorization": "Bearer " + token["token"]}
    assert (await client.get("/api/library/overview", headers=headers)).status_code in {401, 403}


async def test_tks_and_status_show_on_cards(client):
    story_id, scene_id = await _story_with_scene(client, "Tally")
    base = f"/api/stories/{story_id}/scenes/{scene_id}/content"
    await client.put(base, json={"content": "One two three [TK: the inn] four."})
    overview = (await client.get("/api/library/overview")).json()
    card = next(card for card in overview["cards"] if card["story_id"] == story_id)
    assert card["tk_count"] == 1 and card["status"] == "draft"
    assert card["goal_percent"] is None


async def test_design_view_choices_default_by_story_age_and_can_be_set(client, monkeypatch):
    from datetime import UTC, datetime

    from storytool.domain.story import library

    story_id = (await client.post("/api/stories", json={"title": "Fresh"})).json()["id"]

    async def read():
        overview = (await client.get("/api/library/overview")).json()
        return next(c for c in overview["cards"] if c["story_id"] == story_id)

    monkeypatch.setattr(library, "SIMPLE_SINCE", datetime(2000, 1, 1, tzinfo=UTC))
    fresh = await read()
    assert fresh["show_all_tools"] is False and fresh["full_ladder"] is False
    monkeypatch.setattr(library, "SIMPLE_SINCE", datetime(2999, 1, 1, tzinfo=UTC))
    assert (await read())["show_all_tools"] is True
    await client.patch(f"/api/library/cards/{story_id}", json={"show_all_tools": False})
    assert (await read())["show_all_tools"] is False
