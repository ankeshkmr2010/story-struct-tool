"""On-demand evaluation engine: listing, readiness and the scene/sequel rhythm evaluator."""

from litestar.testing import AsyncTestClient

STORIES = "/api/stories"


async def make_story_with_scenes(client: AsyncTestClient, types: list[str]) -> str:
    story = (await client.post(STORIES, json={"title": "The Cartographer"})).json()
    chapter = (await client.post(f"{STORIES}/{story['id']}/chapters", json={"number": 1})).json()
    for index, scene_type in enumerate(types):
        response = await client.post(
            f"{STORIES}/{story['id']}/scenes",
            json={
                "title": f"S{index}",
                "type": scene_type,
                "chapter_id": chapter["id"],
                "sort_key": (index + 1) * 100,
            },
        )
        assert response.status_code == 201
    return story["id"]


async def test_lists_evaluators_with_readiness(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"])
    listed = (await client.get(f"{STORIES}/{story_id}/evaluations")).json()
    rhythm = next(e for e in listed if e["id"] == "scene_rhythm")
    assert rhythm["ready"] is False
    assert rhythm["missing"]


async def test_not_ready_evaluator_returns_missing_not_findings(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"])
    result = (await client.get(f"{STORIES}/{story_id}/evaluations/scene_rhythm")).json()
    assert result["ready"] is False
    assert result["findings"] == []


async def test_unknown_evaluator_is_404(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"])
    response = await client.get(f"{STORIES}/{story_id}/evaluations/nope")
    assert response.status_code == 404


async def test_flags_a_long_action_run(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(
        client, ["scene", "scene", "scene", "scene", "sequel", "scene"]
    )
    result = (await client.get(f"{STORIES}/{story_id}/evaluations/scene_rhythm")).json()
    assert result["ready"] is True
    assert [f["code"] for f in result["findings"]] == ["rhythm.scene_run"]
    assert [(r["type"], r["length"]) for r in result["visual"]["runs"]] == [
        ("scene", 4),
        ("sequel", 1),
        ("scene", 1),
    ]


async def test_alternating_story_has_no_findings(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene", "sequel", "scene", "sequel"])
    result = (await client.get(f"{STORIES}/{story_id}/evaluations/scene_rhythm")).json()
    assert result["findings"] == []


async def test_no_sequels_gives_one_hint_instead_of_run_flags(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"] * 6)
    result = (await client.get(f"{STORIES}/{story_id}/evaluations/scene_rhythm")).json()
    assert [f["code"] for f in result["findings"]] == ["rhythm.no_sequels"]


async def link(client: AsyncTestClient, story_id: str, scene_id: str, thread_id: str) -> None:
    response = await client.post(
        f"{STORIES}/{story_id}/scenes/{scene_id}/threads", json={"thread_id": thread_id}
    )
    assert response.status_code == 201, response.text


async def test_thread_mice_category_round_trips(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"])
    thread = (
        await client.post(f"{STORIES}/{story_id}/threads", json={"type": "a_story", "mice": "idea"})
    ).json()
    assert thread["mice"] == "idea"
    cleared = await client.patch(
        f"{STORIES}/{story_id}/threads/{thread['id']}", json={"mice": None}
    )
    assert cleared.json()["mice"] is None
    bad = await client.post(f"{STORIES}/{story_id}/threads", json={"type": "a_story", "mice": "x"})
    assert bad.status_code == 400


async def test_mice_flags_crossed_threads(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"] * 8)
    scenes = (await client.get(f"{STORIES}/{story_id}/scenes")).json()
    scenes.sort(key=lambda s: s["sort_key"])
    murder = (
        await client.post(
            f"{STORIES}/{story_id}/threads",
            json={"type": "a_story", "title": "Murder", "mice": "idea"},
        )
    ).json()
    island = (
        await client.post(
            f"{STORIES}/{story_id}/threads", json={"type": "b_story", "title": "Island"}
        )
    ).json()
    for index in (0, 5):
        await link(client, story_id, scenes[index]["id"], murder["id"])
    for index in (2, 7):
        await link(client, story_id, scenes[index]["id"], island["id"])

    result = (await client.get(f"{STORIES}/{story_id}/evaluations/mice_nesting")).json()
    assert result["ready"] is True
    codes = [f["code"] for f in result["findings"]]
    assert codes == ["mice.crossed_threads", "mice.uncategorised"]
    assert [(s["title"], s["open"], s["close"]) for s in result["visual"]["spans"]] == [
        ("Murder", 0, 5),
        ("Island", 2, 7),
    ]


async def test_mice_nested_threads_have_no_crossing(client: AsyncTestClient) -> None:
    story_id = await make_story_with_scenes(client, ["scene"] * 6)
    scenes = (await client.get(f"{STORIES}/{story_id}/scenes")).json()
    scenes.sort(key=lambda s: s["sort_key"])
    outer = (
        await client.post(
            f"{STORIES}/{story_id}/threads", json={"type": "a_story", "mice": "event"}
        )
    ).json()
    inner = (
        await client.post(
            f"{STORIES}/{story_id}/threads", json={"type": "b_story", "mice": "milieu"}
        )
    ).json()
    for index in (0, 5):
        await link(client, story_id, scenes[index]["id"], outer["id"])
    for index in (1, 4):
        await link(client, story_id, scenes[index]["id"], inner["id"])

    result = (await client.get(f"{STORIES}/{story_id}/evaluations/mice_nesting")).json()
    assert result["findings"] == []


async def crossed_story(client: AsyncTestClient) -> tuple[str, dict, dict, list[dict]]:
    story_id = await make_story_with_scenes(client, ["scene"] * 8)
    scenes = sorted(
        (await client.get(f"{STORIES}/{story_id}/scenes")).json(), key=lambda s: s["sort_key"]
    )
    murder = (
        await client.post(
            f"{STORIES}/{story_id}/threads",
            json={"type": "a_story", "title": "Murder", "mice": "idea"},
        )
    ).json()
    island = (
        await client.post(
            f"{STORIES}/{story_id}/threads", json={"type": "b_story", "title": "Island"}
        )
    ).json()
    for index in (0, 5):
        await link(client, story_id, scenes[index]["id"], murder["id"])
    for index in (2, 7):
        await link(client, story_id, scenes[index]["id"], island["id"])
    return story_id, murder, island, scenes


async def test_review_package_submit_and_history(client: AsyncTestClient) -> None:
    story_id, murder, island, scenes = await crossed_story(client)
    base = f"{STORIES}/{story_id}/evaluations/mice_nesting"
    package = (await client.get(f"{base}/package")).json()
    assert package["subject"] == "thread"
    assert {t["title"] for t in package["inputs"]["threads"]} == {"Murder", "Island"}
    assert package["inputs"]["crossings"]

    report = {
        "base_fingerprint": package["base_fingerprint"],
        "summary": "One thread lingers.",
        "verdicts": [
            {"entity_id": murder["id"], "verdict": "works", "evidence": "Answered."},
            {
                "entity_id": island["id"],
                "verdict": "needs_change",
                "evidence": "They never leave.",
                "scene_ids": [scenes[7]["id"]],
                "fixes": ["Leave the island in the last scene."],
            },
        ],
    }
    saved = await client.post(f"{base}/reports", json=report)
    assert saved.status_code == 201, saved.text
    assert saved.json()["stale"] is False

    listed = (await client.get(f"{base}/reports")).json()
    assert [r["summary"] for r in listed] == ["One thread lingers."]

    await client.patch(f"{STORIES}/{story_id}/threads/{island['id']}", json={"mice": "milieu"})
    assert (await client.get(f"{base}/reports")).json()[0]["stale"] is True
    again = await client.post(f"{base}/reports", json=report)
    assert again.status_code == 409, "a report on an old draft is refused"


async def test_review_rejects_bad_reports(client: AsyncTestClient) -> None:
    story_id, murder, _, _ = await crossed_story(client)
    base = f"{STORIES}/{story_id}/evaluations/mice_nesting"
    fingerprint = (await client.get(f"{base}/package")).json()["base_fingerprint"]

    def body(verdict: dict) -> dict:
        return {"base_fingerprint": fingerprint, "summary": "s", "verdicts": [verdict]}

    no_fix = body({"entity_id": murder["id"], "verdict": "needs_change", "evidence": "e"})
    assert (await client.post(f"{base}/reports", json=no_fix)).status_code == 400
    stranger = body({"entity_id": story_id, "verdict": "works", "evidence": "e"})
    assert (await client.post(f"{base}/reports", json=stranger)).status_code == 400
    assert (
        await client.get(f"{STORIES}/{story_id}/evaluations/scene_rhythm/package")
    ).status_code == 404
