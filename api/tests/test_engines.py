"""Unit tests for the Phase 1 engines: frameworks, readiness, health.

All pure functions -- no database, no client. If these ever need a fixture database,
something has leaked into the wrong layer.
"""

import pytest

from storytool.domain.cast.models import Arc, ArcStage, Character
from storytool.domain.enums import CharacterRole, Level, StructureFramework, ThreadType
from storytool.domain.frameworks import (
    CUSTOM,
    FRAMEWORKS,
    SAVE_THE_CAT,
    THREE_ACT,
    get_framework,
    missing_acts,
    missing_beats,
)
from storytool.domain.health import Severity, StoryGraph, run_health
from storytool.domain.readiness import (
    MIN_TURNING_POINTS,
    StorySnapshot,
    furthest_ready_level,
    ladder,
    readiness,
)
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread


def codes(findings) -> set[str]:
    return {f.code for f in findings}


# ----------------------------------------------------------------- frameworks


def test_save_the_cat_has_its_canonical_fifteen_beats() -> None:
    assert len(SAVE_THE_CAT.beats) == 15
    assert SAVE_THE_CAT.beats[0].label == "Opening Image"
    assert SAVE_THE_CAT.beats[-1].label == "Final Image"


def test_beat_positions_are_unique_within_every_framework() -> None:
    for framework in FRAMEWORKS.values():
        positions = [b.position for b in framework.beats]
        assert len(positions) == len(set(positions)), f"{framework.name} has duplicates"


def test_beat_positions_are_namespaced_by_framework() -> None:
    """Loose strings, but namespaced -- two frameworks may both have a 'midpoint'."""
    assert all(b.position.startswith("three_act.") for b in THREE_ACT.beats)
    assert all(b.position.startswith("save_the_cat.") for b in SAVE_THE_CAT.beats)


def test_custom_framework_seeds_nothing() -> None:
    assert CUSTOM.beats == ()
    assert CUSTOM.acts == ()


def test_unknown_framework_falls_back_to_custom_rather_than_raising() -> None:
    assert get_framework("not_a_framework") is CUSTOM
    assert get_framework(StructureFramework.SAVE_THE_CAT) is SAVE_THE_CAT


def test_switching_framework_is_additive_and_never_destructive() -> None:
    """Author has three_act beats and switches to save_the_cat: seed the 15 absent ones,
    and report nothing about the three_act beats they already have."""
    existing = frozenset(b.position for b in THREE_ACT.beats)
    to_seed = missing_beats(SAVE_THE_CAT, existing)
    assert len(to_seed) == 15
    assert all(b.position.startswith("save_the_cat.") for b in to_seed)


def test_reseeding_the_same_framework_is_a_no_op() -> None:
    existing = frozenset(b.position for b in SAVE_THE_CAT.beats)
    assert missing_beats(SAVE_THE_CAT, existing) == ()


def test_missing_acts_skips_numbers_already_present() -> None:
    assert len(missing_acts(THREE_ACT, frozenset())) == 3
    assert len(missing_acts(THREE_ACT, frozenset({1, 2}))) == 1


# ----------------------------------------------------------------- readiness


def test_premise_level_is_always_open() -> None:
    """There is nothing above Level 1, so it can never be gated."""
    assert readiness(Level.PREMISE, StorySnapshot()).is_ready is True


def test_blank_story_gates_everything_above_premise() -> None:
    rungs = ladder(StorySnapshot())
    assert rungs[0].is_ready is True
    assert all(r.is_ready is False for r in rungs[1:])


def test_arc_skeleton_unlocks_once_premise_exists() -> None:
    assert readiness(Level.ARC_SKELETON, StorySnapshot(story_is_complete=True)).is_ready


def test_characters_unlock_at_the_turning_point_threshold() -> None:
    below = StorySnapshot(story_is_complete=True, turning_point_count=MIN_TURNING_POINTS - 1)
    at = StorySnapshot(story_is_complete=True, turning_point_count=MIN_TURNING_POINTS)
    assert readiness(Level.CHARACTERS, below).is_ready is False
    assert readiness(Level.CHARACTERS, at).is_ready is True


