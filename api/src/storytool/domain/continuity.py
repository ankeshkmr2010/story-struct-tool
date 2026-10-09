"""Continuity: contradictions and possible anomalies.

Separate from `health` on purpose. Health reports **gaps** -- structure the author has not
built yet, which is normal and expected mid-draft. This module reports **contradictions** --
places where the draft disagrees with itself, which is never intentional.

Two kinds, with deliberately different voices:

* `contradiction` -- provable from the graph, stated as fact: "Maya is in two places at
  story-time 40." The tool is not guessing, so it does not hedge.
* `possible` -- a semantic judgement from a model, confidence-gated and phrased as a
  question. A tool that falsely tells a novelist their plot has a hole is worse than one
  that says nothing, so uncertainty is always visible.

As everywhere in this project: it reports what it finds and never proposes the fix.

Every rule is a pure function of a loaded graph. No queries, no I/O, no model calls.
"""

from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from enum import StrEnum
from uuid import UUID

from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import Scene

# Above this, two location names are similar enough to be a typo rather than two places.
NAME_SIMILARITY = 0.85
# Shorter names collide by coincidence ("Bay" vs "Bar"), so only compare from this length up.
MIN_NAME_LENGTH = 5


class AnomalyKind(StrEnum):
    CONTRADICTION = "contradiction"
    POSSIBLE = "possible"
    PLANNED = "planned"


@dataclass(frozen=True, slots=True)
class Anomaly:
    code: str
    kind: AnomalyKind
    message: str
    scene_ids: tuple[UUID, ...] = field(default_factory=tuple)
    character_id: UUID | None = None
    location_id: UUID | None = None
    event_id: UUID | None = None
    # Only ever set for `possible`; a contradiction is not a matter of confidence.
    confidence: float | None = None


ContinuityRule = Callable[[StoryGraph], Iterable[Anomaly]]
_RULES: list[ContinuityRule] = []


def rule(fn: ContinuityRule) -> ContinuityRule:
    _RULES.append(fn)
    return fn


def run_continuity(graph: StoryGraph) -> tuple[Anomaly, ...]:
    found: list[Anomaly] = []
    for check in _RULES:
        found.extend(check(graph))
    # Contradictions first: they are facts, and they are what the author should look at.
    return tuple(sorted(found, key=lambda a: (a.kind != AnomalyKind.CONTRADICTION, a.code)))


def registered_rule_count() -> int:
    return len(_RULES)


def _scene_label(scene: Scene) -> str:
    return scene.title or "an untitled scene"


# --------------------------------------------------------------- contradictions


@rule
def character_in_two_places_at_once(graph: StoryGraph) -> Iterator[Anomaly]:
    """The clearest contradiction a story graph can prove.

    Requires both scenes to state the same story time *and* different committed locations.
    Free-text locations are ignored -- two strings cannot be compared reliably, and guessing
    here would produce false accusations.
    """
    present = graph.characters_in_scene()
    characters = graph.character_by_id()
    locations = graph.location_by_id()

    # (character, story_time) -> {location_id: [scene, ...]}
    seen: dict[tuple[UUID, int], dict[UUID, list[Scene]]] = defaultdict(lambda: defaultdict(list))
    for scene in graph.scenes:
        if scene.story_time_ordinal is None or scene.location_id is None:
            continue
        for character_id in present.get(scene.id, set()):
            seen[(character_id, scene.story_time_ordinal)][scene.location_id].append(scene)

    for (character_id, story_time), by_location in sorted(seen.items(), key=lambda kv: str(kv[0])):
        if len(by_location) < 2:
            continue
        character = characters.get(character_id)
        names = [
            locations[location_id].name for location_id in by_location if location_id in locations
        ]
        scenes = [scene for group in by_location.values() for scene in group]
        yield Anomaly(
            code="character.two_places_at_once",
            kind=AnomalyKind.CONTRADICTION,
            message=(
                f"{character.name if character else 'A character'} is in "
                f"{len(by_location)} places at story-time {story_time}: {', '.join(names)}."
            ),
            scene_ids=tuple(scene.id for scene in scenes),
            character_id=character_id,
        )


# A first- or second-person narrator is "I" or "you" on the page and is almost never named, so
# their absence from the prose says nothing at all.
UNNAMED_NARRATOR_POV = frozenset({"first", "second"})


@rule
def pov_character_absent_from_their_own_scene(graph: StoryGraph) -> Iterator[Anomaly]:
    """A scene told from someone's point of view that never mentions them.

    Skipped entirely for first- and second-person stories: the narrator is "I", so the rule
    would accuse every scene in the book. Building a real Sherlock Holmes story -- narrated by
    Watson, who is never named in his own narration -- produced three false contradictions
    before this guard existed.

    Also only checked for scenes where a noticing pass has already found *somebody*, otherwise
    every un-analysed scene would be reported.
    """
    if (graph.story.pov_style or "") in UNNAMED_NARRATOR_POV:
        return

    present = graph.characters_in_scene()
    characters = graph.character_by_id()

    for scene in graph.scenes:
        found = present.get(scene.id)
        if not found or scene.pov_character_id is None:
            continue
        if scene.pov_character_id in found:
            continue
        who = characters.get(scene.pov_character_id)
        yield Anomaly(
            code="scene.pov_absent_from_prose",
            kind=AnomalyKind.CONTRADICTION,
            message=(
                f"{_scene_label(scene)} is told from "
                f"{who.name if who else 'a character'}'s point of view, but the prose never "
                "mentions them."
            ),
            scene_ids=(scene.id,),
            character_id=scene.pov_character_id,
        )


