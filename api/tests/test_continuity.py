"""Continuity: contradictions and possible anomalies.

Each rule is tested in both directions, and the *negative* cases carry more weight than the
positive ones. A tool that falsely tells a novelist their plot has a hole is worse than one
that stays quiet, so every rule gets a test proving it keeps quiet when it should.
"""

from uuid import UUID

import pytest
import uuid_utils
from litestar.testing import AsyncTestClient

from storytool.domain.cast.models import Arc, ArcStage, Character
from storytool.domain.continuity import (
    AnomalyKind,
    location_disagreements,
    registered_rule_count,
    run_continuity,
)
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Event
from storytool.domain.world.models import Location

STORIES = "/api/stories"


def nid() -> UUID:
    return UUID(str(uuid_utils.uuid7()))


def with_id(entity, identifier: UUID | None = None):
    """Primary keys are Python-side defaults applied at INSERT, so unflushed objects need one."""
    entity.id = identifier or nid()
    return entity


def codes(anomalies) -> set[str]:
    return {a.code for a in anomalies}


def test_rules_are_registered() -> None:
    assert registered_rule_count() >= 6


# ------------------------------------------- character in two places at once


def two_places_graph(*, same_location: bool = False, same_time: bool = True) -> StoryGraph:
    maya = with_id(Character(story_id=None, name="Maya"))
    harbour = with_id(Location(story_id=None, name="The Harbour"))
    lighthouse = with_id(Location(story_id=None, name="The Lighthouse"))
    chapter = with_id(Chapter(story_id=None, number=1))

    a = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            title="At the harbour",
            sort_key=1,
            story_time_ordinal=40,
            location_id=harbour.id,
        )
    )
    b = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            title="At the lighthouse",
            sort_key=2,
            story_time_ordinal=40 if same_time else 50,
            location_id=harbour.id if same_location else lighthouse.id,
        )
    )
    return StoryGraph(
        story=Story(title="S"),
        characters=(maya,),
        locations=(harbour, lighthouse),
        chapters=(chapter,),
        scenes=(a, b),
        character_mentions=((a.id, maya.id), (b.id, maya.id)),
    )


def test_a_character_in_two_places_at_the_same_time_is_a_contradiction() -> None:
    anomalies = run_continuity(two_places_graph())
    found = [a for a in anomalies if a.code == "character.two_places_at_once"]
    assert len(found) == 1
    assert found[0].kind is AnomalyKind.CONTRADICTION
    assert "Maya is in 2 places at story-time 40" in found[0].message
    assert found[0].confidence is None, "a contradiction is not a matter of confidence"


def test_the_same_character_at_different_times_is_fine() -> None:
    assert "character.two_places_at_once" not in codes(
        run_continuity(two_places_graph(same_time=False))
    )


def test_the_same_character_in_one_place_twice_is_fine() -> None:
    assert "character.two_places_at_once" not in codes(
        run_continuity(two_places_graph(same_location=True))
    )


def test_free_text_locations_are_never_compared() -> None:
    """Two strings cannot be compared reliably, and guessing would accuse the innocent."""
    maya = with_id(Character(story_id=None, name="Maya"))
    chapter = with_id(Chapter(story_id=None, number=1))
    a = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            sort_key=1,
            story_time_ordinal=40,
            location="the harbour",
        )
    )
    b = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            sort_key=2,
            story_time_ordinal=40,
            location="the lighthouse",
        )
    )
    graph = StoryGraph(
        story=Story(title="S"),
        characters=(maya,),
        chapters=(chapter,),
        scenes=(a, b),
        character_mentions=((a.id, maya.id), (b.id, maya.id)),
    )
    assert "character.two_places_at_once" not in codes(run_continuity(graph))


def test_a_scene_with_no_story_time_is_not_judged() -> None:
    maya = with_id(Character(story_id=None, name="Maya"))
    here = with_id(Location(story_id=None, name="The Harbour"))
    there = with_id(Location(story_id=None, name="The Lighthouse"))
    chapter = with_id(Chapter(story_id=None, number=1))
    a = with_id(Scene(story_id=None, chapter_id=chapter.id, sort_key=1, location_id=here.id))
    b = with_id(Scene(story_id=None, chapter_id=chapter.id, sort_key=2, location_id=there.id))
    graph = StoryGraph(
        story=Story(title="S"),
        characters=(maya,),
        locations=(here, there),
        chapters=(chapter,),
        scenes=(a, b),
        character_mentions=((a.id, maya.id), (b.id, maya.id)),
    )
    assert "character.two_places_at_once" not in codes(run_continuity(graph))


# ------------------------------------------------------------- POV presence


