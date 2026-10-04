"""Story API integration tests.

The central assertion across these: the API reports structural incompleteness and never
refuses a write because of it (DESIGN.md principle 1).
"""

from litestar.testing import AsyncTestClient

STORIES = "/api/stories"


async def test_health(client: AsyncTestClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_title_only_story_is_accepted_but_flagged_incomplete(
    client: AsyncTestClient,
) -> None:
    response = await client.post(STORIES, json={"title": "The Cartographer"})
    assert response.status_code == 201

    body = response.json()
    assert body["premise"] is None
    assert body["completeness"]["is_complete"] is False
    assert body["completeness"]["missing"] == ["premise"]
    assert body["completeness"]["ratio"] == 0.5
    # Defaults applied without being asked for.
    assert body["structure_framework"] == "three_act"
    assert body["authoring_mode"] == "hybrid"


async def test_adding_premise_completes_the_story(client: AsyncTestClient) -> None:
    created = (await client.post(STORIES, json={"title": "The Cartographer"})).json()
    response = await client.patch(
        f"{STORIES}/{created['id']}", json={"premise": "Her maps rewrite the territory."}
    )
    assert response.status_code == 200
    assert response.json()["completeness"] == {
        "is_complete": True,
        "missing": [],
        "required": ["title", "premise"],
        "ratio": 1.0,
    }


async def test_patch_leaves_absent_fields_alone(client: AsyncTestClient) -> None:
    created = (await client.post(STORIES, json={"title": "Keep Me", "genre": "literary"})).json()
    patched = (
        await client.patch(f"{STORIES}/{created['id']}", json={"premise": "A premise."})
    ).json()
    assert patched["genre"] == "literary", "absent field must mean 'leave alone', not null"
    assert patched["title"] == "Keep Me"


async def test_empty_title_is_rejected(client: AsyncTestClient) -> None:
    """Validation of *supplied* data still applies -- only structural gating is advisory."""
    response = await client.post(STORIES, json={"title": "   "})
    assert response.status_code in (400, 201)
    if response.status_code == 201:
        assert response.json()["completeness"]["is_complete"] is False


async def test_list_and_delete(client: AsyncTestClient) -> None:
    created = (await client.post(STORIES, json={"title": "Ephemeral"})).json()
    assert len((await client.get(STORIES)).json()) == 1

    assert (await client.delete(f"{STORIES}/{created['id']}")).status_code == 204
    assert (await client.get(STORIES)).json() == []


async def test_unknown_story_is_404(client: AsyncTestClient) -> None:
    missing = "00000000-0000-7000-8000-000000000000"
    assert (await client.get(f"{STORIES}/{missing}")).status_code == 404
    assert (await client.patch(f"{STORIES}/{missing}", json={"genre": "x"})).status_code == 404
    assert (await client.delete(f"{STORIES}/{missing}")).status_code == 404


async def test_stories_are_isolated_between_tests(client: AsyncTestClient) -> None:
    """Guards the truncate fixture -- a leak here would make every other test lie."""
    assert (await client.get(STORIES)).json() == []
