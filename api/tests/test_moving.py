"""Reordering: fractional sort keys, and the case where they run out.

The rebalance path is the reason these tests exist. Midpoint insertion looks obviously
correct until you insert into the same gap fifty times, at which point float64 can no longer
represent a value between the neighbours and two rows silently end up with equal keys --
after which their order is arbitrary. That is data corruption, not a glitch, so it gets a
test that actually exhausts the precision.
"""

import pytest
from litestar.testing import AsyncTestClient

from storytool.domain.ordering import (
    MIN_GAP,
    SORT_STEP,
    midpoint,
    needs_rebalance,
    place_between,
    rebalanced,
)

STORIES = "/api/stories"


# ------------------------------------------------------------ pure ordering


def test_midpoint_between_two_keys() -> None:
    assert midpoint(100.0, 200.0) == 150.0


def test_inserting_at_the_start_goes_below_the_first() -> None:
    assert midpoint(None, 100.0) == 100.0 - SORT_STEP


def test_inserting_at_the_end_goes_above_the_last() -> None:
    assert midpoint(300.0, None) == 300.0 + SORT_STEP


def test_inserting_into_an_empty_list() -> None:
    assert midpoint(None, None) == 0.0


def test_rebalance_is_not_needed_at_the_edges() -> None:
    """A missing neighbour means unlimited room on that side."""
    assert needs_rebalance(None, 100.0) is False
    assert needs_rebalance(100.0, None) is False


def test_rebalance_is_needed_when_the_gap_closes() -> None:
    assert needs_rebalance(100.0, 100.0 + MIN_GAP / 2) is True
    assert needs_rebalance(100.0, 200.0) is False


def test_rebalanced_keys_are_evenly_spaced() -> None:
    assert rebalanced(3) == [SORT_STEP, SORT_STEP * 2, SORT_STEP * 3]


def test_place_between_normally_needs_no_rebalance() -> None:
    key, fresh = place_between([100.0, 200.0], 1)
    assert key == 150.0
    assert fresh is None


def test_repeated_insertion_into_one_gap_eventually_rebalances() -> None:
    """Exhaust the precision deliberately, the way a real author reordering one spot would.

    Without the rebalance branch this loop ends with two identical keys.
    """
    keys = [100.0, 200.0]
    rebalance_happened = False

    for _ in range(80):
        key, fresh = place_between(keys, 1)
        if fresh is not None:
            rebalance_happened = True
            keys = fresh
            key, again = place_between(keys, 1)
            assert again is None, "a rebalance must leave room"
        keys = sorted([*keys, key])
        assert len(set(keys)) == len(keys), "two items must never share a sort key"

    assert rebalance_happened, "80 insertions into one gap should have exhausted the midpoints"


def test_place_between_returns_fresh_keys_for_siblings_on_rebalance() -> None:
    tight = [100.0, 100.0 + MIN_GAP / 4]
    key, fresh = place_between(tight, 1)
    assert fresh == rebalanced(2)
    assert fresh[0] < key < fresh[1]


# --------------------------------------------------------------- scene moves


async def story_with_scenes(client: AsyncTestClient, count: int = 3) -> dict:
    story_id = (await client.post(STORIES, json={"title": "Reorder"})).json()["id"]
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()
    scenes = []
    for index in range(count):
        scenes.append(
            (
                await client.post(
                    f"{STORIES}/{story_id}/scenes",
                    json={
                        "title": chr(ord("A") + index),
                        "chapter_id": chapter["id"],
                        "sort_key": (index + 1) * SORT_STEP,
                    },
                )
            ).json()
        )
    return {"story_id": story_id, "chapter": chapter, "scenes": scenes}


async def titles(client: AsyncTestClient, story_id: str) -> list[str]:
    scenes = (await client.get(f"{STORIES}/{story_id}/scenes")).json()
    return [s["title"] for s in scenes]


async def test_move_a_scene_after_another(client: AsyncTestClient) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]
    assert await titles(client, story_id) == ["A", "B", "C"]

    moved = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move",
        json={"after_scene_id": scenes[2]["id"]},
    )
    assert moved.status_code == 201
    assert moved.json()["rebalanced"] is False
    assert await titles(client, story_id) == ["B", "C", "A"]


async def test_move_a_scene_before_another(client: AsyncTestClient) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]

    await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[2]['id']}/move",
        json={"before_scene_id": scenes[0]["id"]},
    )
    assert await titles(client, story_id) == ["C", "A", "B"]


async def test_move_with_no_neighbour_appends(client: AsyncTestClient) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]

    await client.post(f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move", json={})
    assert await titles(client, story_id) == ["B", "C", "A"]


async def test_move_a_scene_to_another_chapter(client: AsyncTestClient) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]
    second = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 2})).json()

    result = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[1]['id']}/move",
        json={"chapter_id": second["id"]},
    )
    assert result.json()["chapter_id"] == second["id"]

    scene = (await client.get(f"{STORIES}/{story_id}/scenes/{scenes[1]['id']}")).json()
    assert scene["chapter_id"] == second["id"]


async def test_chapter_id_null_unplaces_a_scene(client: AsyncTestClient) -> None:
    """A legal state: a scene may exist before it belongs anywhere."""
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]

    result = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move", json={"chapter_id": None}
    )
    assert result.json()["chapter_id"] is None
    scene = (await client.get(f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}")).json()
    assert scene["chapter_id"] is None


async def test_omitting_chapter_id_keeps_the_current_chapter(client: AsyncTestClient) -> None:
    """Absent must not be read as null, or every reorder would unplace the scene."""
    setup = await story_with_scenes(client)
    story_id, scenes, chapter = setup["story_id"], setup["scenes"], setup["chapter"]

    result = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move",
        json={"after_scene_id": scenes[1]["id"]},
    )
    assert result.json()["chapter_id"] == chapter["id"]