def test_a_pov_character_missing_from_their_own_scene_is_a_contradiction() -> None:
    maya = with_id(Character(story_id=None, name="Maya"))
    kit = with_id(Character(story_id=None, name="Kit"))
    scene = with_id(Scene(story_id=None, title="The wall", pov_character_id=maya.id))
    graph = StoryGraph(
        story=Story(title="S"),
        characters=(maya, kit),
        scenes=(scene,),
        character_mentions=((scene.id, kit.id),),
    )
    found = [a for a in run_continuity(graph) if a.code == "scene.pov_absent_from_prose"]
    assert len(found) == 1
    assert "Maya's point of view" in found[0].message


def test_a_scene_with_no_mentions_yet_is_not_accused() -> None:
    """Before a noticing pass runs there are no mentions, and every scene would look wrong."""
    maya = with_id(Character(story_id=None, name="Maya"))
    scene = with_id(Scene(story_id=None, title="Unread", pov_character_id=maya.id))
    graph = StoryGraph(story=Story(title="S"), characters=(maya,), scenes=(scene,))
    assert "scene.pov_absent_from_prose" not in codes(run_continuity(graph))


# -------------------------------------------------------- time reversal


def reading_order_graph(*, backwards: bool, flashback: bool) -> StoryGraph:
    chapter = with_id(Chapter(story_id=None, number=1))
    first = with_id(
        Scene(
            story_id=None, chapter_id=chapter.id, title="First", sort_key=1, story_time_ordinal=50
        )
    )
    second = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            title="Second",
            sort_key=2,
            story_time_ordinal=20 if backwards else 60,
            is_flashback=flashback,
        )
    )
    return StoryGraph(story=Story(title="S"), chapters=(chapter,), scenes=(first, second))


def test_an_unmarked_jump_backwards_is_a_contradiction() -> None:
    found = [
        a
        for a in run_continuity(reading_order_graph(backwards=True, flashback=False))
        if a.code == "scene.unmarked_time_reversal"
    ]
    assert len(found) == 1
    assert "not marked as a flashback" in found[0].message


def test_a_marked_flashback_is_not_a_contradiction() -> None:
    """Without this the engine would accuse every deliberate analepsis in the book."""
    assert "scene.unmarked_time_reversal" not in codes(
        run_continuity(reading_order_graph(backwards=True, flashback=True))
    )


def test_forward_story_time_is_fine() -> None:
    assert "scene.unmarked_time_reversal" not in codes(
        run_continuity(reading_order_graph(backwards=False, flashback=False))
    )


# --------------------------------------------------------- arc stage order


def arc_graph(*, backwards: bool, flashback: bool = False) -> StoryGraph:
    maya = with_id(Character(story_id=None, name="Maya"))
    arc = with_id(Arc(story_id=None, character_id=maya.id))
    denial = with_id(ArcStage(arc_id=arc.id, label="denial", sort_key=1))
    acceptance = with_id(ArcStage(arc_id=arc.id, label="acceptance", sort_key=2))
    chapter = with_id(Chapter(story_id=None, number=1))
    first = with_id(Scene(story_id=None, chapter_id=chapter.id, title="First", sort_key=1))
    second = with_id(
        Scene(
            story_id=None,
            chapter_id=chapter.id,
            title="Second",
            sort_key=2,
            is_flashback=flashback,
        )
    )
    advances = (
        ((first.id, acceptance.id), (second.id, denial.id))
        if backwards
        else ((first.id, denial.id), (second.id, acceptance.id))
    )
    return StoryGraph(
        story=Story(title="S"),
        characters=(maya,),
        arcs=(arc,),
        arc_stages=(denial, acceptance),
        chapters=(chapter,),
        scenes=(first, second),
        scene_arc_advances=advances,
    )


def test_an_arc_moving_backwards_is_a_contradiction() -> None:
    found = [
        a for a in run_continuity(arc_graph(backwards=True)) if a.code == "arc.stage_out_of_order"
    ]
    assert len(found) == 1
    assert '"denial"' in found[0].message


def test_an_arc_advancing_in_order_is_fine() -> None:
    assert "arc.stage_out_of_order" not in codes(run_continuity(arc_graph(backwards=False)))


def test_a_flashback_may_revisit_an_earlier_arc_stage() -> None:
    assert "arc.stage_out_of_order" not in codes(
        run_continuity(arc_graph(backwards=True, flashback=True))
    )


# ------------------------------------------------- near-duplicate locations


@pytest.mark.parametrize(
    ("first", "second", "flagged"),
    [
        ("The Harbour", "The Harbor", True),
        ("Lighthouse", "Lighthous", True),
        ("The Harbour", "The Lighthouse", False),
        # Short names collide by coincidence, so they are left alone.
        ("Bay", "Bar", False),
    ],
)
def test_near_duplicate_location_names(first: str, second: str, flagged: bool) -> None:
    graph = StoryGraph(
        story=Story(title="S"),
        locations=(
            with_id(Location(story_id=None, name=first)),
            with_id(Location(story_id=None, name=second)),
        ),
    )
    assert ("location.near_duplicate_name" in codes(run_continuity(graph))) is flagged


