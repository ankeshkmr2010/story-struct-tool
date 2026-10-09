from tests.test_mcp_library import connection
from tests.test_sharing import reader_headers, source_story


async def test_owned_reader_and_activity_permissions_and_child_changes(client, engine):
    sid = await source_story(client)
    base = "/api/stories/" + sid
    reader = await reader_headers(engine)
    own = await client.get(base + "/reader")
    assert own.status_code == 200
    assert "Maya waits." in own.json()["manuscript"]
    assert not own.json()["share"]["allow_import"]
    assert "Private note" not in own.text
    assert (await client.get(base + "/reader", headers=reader)).status_code == 404
    assert (await client.get(base + "/activity", headers=reader)).status_code == 404
    initial = (await client.get(base + "/activity")).json()["change_token"]
    assert len(initial) == 64
    scene = (await client.get(base + "/scenes")).json()[0]
    await client.put(base + f"/scenes/{scene['id']}/content", json={"content": "Maya speaks."})
    after = (await client.get(base + "/activity")).json()["change_token"]
    assert after != initial
    assert (await client.get(base + "/activity")).json()["change_token"] == after
    failed = await client.put(
        base + f"/scenes/{scene['id']}/content",
        json={"content": "Stale", "expected_content": "Wrong base"},
    )
    assert failed.status_code == 409
    assert (await client.get(base + "/activity")).json()["change_token"] == after
    await client.put(base + "/shares", json={"recipient_email": "reader@example.com"})
    shared = await client.get(f"/api/shared-stories/{sid}/activity", headers=reader)
    assert shared.status_code == 200
    assert "Maya" not in shared.text
    grant = (await client.get(base + "/shares")).json()[0]
    await client.delete(base + "/shares/" + grant["id"])
    assert (
        await client.get(f"/api/shared-stories/{sid}/activity", headers=reader)
    ).status_code == 404


async def test_order_is_consistent_for_ties_explicit_keys_moves_and_export(client):
    sid = (await client.post("/api/stories", json={"title": "Ordering"})).json()["id"]
    base = "/api/stories/" + sid
    ids = {}
    for number in [3, 1, 2]:
        chapter = (
            await client.post(
                base + "/chapters", json={"number": number, "title": f"Chapter {number}"}
            )
        ).json()
        ids[number] = chapter["id"]
        for key in [20, 10]:
            scene = (
                await client.post(
                    base + "/scenes",
                    json={
                        "title": f"Passage {number}-{key}",
                        "chapter_id": chapter["id"],
                        "sort_key": key,
                    },
                )
            ).json()
            await client.put(
                base + f"/scenes/{scene['id']}/content", json={"content": scene["title"]}
            )
    assert [c["number"] for c in (await client.get(base + "/chapters")).json()] == [1, 2, 3]
    assert [s["title"] for s in (await client.get(base + "/scenes")).json()] == [
        f"Passage {number}-{key}" for number in [1, 2, 3] for key in [10, 20]
    ]
    document = (await client.get(base + "/reader")).json()["manuscript"]
    assert (
        document.index("Passage 1-10")
        < document.index("Passage 2-10")
        < document.index("Passage 3-10")
    )
    move = await client.post(base + f"/chapters/{ids[3]}/move", json={"before_chapter_id": ids[2]})
    assert move.status_code == 201
    assert [c["number"] for c in (await client.get(base + "/chapters")).json()] == [1, 3, 2]
    document = (await client.get(base + "/reader")).json()["manuscript"]
    assert (
        document.index("Passage 1-10")
        < document.index("Passage 3-10")
        < document.index("Passage 2-10")
    )


async def test_activity_is_metadata_but_owned_reader_requires_prose_scope(client):
    sid = (await client.post("/api/stories", json={"title": "Protected manuscript"})).json()["id"]
    token = await connection(client, ["story:read", "library:read"])
    headers = {"Authorization": "Bearer " + token}
    assert (await client.get(f"/api/stories/{sid}/activity", headers=headers)).status_code == 200
    assert (await client.get(f"/api/stories/{sid}/reader", headers=headers)).status_code == 403
