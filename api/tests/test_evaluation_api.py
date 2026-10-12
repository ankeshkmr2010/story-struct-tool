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