# --------------------------------------------------- event claimed on page


def test_an_on_page_event_with_no_scene_is_a_contradiction() -> None:
    """The closest thing to a literal plot hole the graph can prove: the story claims to show
    something it never shows."""
    event = with_id(Event(story_id=None, label="The lighthouse burns", is_on_page=True))
    graph = StoryGraph(story=Story(title="S"), events=(event,))
    found = [a for a in run_continuity(graph) if a.code == "event.on_page_without_scene"]
    assert len(found) == 1
    assert "The lighthouse burns" in found[0].message
    assert found[0].event_id == event.id


def test_an_off_page_event_needs_no_scene() -> None:
    event = with_id(Event(story_id=None, label="The war ends", is_on_page=False))
    graph = StoryGraph(story=Story(title="S"), events=(event,))
    assert "event.on_page_without_scene" not in codes(run_continuity(graph))


def test_an_on_page_event_with_a_scene_is_fine() -> None:
    scene = with_id(Scene(story_id=None, title="The fire"))
    event = with_id(
        Event(story_id=None, label="The lighthouse burns", is_on_page=True, scene_id=scene.id)
    )
    graph = StoryGraph(story=Story(title="S"), events=(event,), scenes=(scene,))
    assert "event.on_page_without_scene" not in codes(run_continuity(graph))


# ------------------------------------------------------ possible anomalies


def test_a_location_disagreement_is_a_question_not_a_verdict() -> None:
    harbour = with_id(Location(story_id=None, name="The Harbour"))
    lighthouse = with_id(Location(story_id=None, name="The Lighthouse"))
    scene = with_id(Scene(story_id=None, title="The meeting", location_id=harbour.id))
    graph = StoryGraph(story=Story(title="S"), locations=(harbour, lighthouse), scenes=(scene,))

    found = location_disagreements(graph, {scene.id: (lighthouse.id, 0.82)})
    assert len(found) == 1
    assert found[0].kind is AnomalyKind.POSSIBLE
    assert found[0].confidence == 0.82
    assert found[0].message.endswith("is the link right?"), "phrased as a question"
    assert "plot hole" not in found[0].message.lower()


def test_agreement_produces_no_anomaly() -> None:
    harbour = with_id(Location(story_id=None, name="The Harbour"))
    scene = with_id(Scene(story_id=None, location_id=harbour.id))
    graph = StoryGraph(story=Story(title="S"), locations=(harbour,), scenes=(scene,))
    assert location_disagreements(graph, {scene.id: (harbour.id, 0.95)}) == ()


def test_an_unlinked_scene_is_not_a_disagreement() -> None:
    """Nothing to disagree with -- that is a suggestion to link it, not an anomaly."""
    harbour = with_id(Location(story_id=None, name="The Harbour"))
    scene = with_id(Scene(story_id=None, location_id=None))
    graph = StoryGraph(story=Story(title="S"), locations=(harbour,), scenes=(scene,))
    assert location_disagreements(graph, {scene.id: (harbour.id, 0.95)}) == ()


def test_a_clean_story_reports_nothing() -> None:
    """The whole engine stays silent on a draft with no contradictions in it."""
    assert run_continuity(StoryGraph(story=Story(title="S"))) == ()


# -------------------------------------------------------------- integration


async def test_continuity_endpoint_separates_facts_from_questions(
    client: AsyncTestClient,
) -> None:
    story_id = (await client.post(STORIES, json={"title": "Continuity"})).json()["id"]
    report = (await client.get(f"{STORIES}/{story_id}/continuity")).json()
    assert report["contradiction_count"] == 0
    assert report["possible_count"] == 0
    assert report["anomalies"] == []


async def test_a_real_contradiction_surfaces_through_the_api(client: AsyncTestClient) -> None:
    story_id = (await client.post(STORIES, json={"title": "Two places"})).json()["id"]
    maya = (await client.post(f"{STORIES}/{story_id}/characters", json={"name": "Maya"})).json()
    harbour = (
        await client.post(f"{STORIES}/{story_id}/locations", json={"name": "The Harbour"})
    ).json()
    lighthouse = (
        await client.post(f"{STORIES}/{story_id}/locations", json={"name": "The Lighthouse"})
    ).json()
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 1})).json()

    for index, location in enumerate((harbour, lighthouse), start=1):
        scene = (
            await client.post(
                f"{STORIES}/{story_id}/scenes",
                json={
                    "title": f"Scene {index}",
                    "chapter_id": chapter["id"],
                    "sort_key": index,
                    "story_time_ordinal": 40,
                    "location_id": location["id"],
                },
            )
        ).json()
        await client.put(
            f"{STORIES}/{story_id}/scenes/{scene['id']}/content",
            json={"content": "Maya waited for the tide to turn."},
        )

    await client.post(f"{STORIES}/{story_id}/notice")

    report = (await client.get(f"{STORIES}/{story_id}/continuity")).json()
    assert report["contradiction_count"] >= 1
    found = next(a for a in report["anomalies"] if a["code"] == "character.two_places_at_once")
    assert found["kind"] == "contradiction"
    assert found["character_id"] == maya["id"]
    assert len(found["scene_ids"]) == 2


