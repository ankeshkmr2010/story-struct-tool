"""Phase 2: chapters, scenes, fulfilment edges, and the Chapter Context Brief.

The claim under test is that the brief is *derived*, never entered: a chapter the author
has typed nothing into still opens with its act, the beats it owes and its inherited
emotional shift.
"""

from litestar.testing import AsyncTestClient

STORIES = "/api/stories"


async def scaffolded_story(client: AsyncTestClient) -> dict:
    """A story walked up through Level 6, which is where Phase 2 begins."""
    story_id = (
        await client.post(
            STORIES,
            json={"title": "The Cartographer", "premise": "Her maps rewrite the territory."},
        )
    ).json()["id"]

    for label in ("Ship arrives", "Coast moves", "She burns the maps"):
        await client.post(
            f"{STORIES}/{story_id}/events", json={"label": label, "is_turning_point": True}
        )

    maya = (
        await client.post(
            f"{STORIES}/{story_id}/characters",
            json={
                "name": "Maya",
                "role": "protagonist",
                "want": "To redraw the coastline",
                "need": "To accept she cannot control the sea",
            },
        )
    ).json()

    await client.post(f"{STORIES}/{story_id}/scaffold")
    acts = (await client.get(f"{STORIES}/{story_id}/acts")).json()
    beats = (await client.get(f"{STORIES}/{story_id}/beats")).json()

    # Give act 2 a real emotional shift so inheritance has something to inherit.
    act_two = next(a for a in acts if a["number"] == 2)
    await client.patch(
        f"{STORIES}/{story_id}/acts/{act_two['id']}",
        json={"emotional_shift_from": "hope", "emotional_shift_to": "despair"},
    )

    thread = (
        await client.post(
            f"{STORIES}/{story_id}/threads", json={"type": "a_story", "title": "The coastline"}
        )
    ).json()

    return {
        "story_id": story_id,
        "maya": maya,
        "acts": acts,
        "act_two": act_two,
        "beats": beats,
        "thread": thread,
    }


# -------------------------------------------------------------- chapters


async def test_chapter_with_nothing_filled_in_is_a_legal_placeholder(
    client: AsyncTestClient,
) -> None:
    setup = await scaffolded_story(client)
    created = await client.post(f"{STORIES}/{setup['story_id']}/chapters", json={"number": 7})
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "placeholder"
    assert body["completeness"]["is_complete"] is False
    assert set(body["completeness"]["missing"]) == {"title", "summary", "pov_character_id"}


async def test_brand_new_chapter_still_opens_with_a_brief(client: AsyncTestClient) -> None:
    """The core promise: nothing is created cold. The author typed only an act link and a
    number, yet the brief already knows the act, the beats owed and the emotional shift."""
    setup = await scaffolded_story(client)
    story_id, act_two = setup["story_id"], setup["act_two"]

    chapter = (
        await client.post(
            f"{STORIES}/{story_id}/chapters", json={"number": 7, "act_id": act_two["id"]}
        )
    ).json()

    # Declare what this chapter owes -- the one upward reference the author makes.
    all_is_lost = next(b for b in setup["beats"] if b["label"] == "All Is Lost")
    await client.post(
        f"{STORIES}/{story_id}/chapters/{chapter['id']}/beats",
        json={"beat_id": all_is_lost["id"]},
    )

    brief = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()

    assert brief["number"] == 7
    assert brief["act_number"] == 2
    assert brief["act_title"] == "Confrontation"
    assert [b["label"] for b in brief["beats"]] == ["All Is Lost"]
    assert brief["emotional_shift_from"] == "hope"
    assert brief["emotional_shift_to"] == "despair"
    assert brief["emotional_shift_inherited"] is True, "shift came from the act, not the chapter"
    assert brief["scenes"] == []
    assert brief["title"] is None, "the brief is informative even with no title"


