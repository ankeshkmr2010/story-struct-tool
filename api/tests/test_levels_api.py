"""CRUD and cross-level integration tests for Levels 2-6.

The centrepiece is `test_walking_a_story_up_the_ladder`, which exercises the whole Phase 1
thesis in one pass: each level unlocks only once the level above it carries enough weight,
and nothing is ever refused.
"""

from litestar.testing import AsyncTestClient

STORIES = "/api/stories"


async def new_story(client: AsyncTestClient, **fields: object) -> str:
    response = await client.post(STORIES, json={"title": "The Cartographer", **fields})
    assert response.status_code == 201
    return response.json()["id"]


# ------------------------------------------------------------ events (level 2)


async def test_event_crud_roundtrip(client: AsyncTestClient) -> None:
    story = await new_story(client)
    created = await client.post(
        f"{STORIES}/{story}/events",
        json={"label": "The survey ship arrives", "is_turning_point": True, "sort_ordinal": 10},
    )
    assert created.status_code == 201
    event = created.json()
    assert event["is_turning_point"] is True
    assert event["completeness"]["is_complete"] is True  # label is all an event needs

    patched = await client.patch(
        f"{STORIES}/{story}/events/{event['id']}", json={"display_label": "Third moon of Harvest"}
    )
    assert patched.json()["display_label"] == "Third moon of Harvest"
    assert patched.json()["label"] == "The survey ship arrives", "absent fields untouched"

    assert (await client.delete(f"{STORIES}/{story}/events/{event['id']}")).status_code == 204
    assert (await client.get(f"{STORIES}/{story}/events")).json() == []


async def test_events_are_listed_in_story_world_order(client: AsyncTestClient) -> None:
    story = await new_story(client)
    for label, ordinal in [("Third", 30), ("First", 10), ("Second", 20)]:
        await client.post(
            f"{STORIES}/{story}/events", json={"label": label, "sort_ordinal": ordinal}
        )
    labels = [e["label"] for e in (await client.get(f"{STORIES}/{story}/events")).json()]
    assert labels == ["First", "Second", "Third"]


# -------------------------------------------------------- characters (level 3)


async def test_character_with_only_a_name_is_an_incomplete_placeholder(
    client: AsyncTestClient,
) -> None:
    story = await new_story(client)
    created = await client.post(f"{STORIES}/{story}/characters", json={"name": "Maya"})
    assert created.status_code == 201
    completeness = created.json()["completeness"]
    assert completeness["is_complete"] is False
    assert set(completeness["missing"]) == {"role", "want", "need"}


async def test_character_completes_when_role_want_and_need_are_set(
    client: AsyncTestClient,
) -> None:
    story = await new_story(client)
    character = (
        await client.post(
            f"{STORIES}/{story}/characters",
            json={
                "name": "Maya",
                "role": "protagonist",
                "want": "To redraw the coastline",
                "need": "To accept she cannot control the sea",
            },
        )
    ).json()
    assert character["completeness"]["is_complete"] is True


# ---------------------------------------------------- acts and beats (4 and 5)


async def test_beat_can_exist_before_it_has_an_act(client: AsyncTestClient) -> None:
    """The "nothing is created cold" rule cuts both ways: a beat captured in the shower
    should not be refused for lacking an act."""
    story = await new_story(client)
    created = await client.post(f"{STORIES}/{story}/beats", json={"label": "She burns the maps"})
    assert created.status_code == 201
    assert created.json()["act_id"] is None

    health = (await client.get(f"{STORIES}/{story}/health")).json()
    assert "beat.unassigned_to_act" in {f["code"] for f in health["findings"]}


async def test_assigning_a_beat_to_an_act_clears_the_finding(client: AsyncTestClient) -> None:
    story = await new_story(client)
    act = (await client.post(f"{STORIES}/{story}/acts", json={"number": 1})).json()
    beat = (
        await client.post(f"{STORIES}/{story}/beats", json={"label": "She burns the maps"})
    ).json()

    await client.patch(f"{STORIES}/{story}/beats/{beat['id']}", json={"act_id": act["id"]})
    health = (await client.get(f"{STORIES}/{story}/health")).json()
    assert "beat.unassigned_to_act" not in {f["code"] for f in health["findings"]}