async def test_duplicate_location_names_are_rejected_with_a_409(
    client: AsyncTestClient,
) -> None:
    story_id = (await client.post(STORIES, json={"title": "Dupes"})).json()["id"]
    assert (
        await client.post(f"{STORIES}/{story_id}/locations", json={"name": "The Harbour"})
    ).status_code == 201
    clash = await client.post(f"{STORIES}/{story_id}/locations", json={"name": "The Harbour"})
    assert clash.status_code == 409
    assert "already has a location" in clash.json()["detail"]


async def test_location_usage_tracks_scenes_chapters_and_characters(
    client: AsyncTestClient,
) -> None:
    story_id = (await client.post(STORIES, json={"title": "Usage"})).json()["id"]
    maya = (await client.post(f"{STORIES}/{story_id}/characters", json={"name": "Maya"})).json()
    harbour = (
        await client.post(f"{STORIES}/{story_id}/locations", json={"name": "The Harbour"})
    ).json()
    chapter = (await client.post(f"{STORIES}/{story_id}/chapters", json={"number": 3})).json()

    scene = (
        await client.post(
            f"{STORIES}/{story_id}/scenes",
            json={
                "title": "Tide",
                "chapter_id": chapter["id"],
                "location_id": harbour["id"],
                "story_time_ordinal": 10,
            },
        )
    ).json()
    await client.put(
        f"{STORIES}/{story_id}/scenes/{scene['id']}/content",
        json={"content": "Maya counted the boats."},
    )
    await client.post(f"{STORIES}/{story_id}/notice")

    usage = (await client.get(f"{STORIES}/{story_id}/locations/usage")).json()
    assert len(usage) == 1
    entry = usage[0]
    assert entry["name"] == "The Harbour"
    assert entry["scene_count"] == 1
    assert entry["chapter_numbers"] == [3]
    assert entry["character_ids"] == [maya["id"]]
    assert entry["first_story_time"] == 10


async def test_locations_are_story_scoped(client: AsyncTestClient) -> None:
    a = (await client.post(STORIES, json={"title": "A"})).json()["id"]
    b = (await client.post(STORIES, json={"title": "B"})).json()["id"]
    location = (await client.post(f"{STORIES}/{a}/locations", json={"name": "Shared"})).json()

    assert (await client.get(f"{STORIES}/{b}/locations/{location['id']}")).status_code == 404
    # The same name in a different story is fine -- uniqueness is per story.
    assert (
        await client.post(f"{STORIES}/{b}/locations", json={"name": "Shared"})
    ).status_code == 201


# ------------------------------------------- first-person narration guard


def test_a_first_person_story_never_reports_an_absent_pov() -> None:
    """Found by building "The Red-Headed League": Watson narrates as "I" and is never named, so
    the rule declared him absent from his own scenes -- and said so as a contradiction, which is
    the worst possible place to be wrong."""
    watson = with_id(Character(story_id=None, name="John Watson"))
    holmes = with_id(Character(story_id=None, name="Sherlock Holmes"))
    scene = with_id(Scene(story_id=None, title="Wilson's story", pov_character_id=watson.id))
    graph = StoryGraph(
        story=Story(title="S", pov_style="first"),
        characters=(watson, holmes),
        scenes=(scene,),
        character_mentions=((scene.id, holmes.id),),
    )
    assert "scene.pov_absent_from_prose" not in codes(run_continuity(graph))


def test_a_third_person_story_still_reports_an_absent_pov() -> None:
    """The guard must not disable the rule everywhere -- in third person the POV character is
    named, so their absence is still a real contradiction."""
    maya = with_id(Character(story_id=None, name="Maya"))
    kit = with_id(Character(story_id=None, name="Kit"))
    scene = with_id(Scene(story_id=None, title="The wall", pov_character_id=maya.id))
    graph = StoryGraph(
        story=Story(title="S", pov_style="third_limited"),
        characters=(maya, kit),
        scenes=(scene,),
        character_mentions=((scene.id, kit.id),),
    )
    assert "scene.pov_absent_from_prose" in codes(run_continuity(graph))