async def test_chapter_shift_overrides_the_inherited_one(client: AsyncTestClient) -> None:
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]
    chapter = (
        await client.post(
            f"{STORIES}/{story_id}/chapters",
            json={
                "number": 7,
                "act_id": setup["act_two"]["id"],
                "emotional_shift_from": "resolve",
                "emotional_shift_to": "grief",
            },
        )
    ).json()

    brief = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()
    assert (brief["emotional_shift_from"], brief["emotional_shift_to"]) == ("resolve", "grief")
    assert brief["emotional_shift_inherited"] is False


# ------------------------------------------------- derived beat fulfilment


async def test_beat_fulfilment_is_derived_from_either_join(client: AsyncTestClient) -> None:
    """`is_fulfilled` is stored nowhere. A chapter link and a scene link both satisfy it."""
    setup = await scaffolded_story(client)
    story_id, beats = setup["story_id"], setup["beats"]
    midpoint = next(b for b in beats if b["label"] == "Midpoint")
    climax = next(b for b in beats if b["label"] == "Climax")

    def unfulfilled(health: dict) -> set[str]:
        return {f["message"] for f in health["findings"] if f["code"] == "beat.unfulfilled"}

    health = (await client.get(f"{STORIES}/{story_id}/health?max_level=7")).json()
    assert len(unfulfilled(health)) == 7, "all seeded beats start unfulfilled"

    # Satisfy one via a chapter.
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()
    await client.post(
        f"{STORIES}/{story_id}/chapters/{chapter['id']}/beats", json={"beat_id": midpoint["id"]}
    )

    # Satisfy another via a scene.
    scene = (
        await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "The burning"})
    ).json()
    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene['id']}/beats", json={"beat_id": climax["id"]}
    )

    health = (await client.get(f"{STORIES}/{story_id}/health?max_level=7")).json()
    assert len(unfulfilled(health)) == 5


async def test_unlinking_a_beat_makes_it_unfulfilled_again(client: AsyncTestClient) -> None:
    """Nothing is cached, so withdrawing a fulfilment is immediately visible."""
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]
    beat = setup["beats"][0]
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()

    await client.post(
        f"{STORIES}/{story_id}/chapters/{chapter['id']}/beats", json={"beat_id": beat["id"]}
    )
    brief = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()
    assert brief["beats"][0]["is_fulfilled"] is True

    await client.delete(f"{STORIES}/{story_id}/chapters/{chapter['id']}/beats/{beat['id']}")
    brief = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()
    assert brief["beats"] == []


async def test_linking_the_same_beat_twice_is_idempotent(client: AsyncTestClient) -> None:
    """Fulfilment is a statement of fact, not an event."""
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]
    beat = setup["beats"][0]
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()
    url = f"{STORIES}/{story_id}/chapters/{chapter['id']}/beats"

    first = await client.post(url, json={"beat_id": beat["id"]})
    second = await client.post(url, json={"beat_id": beat["id"]})
    assert first.status_code == second.status_code == 201
    assert second.json()["beat_ids"] == [beat["id"]]


# -------------------------------------------- threads and arcs via scenes


async def test_brief_derives_threads_and_arcs_from_its_scenes(client: AsyncTestClient) -> None:
    """The brief's "Maya (denial -> acceptance)" line, built by traversal:
    chapter -> scenes -> arc stages -> arc -> character."""
    setup = await scaffolded_story(client)
    story_id, maya, thread = setup["story_id"], setup["maya"], setup["thread"]

    arc = (
        await client.post(
            f"{STORIES}/{story_id}/arcs",
            json={"character_id": maya["id"], "resolution": "She lets the coast move."},
        )
    ).json()
    denial = (
        await client.post(f"/api/arcs/{arc['id']}/stages", json={"label": "denial", "sort_key": 1})
    ).json()
    acceptance = (
        await client.post(
            f"/api/arcs/{arc['id']}/stages", json={"label": "acceptance", "sort_key": 2}
        )
    ).json()

    chapter = (
        await client.post(
            f"{STORIES}/{story_id}/chapters",
            json={"number": 7, "act_id": setup["act_two"]["id"]},
        )
    ).json()

    for index, stage in enumerate([denial, acceptance], start=1):
        scene = (
            await client.post(
                f"{STORIES}/{story_id}/scenes",
                json={"title": f"Scene {index}", "chapter_id": chapter["id"], "sort_key": index},
            )
        ).json()
        await client.post(
            f"{STORIES}/{story_id}/scenes/{scene['id']}/arc-stages",
            json={"arc_stage_id": stage["id"]},
        )
        await client.post(
            f"{STORIES}/{story_id}/scenes/{scene['id']}/threads",
            json={"thread_id": thread["id"], "is_primary": True},
        )

    brief = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()

    assert brief["threads"] == ["The coastline"]
    assert len(brief["arcs_advancing"]) == 1
    advance = brief["arcs_advancing"][0]
    assert advance["owner_name"] == "Maya"
    assert (advance["from_stage"], advance["to_stage"]) == ("denial", "acceptance")
    assert advance["summary"] == "Maya (denial -> acceptance)"
    assert len(brief["scenes"]) == 2
    assert brief["placeholder_scene_count"] == 2, "scenes lack goal/conflict/outcome"