async def test_act_emotional_shift_is_two_queryable_fields(client: AsyncTestClient) -> None:
    story = await new_story(client)
    act = (
        await client.post(
            f"{STORIES}/{story}/acts",
            json={
                "number": 2,
                "title": "Confrontation",
                "summary": "The coastline refuses to hold.",
                "emotional_shift_from": "hope",
                "emotional_shift_to": "doubt",
            },
        )
    ).json()
    assert (act["emotional_shift_from"], act["emotional_shift_to"]) == ("hope", "doubt")
    assert act["completeness"]["is_complete"] is True


# ------------------------------------------------------------ threads (level 6)


async def test_thread_crud_and_a_story_uniqueness_finding(client: AsyncTestClient) -> None:
    story = await new_story(client)
    for title in ("Spine", "Also spine?"):
        created = await client.post(
            f"{STORIES}/{story}/threads", json={"type": "a_story", "title": title}
        )
        assert created.status_code == 201

    health = (await client.get(f"{STORIES}/{story}/health")).json()
    assert "thread.multiple_a_stories" in {f["code"] for f in health["findings"]}


# ------------------------------------------------------- arcs and arc stages


async def test_arc_requires_exactly_one_owner(client: AsyncTestClient) -> None:
    story = await new_story(client)
    character = (await client.post(f"{STORIES}/{story}/characters", json={"name": "Maya"})).json()

    assert (await client.post(f"{STORIES}/{story}/arcs", json={})).status_code == 400
    two_owners = await client.post(
        f"{STORIES}/{story}/arcs",
        json={"character_id": character["id"], "thread_id": character["id"]},
    )
    assert two_owners.status_code == 400

    ok = await client.post(f"{STORIES}/{story}/arcs", json={"character_id": character["id"]})
    assert ok.status_code == 201


async def test_arc_stages_order_and_drive_the_change_finding(client: AsyncTestClient) -> None:
    story = await new_story(client)
    character = (await client.post(f"{STORIES}/{story}/characters", json={"name": "Maya"})).json()
    arc = (
        await client.post(
            f"{STORIES}/{story}/arcs",
            json={"character_id": character["id"], "resolution": "She lets go."},
        )
    ).json()

    # One stage describes no change.
    await client.post(f"/api/arcs/{arc['id']}/stages", json={"label": "Denial", "sort_key": 1})
    codes = {f["code"] for f in (await client.get(f"{STORIES}/{story}/health")).json()["findings"]}
    assert "arc.too_few_stages" in codes

    await client.post(f"/api/arcs/{arc['id']}/stages", json={"label": "Acceptance", "sort_key": 2})
    codes = {f["code"] for f in (await client.get(f"{STORIES}/{story}/health")).json()["findings"]}
    assert "arc.too_few_stages" not in codes

    stages = (await client.get(f"/api/arcs/{arc['id']}/stages")).json()
    assert [s["label"] for s in stages] == ["Denial", "Acceptance"]


async def test_relationship_requires_two_distinct_characters(client: AsyncTestClient) -> None:
    story = await new_story(client)
    maya = (await client.post(f"{STORIES}/{story}/characters", json={"name": "Maya"})).json()
    kit = (await client.post(f"{STORIES}/{story}/characters", json={"name": "Kit"})).json()

    same = await client.post(
        f"{STORIES}/{story}/relationships",
        json={"character_a_id": maya["id"], "character_b_id": maya["id"]},
    )
    assert same.status_code == 400, "should be caught at the DTO, not as a 500 from Postgres"

    ok = await client.post(
        f"{STORIES}/{story}/relationships",
        json={"character_a_id": maya["id"], "character_b_id": kit["id"]},
    )
    assert ok.status_code == 201


# ------------------------------------------------------------ story scoping


async def test_entities_are_scoped_to_their_story(client: AsyncTestClient) -> None:
    """Addressing story A's path with story B's entity id must 404, not leak the row."""
    story_a = await new_story(client, title="Story A")
    story_b = await new_story(client, title="Story B")

    beat = (await client.post(f"{STORIES}/{story_b}/beats", json={"label": "B's beat"})).json()

    assert (await client.get(f"{STORIES}/{story_a}/beats/{beat['id']}")).status_code == 404
    assert (
        await client.patch(f"{STORIES}/{story_a}/beats/{beat['id']}", json={"label": "hijack"})
    ).status_code == 404
    assert (await client.delete(f"{STORIES}/{story_a}/beats/{beat['id']}")).status_code == 404
    # And it is untouched in its own story.
    assert (await client.get(f"{STORIES}/{story_b}/beats/{beat['id']}")).json()[
        "label"
    ] == "B's beat"


