from tests.test_sharing import source_story


async def test_scene_delete_forces_versions_and_restores_prose_notes_and_links(client):
    sid = await source_story(client)
    base = "/api/stories/" + sid
    scene = (await client.get(base + "/scenes")).json()[0]
    before = (await client.get(base + "/versions")).json()
    events_before = (await client.get(base + "/events")).json()
    response = await client.delete(base + "/scenes/" + scene["id"])
    assert response.status_code == 204
    assert (await client.get(base + "/scenes")).json() == []
    events_after = (await client.get(base + "/events")).json()
    assert len(events_after) == len(events_before)
    assert all(event["scene_id"] is None for event in events_after)
    versions = (await client.get(base + "/versions")).json()
    assert len(versions) >= len(before) + 2
    recovery = next(v for v in versions if v["label"].startswith("Before deleting scene:"))
    assert recovery["source"] == "recovery"
    assert versions[0]["label"].startswith("After deleting scene:")
    preview = (await client.get(base + f"/versions/{recovery['id']}/preview")).json()
    restored = await client.post(
        base + f"/versions/{recovery['id']}/restore",
        json={"expected_fingerprint": preview["current_fingerprint"]},
    )
    assert restored.status_code == 201, restored.text
    assert (await client.get(base + f"/scenes/{scene['id']}/content")).json()[
        "content"
    ] == "Maya waits."
    assert len((await client.get(base + f"/scenes/{scene['id']}/annotations")).json()) == 1
    assert (await client.get(base + "/events")).json()[0]["scene_id"] == scene["id"]


async def test_failed_delete_checkpoint_rolls_back_scene_and_recovery_version(client, monkeypatch):
    sid = await source_story(client)
    base = "/api/stories/" + sid
    scene = (await client.get(base + "/scenes")).json()[0]
    before = (await client.get(base + "/versions")).json()

    async def fail(*args, **kwargs):
        raise RuntimeError("Injected deletion checkpoint failure")

    monkeypatch.setattr("storytool.domain.versioning.service.automatic_checkpoint", fail)
    response = await client.delete(base + "/scenes/" + scene["id"])
    assert response.status_code == 500
    assert (await client.get(base + f"/scenes/{scene['id']}/content")).json()[
        "content"
    ] == "Maya waits."
    assert len((await client.get(base + "/versions")).json()) == len(before)