@rule
def unmarked_jump_backwards_in_story_time(graph: StoryGraph) -> Iterator[Anomaly]:
    """Reading order going backwards in story time without being marked a flashback.

    The `is_flashback` flag is what keeps this from accusing every deliberate analepsis in
    the book.
    """
    previous: tuple[int, Scene] | None = None
    for scene in graph.scenes_in_reading_order():
        ordinal = scene.story_time_ordinal
        if ordinal is None:
            continue
        if previous is not None and ordinal < previous[0] and not scene.is_flashback:
            yield Anomaly(
                code="scene.unmarked_time_reversal",
                kind=AnomalyKind.CONTRADICTION,
                message=(
                    f"{_scene_label(scene)} is set at story-time {ordinal}, before "
                    f"{_scene_label(previous[1])} at {previous[0]}, but is not marked as a "
                    "flashback."
                ),
                scene_ids=(previous[1].id, scene.id),
            )
        previous = (ordinal, scene)


@rule
def arc_stages_advanced_out_of_order(graph: StoryGraph) -> Iterator[Anomaly]:
    """An arc moving backwards: a later scene advancing an earlier stage.

    A character can relapse, but the *stage* order is the author's own statement of
    sequence, so contradicting it is worth surfacing. Flashbacks are exempt.
    """
    stages = graph.stage_by_id()
    arcs = graph.arc_by_id()
    characters = graph.character_by_id()

    by_scene: dict[UUID, list[UUID]] = defaultdict(list)
    for scene_id, stage_id in graph.scene_arc_advances:
        by_scene[scene_id].append(stage_id)

    furthest: dict[UUID, tuple[float, Scene]] = {}
    for scene in graph.scenes_in_reading_order():
        if scene.is_flashback:
            continue
        for stage_id in by_scene.get(scene.id, []):
            stage = stages.get(stage_id)
            if stage is None:
                continue
            seen = furthest.get(stage.arc_id)
            if seen is not None and stage.sort_key < seen[0]:
                arc = arcs.get(stage.arc_id)
                owner = characters.get(arc.character_id) if arc and arc.character_id else None
                yield Anomaly(
                    code="arc.stage_out_of_order",
                    kind=AnomalyKind.CONTRADICTION,
                    message=(
                        f"{_scene_label(scene)} moves "
                        f"{owner.name + chr(39) + 's' if owner else 'an'} arc back to "
                        f'"{stage.label}", which comes before a stage already advanced in '
                        f"{_scene_label(seen[1])}."
                    ),
                    scene_ids=(seen[1].id, scene.id),
                    character_id=arc.character_id if arc else None,
                )
            elif seen is None or stage.sort_key > seen[0]:
                furthest[stage.arc_id] = (stage.sort_key, scene)


@rule
def near_duplicate_location_names(graph: StoryGraph) -> Iterator[Anomaly]:
    """ "Harbour" and "Harbor" as two places is a typo, and it silently breaks every other
    continuity check that compares locations."""
    locations = sorted(graph.locations, key=lambda location: location.name)
    for index, first in enumerate(locations):
        for second in locations[index + 1 :]:
            if min(len(first.name), len(second.name)) < MIN_NAME_LENGTH:
                continue
            ratio = SequenceMatcher(None, first.name.casefold(), second.name.casefold()).ratio()
            if ratio >= NAME_SIMILARITY:
                yield Anomaly(
                    code="location.near_duplicate_name",
                    kind=AnomalyKind.CONTRADICTION,
                    message=(
                        f'"{first.name}" and "{second.name}" are separate locations with '
                        "nearly the same name."
                    ),
                    location_id=first.id,
                )


@rule
def event_on_page_without_a_scene(graph: StoryGraph) -> Iterator[Anomaly]:
    """An event the author says happens on the page, with no scene depicting it.

    This is the closest thing to a literal plot hole the graph can prove: the story claims
    to show something it never shows.
    """
    for event in graph.events:
        if event.is_on_page and event.scene_id is None:
            yield Anomaly(
                code="event.on_page_without_scene",
                kind=AnomalyKind.PLANNED,
                message=(
                    f'"{event.label}" is awaiting a linked on-page scene. '
                    'This is planned work, not a contradiction.'
                ),
                event_id=event.id,
            )


# ------------------------------------------------------------------ possible


def location_disagreements(
    graph: StoryGraph, readings: dict[UUID, tuple[UUID, float]]
) -> tuple[Anomaly, ...]:
    """Scenes whose prose reads like a different place than the one they are linked to.

    Not a registered rule: it needs a model's reading, which is passed in rather than
    fetched, keeping this module pure. Phrased as a question, because the model may simply
    be wrong.
    """
    locations = graph.location_by_id()
    out = []
    for scene in graph.scenes:
        reading = readings.get(scene.id)
        if reading is None or scene.location_id is None:
            continue
        read_location_id, confidence = reading
        if read_location_id == scene.location_id:
            continue
        linked = locations.get(scene.location_id)
        read = locations.get(read_location_id)
        if linked is None or read is None:
            continue
        out.append(
            Anomaly(
                code="scene.location_disagreement",
                kind=AnomalyKind.POSSIBLE,
                message=(
                    f'{_scene_label(scene)} is linked to "{linked.name}" but reads like it '
                    f'takes place at "{read.name}" — is the link right?'
                ),
                scene_ids=(scene.id,),
                location_id=scene.location_id,
                confidence=round(confidence, 3),
            )
        )
    return tuple(out)
