"""World-time order, event cast/location, and story isolation."""

from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from storytool.examples.blue_carbuncle import seed_blue_carbuncle


async def test_timeline_uses_world_time_and_keeps_unknown_times_unplaced(
    client: AsyncTestClient,
) -> None:
    story = (await client.post("/api/stories", json={"title": "A nonlinear story"})).json()["id"]
    base = f"/api/stories/{story}"
    person = (await client.post(f"{base}/characters", json={"name": "Maya"})).json()
    location = (await client.post(f"{base}/locations", json={"name": "Harbour"})).json()
    for payload in [
        {"title": "Now", "story_time_ordinal": 50, "sort_key": 1},
        {
            "title": "Before",
            "story_time_ordinal": 0,
            "sort_key": 2,
            "is_flashback": True,
            "pov_character_id": person["id"],
            "location_id": location["id"],
        },
        {"title": "Not placed", "sort_key": 3},
    ]:
        assert (await client.post(f"{base}/scenes", json=payload)).status_code == 201
    event = (
        await client.post(
            f"{base}/events",
            json={
                "label": "A turning point",
                "sort_ordinal": 20,
                "location_id": location["id"],
                "is_turning_point": True,
            },
        )
    ).json()
    for _ in range(2):
        response = await client.put(
            f"{base}/events/{event['id']}/presence/{person['id']}", json={"is_present": True}
        )
        assert response.status_code == 200
    report = (await client.get(f"{base}/timeline")).json()
    assert [entry["ordinal"] for entry in report["entries"]] == [0, 20, 50, None]
    assert report["entries"][0]["is_flashback"] is True
    assert report["entries"][0]["participants"][0]["source"] == "pov"
    important = report["entries"][1]
    assert important["location_name"] == "Harbour"
    assert important["is_on_page"] is False
    assert [person["name"] for person in important["participants"]] == ["Maya"]
    await client.put(
        f"{base}/events/{event['id']}/presence/{person['id']}", json={"is_present": False}
    )
    assert (await client.get(f"{base}/timeline")).json()["entries"][1]["participants"] == []


async def test_manual_scene_presence_can_be_added_removed_and_restored(
    client: AsyncTestClient,
) -> None:
    story = (await client.post("/api/stories", json={"title": "Cast"})).json()["id"]
    base = f"/api/stories/{story}"
    person = (await client.post(f"{base}/characters", json={"name": "Kit"})).json()
    scene = (await client.post(f"{base}/scenes", json={"title": "Meeting"})).json()
    path = f"{base}/scenes/{scene['id']}/presence/{person['id']}"
    for present in [True, True, False, True]:
        response = await client.put(path, json={"is_present": present})
        assert response.status_code == 200
        assert response.json()["source"] == "manual"
        report = (await client.get(f"{base}/timeline")).json()
        assert len(report["entries"][0]["participants"]) == int(present)


async def test_timeline_presence_and_locations_cannot_cross_stories(
    client: AsyncTestClient,
) -> None:
    ids = [
        (await client.post("/api/stories", json={"title": title})).json()["id"]
        for title in ["Mine", "Other"]
    ]
    base, other = [f"/api/stories/{identifier}" for identifier in ids]
    event = (await client.post(f"{base}/events", json={"label": "Mine"})).json()
    scene = (await client.post(f"{other}/scenes", json={"title": "Other"})).json()
    person = (await client.post(f"{other}/characters", json={"name": "Other"})).json()
    location = (await client.post(f"{other}/locations", json={"name": "Other"})).json()
    assert (
        await client.put(
            f"{base}/events/{event['id']}/presence/{person['id']}", json={"is_present": True}
        )
    ).status_code == 404
    assert (
        await client.put(
            f"{base}/scenes/{scene['id']}/presence/{person['id']}", json={"is_present": True}
        )
    ).status_code == 404
    assert (
        await client.patch(f"{base}/events/{event['id']}", json={"location_id": location["id"]})
    ).status_code == 404
    assert len((await client.get(f"{base}/timeline")).json()["entries"]) == 1
    client.cookies.clear()
    assert (await client.get(f"{base}/timeline")).status_code == 401


async def test_blue_carbuncle_keeps_late_revelations_at_their_true_world_time(
    client: AsyncTestClient,
    engine: AsyncEngine,
) -> None:
    from uuid import UUID

    owner_id = UUID((await client.get("/api/auth/me")).json()["id"])
    async with AsyncSession(engine) as session:
        story = await seed_blue_carbuncle(session, owner_id)
        story_id = story.id
        # Re-running the seed must preserve the existing example, not duplicate it.
        assert (await seed_blue_carbuncle(session, owner_id)).id == story_id
        await session.commit()
    response = await client.get(f"/api/stories/{story_id}/timeline")
    assert response.status_code == 200
    events = [entry for entry in response.json()["entries"] if entry["kind"] == "event"]
    assert events[0]["title"] == "Ryder and Cusack steal the jewel"
    assert events[0]["ordinal"] == 10
    assert events[-1]["title"] == "Holmes chooses mercy and lets Ryder go"
    reading_order = sorted(events, key=lambda entry: entry["reading_order"])
    assert reading_order[0]["title"] == "Holmes examines the battered hat"
    assert events[0]["reading_order"] > reading_order[0]["reading_order"]
    assert events[0]["is_flashback"] is True
    assert events[0]["reading_label"].startswith("Chapter 4")
    assert events[0]["location_name"] == "Hotel Cosmopolitan"
    assert {person["name"] for person in events[0]["participants"]} == {
        "James Ryder",
        "Catherine Cusack",
    }
    # Listeners to a confession are not physically in its historical scenes.
    assert "Sherlock Holmes" not in {person["name"] for person in events[0]["participants"]}
    assert all(event["location_name"] and event["participants"] for event in events)