async def test_listing_one_story_never_includes_another(client: AsyncTestClient) -> None:
    story_a = await new_story(client, title="Story A")
    story_b = await new_story(client, title="Story B")
    await client.post(f"{STORIES}/{story_a}/characters", json={"name": "Maya"})
    await client.post(f"{STORIES}/{story_b}/characters", json={"name": "Kit"})

    names_a = [c["name"] for c in (await client.get(f"{STORIES}/{story_a}/characters")).json()]
    assert names_a == ["Maya"]


# ------------------------------------------------------------- the full walk


async def test_walking_a_story_up_the_ladder(client: AsyncTestClient) -> None:
    """Phase 1 end to end: each level unlocks only when the one above it carries weight."""

    async def furthest() -> int:
        return (await client.get(f"{STORIES}/{story}/ladder")).json()["furthest_ready_level"]

    # Level 1 -- a title alone. Nothing above it is open.
    story = await new_story(client)
    assert await furthest() == 1

    # Level 1 complete: write the premise.
    await client.patch(f"{STORIES}/{story}", json={"premise": "Her maps rewrite the territory."})
    assert await furthest() == 2, "a premise opens the arc skeleton"

    # Level 2: three turning points.
    for index, label in enumerate(["Ship arrives", "Coast moves", "She burns the maps"]):
        await client.post(
            f"{STORIES}/{story}/events",
            json={"label": label, "is_turning_point": True, "sort_ordinal": index * 10},
        )
    assert await furthest() == 3, "three turning points open the cast"

    # Level 3: a protagonist with the want/need gap.
    await client.post(
        f"{STORIES}/{story}/characters",
        json={
            "name": "Maya",
            "role": "protagonist",
            "want": "To redraw the coastline",
            "need": "To accept she cannot control the sea",
        },
    )
    assert await furthest() == 4, "a complete protagonist opens the acts"

    # Levels 4 and 5 in one move: seed the framework.
    scaffold = (await client.post(f"{STORIES}/{story}/scaffold")).json()
    assert (scaffold["acts_created"], scaffold["beats_created"]) == (3, 7)
    assert await furthest() == 6, "acts and beats open the threads"

    # Level 6: a spine.
    await client.post(
        f"{STORIES}/{story}/threads", json={"type": "a_story", "title": "The coastline"}
    )
    assert await furthest() == 7, "a thread opens chapters -- the Phase 2 boundary"

    # Levels 7-8 stay shut: chapters do not exist yet.
    ladder = (await client.get(f"{STORIES}/{story}/ladder")).json()
    assert ladder["levels"][7]["is_ready"] is False
    assert ladder["levels"][7]["blocked_by"] == ["No chapters exist yet."]

    # Health is now about meaning the author still owes, not missing scaffolding.
    health = (await client.get(f"{STORIES}/{story}/health?max_level=6")).json()
    codes = {f["code"] for f in health["findings"]}
    assert "story.no_premise" not in codes
    assert "arc.too_few_turning_points" not in codes
    assert "character.no_protagonist" not in codes
    assert "act.no_emotional_shift" in codes, "framework seeds structure, not meaning"


async def test_nothing_in_the_walk_was_ever_refused(client: AsyncTestClient) -> None:
    """The inverse of the ladder: build bottom-up in the worst possible order and have
    every single write accepted. This is Pantser mode's guarantee."""
    story = await new_story(client)

    # Level 6 before level 2, level 5 before level 4 -- all legal.
    assert (
        await client.post(f"{STORIES}/{story}/threads", json={"type": "c_story"})
    ).status_code == 201
    assert (
        await client.post(f"{STORIES}/{story}/beats", json={"label": "Orphan beat"})
    ).status_code == 201
    assert (
        await client.post(f"{STORIES}/{story}/characters", json={"name": "Nameless"})
    ).status_code == 201

    # Readiness still honestly reports level 2 as shut.
    ladder = (await client.get(f"{STORIES}/{story}/ladder")).json()
    assert ladder["furthest_ready_level"] == 1
    assert ladder["snapshot"]["beat_count"] == 1