async def test_scene_can_advance_two_threads_at_once(client: AsyncTestClient) -> None:
    """Why scene_thread is many-to-many: good scenes carry A- and B-story together."""
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]
    b_story = (
        await client.post(
            f"{STORIES}/{story_id}/threads", json={"type": "b_story", "title": "The brother"}
        )
    ).json()

    scene = (await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "Both"})).json()
    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene['id']}/threads",
        json={"thread_id": setup["thread"]["id"], "is_primary": True},
    )
    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene['id']}/threads",
        json={"thread_id": b_story["id"]},
    )

    links = (await client.get(f"{STORIES}/{story_id}/scenes/{scene['id']}/links")).json()
    assert len(links["thread_ids"]) == 2
    assert links["thread_ids"][0] == setup["thread"]["id"], "primary thread sorts first"


async def test_relinking_a_thread_flips_primary(client: AsyncTestClient) -> None:
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]
    scene = (await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "S"})).json()
    url = f"{STORIES}/{story_id}/scenes/{scene['id']}/threads"

    await client.post(url, json={"thread_id": setup["thread"]["id"], "is_primary": False})
    await client.post(url, json={"thread_id": setup["thread"]["id"], "is_primary": True})
    links = (await client.get(f"{STORIES}/{story_id}/scenes/{scene['id']}/links")).json()
    assert len(links["thread_ids"]) == 1, "upsert, not duplicate"


# -------------------------------------------------- the brief's own rules


async def test_arc_not_advanced_fires_then_clears(client: AsyncTestClient) -> None:
    """The brief document's example: "Character X has an arc defined but no scenes
    advancing it" -- answerable only because of the scene_arc_advance edge."""
    setup = await scaffolded_story(client)
    story_id, maya = setup["story_id"], setup["maya"]

    arc = (
        await client.post(
            f"{STORIES}/{story_id}/arcs",
            json={"character_id": maya["id"], "resolution": "Lets go."},
        )
    ).json()
    stage = (await client.post(f"/api/arcs/{arc['id']}/stages", json={"label": "denial"})).json()
    await client.post(f"/api/arcs/{arc['id']}/stages", json={"label": "acceptance"})

    health = (await client.get(f"{STORIES}/{story_id}/health")).json()
    arc_findings = [f for f in health["findings"] if f["code"] == "arc.not_advanced"]
    assert len(arc_findings) == 1
    assert "Maya has an arc defined but no scenes advancing it" in arc_findings[0]["message"]

    scene = (await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "S"})).json()
    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene['id']}/arc-stages",
        json={"arc_stage_id": stage["id"]},
    )

    health = (await client.get(f"{STORIES}/{story_id}/health")).json()
    assert "arc.not_advanced" not in {f["code"] for f in health["findings"]}