async def test_a_neighbour_in_a_different_chapter_is_rejected(
    client: AsyncTestClient,
) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]
    other = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 2})).json()
    elsewhere = (
        await client.post(
            f"{STORIES}/{story_id}/scenes",
            json={"title": "Z", "chapter_id": other["id"]},
        )
    ).json()

    bad = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move",
        json={"after_scene_id": elsewhere["id"]},
    )
    assert bad.status_code == 400
    assert "not in the target chapter" in bad.json()["detail"]


async def test_giving_both_neighbours_is_rejected(client: AsyncTestClient) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]
    bad = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move",
        json={"after_scene_id": scenes[1]["id"], "before_scene_id": scenes[2]["id"]},
    )
    assert bad.status_code == 400


async def test_a_scene_cannot_be_positioned_relative_to_itself(
    client: AsyncTestClient,
) -> None:
    setup = await story_with_scenes(client)
    story_id, scenes = setup["story_id"], setup["scenes"]
    bad = await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move",
        json={"after_scene_id": scenes[0]["id"]},
    )
    assert bad.status_code == 400


async def test_repeated_moves_into_one_gap_stay_correctly_ordered(
    client: AsyncTestClient,
) -> None:
    """The rebalance path end to end: the order must survive it."""
    setup = await story_with_scenes(client, count=2)
    story_id = setup["story_id"]
    chapter_id = setup["chapter"]["id"]
    anchor = setup["scenes"][0]["id"]

    made = []
    for index in range(30):
        scene = (
            await client.post(
                f"{STORIES}/{story_id}/scenes",
                json={"title": f"x{index}", "chapter_id": chapter_id},
            )
        ).json()
        await client.post(
            f"{STORIES}/{story_id}/scenes/{scene['id']}/move",
            json={"after_scene_id": anchor},
        )
        made.append(scene["id"])

    scenes = (await client.get(f"{STORIES}/{story_id}/scenes")).json()
    keys = [s["sort_key"] for s in scenes]
    assert len(set(keys)) == len(keys), "no two scenes may share a sort key"
    assert keys == sorted(keys), "the listing must come back in key order"
    # Each move went immediately after the anchor, so the last one moved sits there.
    assert scenes[1]["id"] == made[-1]


async def test_move_on_unknown_scene_is_404(client: AsyncTestClient) -> None:
    setup = await story_with_scenes(client)
    missing = "00000000-0000-7000-8000-000000000000"
    assert (
        await client.post(f"{STORIES}/{setup['story_id']}/scenes/{missing}/move", json={})
    ).status_code == 404


# ------------------------------------------------------------- chapter moves


async def test_move_a_chapter(client: AsyncTestClient) -> None:
    story_id = (await client.post(STORIES, json={"title": "Chapters"})).json()["id"]
    made = []
    for number in (1, 2, 3):
        made.append(
            (
                await client.post(
                    f"{STORIES}/{story_id}/chapters",
                    json={"number": number, "title": f"Ch{number}", "sort_key": number * SORT_STEP},
                )
            ).json()
        )

    await client.post(
        f"{STORIES}/{story_id}/chapters/{made[0]['id']}/move",
        json={"after_chapter_id": made[2]["id"]},
    )
    order = [c["title"] for c in (await client.get(f"{STORIES}/{story_id}/chapters")).json()]
    assert order == ["Ch2", "Ch3", "Ch1"]


async def test_moving_a_chapter_leaves_its_number_alone(client: AsyncTestClient) -> None:
    """`number` is the author's label, not the ordering -- renumbering would fight an author
    who deliberately has a Chapter 0 or an interlude."""
    story_id = (await client.post(STORIES, json={"title": "Numbers"})).json()["id"]
    first = (
        await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1, "sort_key": 100})
    ).json()
    second = (
        await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 2, "sort_key": 200})
    ).json()

    await client.post(
        f"{STORIES}/{story_id}/chapters/{first['id']}/move",
        json={"after_chapter_id": second["id"]},
    )
    moved = (await client.get(f"{STORIES}/{story_id}/chapters/{first['id']}")).json()
    assert moved["number"] == 1


@pytest.mark.parametrize("field", ["after_chapter_id", "before_chapter_id"])
async def test_a_chapter_cannot_be_positioned_relative_to_itself(
    client: AsyncTestClient, field: str
) -> None:
    story_id = (await client.post(STORIES, json={"title": "Self"})).json()["id"]
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()
    bad = await client.post(
        f"{STORIES}/{story_id}/chapters/{chapter['id']}/move", json={field: chapter["id"]}
    )
    assert bad.status_code == 400


async def test_moving_a_scene_does_not_disturb_the_brief(client: AsyncTestClient) -> None:
    """Reordering is a structural edit; it must not quietly change what a chapter owes."""
    setup = await story_with_scenes(client)
    story_id, chapter, scenes = setup["story_id"], setup["chapter"], setup["scenes"]

    before = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()
    await client.post(
        f"{STORIES}/{story_id}/scenes/{scenes[0]['id']}/move",
        json={"after_scene_id": scenes[2]["id"]},
    )
    after = (await client.get(f"{STORIES}/{story_id}/chapters/{chapter['id']}/brief")).json()

    assert before["beats"] == after["beats"]
    assert [s["title"] for s in after["scenes"]] == ["B", "C", "A"]