def test_acts_report_every_blocker_at_once_not_just_the_first() -> None:
    result = readiness(Level.ACTS, StorySnapshot())
    assert len(result.blocked_by) == 2, "author should see all reasons, not be drip-fed them"


def test_blockers_are_human_readable_and_quantified() -> None:
    result = readiness(Level.CHARACTERS, StorySnapshot(turning_point_count=1))
    assert "currently 1" in result.blocked_by[0]


def test_furthest_ready_level_stops_at_the_first_closed_gate() -> None:
    snapshot = StorySnapshot(story_is_complete=True, turning_point_count=3)
    # Characters is ready, but Acts has no protagonist, so we stop there.
    assert furthest_ready_level(snapshot) is Level.CHARACTERS


def test_fully_scaffolded_story_opens_the_whole_ladder() -> None:
    snapshot = StorySnapshot(
        story_is_complete=True,
        turning_point_count=3,
        has_protagonist=True,
        complete_character_count=2,
        act_count=3,
        beat_count=7,
        thread_count=2,
        chapter_count=1,
    )
    assert all(r.is_ready for r in ladder(snapshot))
    assert furthest_ready_level(snapshot) is Level.SCENES


def test_readiness_never_depends_on_authoring_mode() -> None:
    """Mode is a client policy over this signal, not an input to it -- one engine."""
    snapshot = StorySnapshot(story_is_complete=True)
    assert readiness(Level.ARC_SKELETON, snapshot) == readiness(Level.ARC_SKELETON, snapshot)


# ----------------------------------------------------------------- health


def test_bare_story_is_not_buried_in_findings() -> None:
    """Rules over empty collections stay silent, so an empty story gets signal not noise."""
    findings = run_health(StoryGraph(story=Story(title="Bare")), max_level=Level.THREADS)
    assert codes(findings) == {"story.no_premise", "arc.too_few_turning_points"}


def test_level_scoping_excludes_rules_above_the_requested_level() -> None:
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        beats=(Beat(story_id=None, label="Midpoint"),),
    )
    at_beats = run_health(graph, max_level=Level.BEATS)
    at_threads = run_health(graph, max_level=Level.THREADS)
    assert "beat.unassigned_to_act" in codes(at_beats)
    # The thread rule only fires once we ask about Level 6.
    assert "thread.none_defined" not in codes(at_beats)
    assert "thread.none_defined" in codes(at_threads)


def test_premise_finding_clears_once_premise_is_written() -> None:
    graph = StoryGraph(story=Story(title="S", premise="Her maps rewrite the territory."))
    assert "story.no_premise" not in codes(run_health(graph))


def test_whitespace_premise_does_not_satisfy_the_rule() -> None:
    graph = StoryGraph(story=Story(title="S", premise="   "))
    assert "story.no_premise" in codes(run_health(graph))


def test_turning_points_flagged_both_too_few_and_too_many() -> None:
    def graph_with(n: int) -> StoryGraph:
        events = tuple(
            Event(story_id=None, label=f"TP{i}", is_turning_point=True) for i in range(n)
        )
        return StoryGraph(story=Story(title="S", premise="p"), events=events)

    assert "arc.too_few_turning_points" in codes(run_health(graph_with(2)))
    assert codes(run_health(graph_with(4))).isdisjoint(
        {"arc.too_few_turning_points", "arc.too_many_turning_points"}
    )
    assert "arc.too_many_turning_points" in codes(run_health(graph_with(9)))


def test_non_turning_point_events_do_not_count_toward_the_skeleton() -> None:
    events = tuple(Event(story_id=None, label=f"E{i}", is_turning_point=False) for i in range(6))
    graph = StoryGraph(story=Story(title="S", premise="p"), events=events)
    assert "arc.too_few_turning_points" in codes(run_health(graph))