async def test_thread_absent_from_act_is_reported(client: AsyncTestClient) -> None:
    """The brief document's "Thread B has no scenes in Act 3"."""
    setup = await scaffolded_story(client)
    story_id, thread = setup["story_id"], setup["thread"]

    chapter = (
        await client.post(
            f"{STORIES}/{story_id}/chapters", json={"number": 1, "act_id": setup["acts"][0]["id"]}
        )
    ).json()
    scene = (
        await client.post(
            f"{STORIES}/{story_id}/scenes",
            json={"title": "Act 1 only", "chapter_id": chapter["id"]},
        )
    ).json()
    await client.post(
        f"{STORIES}/{story_id}/scenes/{scene['id']}/threads", json={"thread_id": thread["id"]}
    )

    health = (await client.get(f"{STORIES}/{story_id}/health")).json()
    absent = [f for f in health["findings"] if f["code"] == "thread.absent_from_act"]
    assert len(absent) == 2, "present in act 1, missing from acts 2 and 3"
    assert 'Thread "The coastline" has no scenes in Act 2.' in {f["message"] for f in absent}


async def test_level_7_rules_stay_silent_below_level_7(client: AsyncTestClient) -> None:
    """The scoping guarantee, now that there is something above level 6 to hide."""
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]

    at_six = (await client.get(f"{STORIES}/{story_id}/health?max_level=6")).json()
    at_seven = (await client.get(f"{STORIES}/{story_id}/health?max_level=7")).json()

    assert "beat.unfulfilled" not in {f["code"] for f in at_six["findings"]}
    assert "beat.unfulfilled" in {f["code"] for f in at_seven["findings"]}


# ---------------------------------------------------------- pantser paths


async def test_scene_can_exist_with_no_chapter(client: AsyncTestClient) -> None:
    """How Pantser mode starts: write the scene, place it later."""
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]
    scene = await client.post(
        f"{STORIES}/{story_id}/scenes", json={"title": "A scene from nowhere"}
    )
    assert scene.status_code == 201
    assert scene.json()["chapter_id"] is None

    health = (await client.get(f"{STORIES}/{story_id}/health")).json()
    assert "scene.not_in_chapter" in {f["code"] for f in health["findings"]}


async def test_scene_completeness_needs_goal_conflict_outcome(client: AsyncTestClient) -> None:
    setup = await scaffolded_story(client)
    story_id, maya = setup["story_id"], setup["maya"]

    scene = (await client.post(f"{STORIES}/{story_id}/scenes", json={"title": "Bare"})).json()
    assert set(scene["completeness"]["missing"]) == {
        "goal",
        "conflict",
        "outcome",
        "pov_character_id",
    }

    filled = (
        await client.patch(
            f"{STORIES}/{story_id}/scenes/{scene['id']}",
            json={
                "goal": "Reach the lighthouse",
                "conflict": "The causeway is gone",
                "outcome": "She turns back changed",
                "pov_character_id": maya["id"],
            },
        )
    ).json()
    assert filled["completeness"]["is_complete"] is True


async def test_chapters_and_scenes_are_story_scoped(client: AsyncTestClient) -> None:
    setup_a = await scaffolded_story(client)
    story_b = (await client.post(STORIES, json={"title": "Story B"})).json()["id"]

    chapter = (
        await client.post(f"{STORIES}/{setup_a['story_id']}/chapters", json={"number": 1})
    ).json()

    assert (await client.get(f"{STORIES}/{story_b}/chapters/{chapter['id']}")).status_code == 404
    assert (
        await client.get(f"{STORIES}/{story_b}/chapters/{chapter['id']}/brief")
    ).status_code == 404


async def test_the_ladder_now_reaches_level_8(client: AsyncTestClient) -> None:
    """Phase 2 closes the last two gates."""
    setup = await scaffolded_story(client)
    story_id = setup["story_id"]

    ladder = (await client.get(f"{STORIES}/{story_id}/ladder")).json()
    assert ladder["furthest_ready_level"] == 7

    await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})
    ladder = (await client.get(f"{STORIES}/{story_id}/ladder")).json()
    assert ladder["furthest_ready_level"] == 8, "a chapter opens scenes"
    assert ladder["snapshot"]["chapter_count"] == 1
    assert all(rung["is_ready"] for rung in ladder["levels"])
