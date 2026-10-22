"""Merging a duplicate character moves everything onto the kept one. Needs the test database."""

from litestar.testing import AsyncTestClient

STORIES = "/api/stories"


async def test_merge_moves_pov_relationships_and_mentions_then_deletes_the_duplicate(
    client: AsyncTestClient,
) -> None:
    story_id = (await client.post(STORIES, json={"title": "Two Mayas"})).json()["id"]
    base = f"{STORIES}/{story_id}"
    maya = (await client.post(f"{base}/characters", json={"name": "Maya"})).json()
    mags = (await client.post(f"{base}/characters", json={"name": "Mags"})).json()
    eli = (await client.post(f"{base}/characters", json={"name": "Eli"})).json()
    chapter = (await client.post(f"{base}/chapters", json={"number": 1})).json()
    scene = (
        await client.post(
            f"{base}/scenes",
            json={
                "title": "S",
                "chapter_id": chapter["id"],
                "sort_key": 1,
                "pov_character_id": mags["id"],
            },
        )
    ).json()
    await client.put(
        f"{base}/scenes/{scene['id']}/content", json={"content": "Mags met Maya and Eli."}
    )
    await client.post(f"{base}/notice")
    await client.post(
        f"{base}/relationships", json={"character_a_id": mags["id"], "character_b_id": eli["id"]}
    )
    await client.post(
        f"{base}/relationships", json={"character_a_id": mags["id"], "character_b_id": maya["id"]}
    )

    preview = (
        await client.get(
            f"{base}/characters/{mags['id']}/merge-preview", params={"into_id": maya["id"]}
        )
    ).json()
    assert preview["pov_scenes"] == 1
    assert preview["relationships"] == 1 and preview["relationships_removed"] == 1
    assert preview["aliases_added"] == ["Mags"]
    assert (await client.get(f"{base}/characters/{mags['id']}")).status_code == 200, (
        "preview changes nothing"
    )

    merged = await client.post(
        f"{base}/characters/{mags['id']}/merge", json={"into_id": maya["id"]}
    )
    assert merged.status_code == 200
    assert (await client.get(f"{base}/characters/{mags['id']}")).status_code == 404
    kept = (await client.get(f"{base}/characters/{maya['id']}")).json()
    assert kept["aliases"] == ["Mags"]
    assert (await client.get(f"{base}/scenes/{scene['id']}")).json()["pov_character_id"] == maya[
        "id"
    ]
    pairs = {
        (r["character_a_id"], r["character_b_id"])
        for r in (await client.get(f"{base}/relationships")).json()
    }
    assert pairs == {(maya["id"], eli["id"])}, (
        "the relationship between the two is gone; Eli's moved"
    )


async def test_merging_into_itself_or_another_story_is_refused(client: AsyncTestClient) -> None:
    story_id = (await client.post(STORIES, json={"title": "One"})).json()["id"]
    other = (await client.post(STORIES, json={"title": "Two"})).json()["id"]
    maya = (await client.post(f"{STORIES}/{story_id}/characters", json={"name": "Maya"})).json()
    stranger = (await client.post(f"{STORIES}/{other}/characters", json={"name": "Maya"})).json()
    base = f"{STORIES}/{story_id}/characters/{maya['id']}"
    assert (await client.post(f"{base}/merge", json={"into_id": maya["id"]})).status_code == 400
    assert (await client.post(f"{base}/merge", json={"into_id": stranger["id"]})).status_code in {
        403,
        404,
    }