def test_protagonist_rule_only_fires_once_characters_exist() -> None:
    empty = StoryGraph(story=Story(title="S", premise="p"))
    assert "character.no_protagonist" not in codes(run_health(empty))

    populated = StoryGraph(
        story=Story(title="S", premise="p"),
        characters=(Character(story_id=None, name="Maya", role=CharacterRole.MENTOR),),
    )
    assert "character.no_protagonist" in codes(run_health(populated))


def test_want_equal_to_need_is_flagged_as_no_internal_conflict() -> None:
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        characters=(
            Character(
                story_id=None,
                name="Maya",
                role=CharacterRole.PROTAGONIST,
                want="Safety",
                need="safety  ",
            ),
        ),
    )
    findings = run_health(graph)
    assert "character.want_equals_need" in codes(findings)
    # It is a nudge, not an error -- the author may know better.
    assert next(f for f in findings if f.code == "character.want_equals_need").severity is (
        Severity.INFO
    )


def test_distinct_want_and_need_produces_no_conflict_finding() -> None:
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        characters=(
            Character(
                story_id=None,
                name="Maya",
                role=CharacterRole.PROTAGONIST,
                want="To redraw the coastline",
                need="To accept she cannot control the sea",
            ),
        ),
    )
    assert codes(run_health(graph)).isdisjoint(
        {"character.want_equals_need", "character.missing_want_or_need"}
    )


def test_single_stage_arc_describes_no_change() -> None:
    arc = Arc(story_id=None, character_id=None, resolution="She lets go.")
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        arcs=(arc,),
        arc_stages=(ArcStage(arc_id=arc.id, label="Denial"),),
    )
    assert "arc.too_few_stages" in codes(run_health(graph))


def test_two_stage_arc_with_resolution_is_clean() -> None:
    arc = Arc(story_id=None, resolution="She lets go.")
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        arcs=(arc,),
        arc_stages=(
            ArcStage(arc_id=arc.id, label="Denial"),
            ArcStage(arc_id=arc.id, label="Acceptance"),
        ),
    )
    assert codes(run_health(graph)).isdisjoint({"arc.too_few_stages", "arc.no_resolution"})


def test_duplicate_act_numbers_are_reported() -> None:
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        acts=(Act(story_id=None, number=2), Act(story_id=None, number=2)),
    )
    assert "act.duplicate_number" in codes(run_health(graph))


def test_act_without_beats_is_flagged() -> None:
    act = Act(story_id=None, number=1)
    graph = StoryGraph(story=Story(title="S", premise="p"), acts=(act,))
    assert "act.no_beats" in codes(run_health(graph))


def test_act_with_beats_is_not_flagged_for_emptiness() -> None:
    act = Act(story_id=None, number=1)
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        acts=(act,),
        beats=(Beat(story_id=None, act_id=act.id, label="Inciting Incident"),),
    )
    assert "act.no_beats" not in codes(run_health(graph))


def test_multiple_a_stories_are_flagged() -> None:
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        threads=(
            Thread(story_id=None, type=ThreadType.A_STORY, title="Spine"),
            Thread(story_id=None, type=ThreadType.A_STORY, title="Also spine?"),
        ),
    )
    assert "thread.multiple_a_stories" in codes(run_health(graph))


def test_one_a_story_plus_b_story_is_clean() -> None:
    graph = StoryGraph(
        story=Story(title="S", premise="p"),
        threads=(
            Thread(story_id=None, type=ThreadType.A_STORY, title="Spine"),
            Thread(story_id=None, type=ThreadType.B_STORY, title="Romance"),
        ),
    )
    assert "thread.multiple_a_stories" not in codes(run_health(graph))


def test_findings_are_sorted_by_level() -> None:
    graph = StoryGraph(
        story=Story(title="S"),
        acts=(Act(story_id=None, number=1),),
        beats=(Beat(story_id=None, label="Orphan"),),
    )
    levels = [f.level for f in run_health(graph)]
    assert levels == sorted(levels)


@pytest.mark.parametrize("level", list(Level))
def test_run_health_accepts_every_level_without_error(level: Level) -> None:
    run_health(StoryGraph(story=Story(title="S")), max_level=level)
