"""Suggestion rules.

Every rule here describes something that is **already true of the author's draft** and asks
a question about it. None of them proposes content. The distinction matters: "Maya appears
in six scenes but has no arc defined" is an observation the author can act on or dismiss;
"Maya should realise her father was right" would be writing their book for them.

Pure functions over a graph plus mention counts, so they are testable without a database or
an API key.
"""

from dataclasses import dataclass, field
from uuid import UUID

from storytool.domain.continuity import location_disagreements
from storytool.domain.enums import ArcType
from storytool.domain.graph import StoryGraph

# An author who has written a character into this many scenes probably means it.
MIN_SCENES_FOR_ARC_PROMPT = 3
# A name that recurs is worth asking about; a one-off is probably a spear carrier.
MIN_SCENES_FOR_UNKNOWN_NAME = 2
# How many chapters a thread can be absent from before it has "gone quiet".
QUIET_THREAD_CHAPTER_GAP = 2


@dataclass(frozen=True, slots=True)
class NoticingState:
    """What the noticing pass observed, aggregated across the story."""

    scenes_by_character: dict[UUID, int] = field(default_factory=dict)
    unknown_name_scene_counts: dict[str, int] = field(default_factory=dict)
    turning_point_scene_ids: frozenset[UUID] = frozenset()
    # scene id -> which of goal/conflict/outcome the *prose* does not show. Only populated by
    # a noticer that can judge prose structure.
    prose_element_gaps: dict[UUID, tuple[str, ...]] = field(default_factory=dict)
    # scene id -> (location it reads like, confidence). Only populated by a noticer that can
    # judge place from prose.
    location_readings: dict[UUID, tuple[UUID, float]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ProposedSuggestion:
    code: str
    message: str
    character_id: UUID | None = None
    scene_id: UUID | None = None
    thread_id: UUID | None = None
    # Set when the subject is not an entity (e.g. an unrecognised name), so distinct
    # subjects do not dedupe into each other.
    subject_key: str = ""
    """Empty for entity-subject suggestions; the name itself for unrecognised names."""


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"


def _join(items: tuple[str, ...]) -> str:
    """ "a", "a or b", "a, b, or c"."""
    if len(items) <= 1:
        return "".join(items)
    if len(items) == 2:
        return f"{items[0]} or {items[1]}"
    return f"{', '.join(items[:-1])}, or {items[-1]}"


def character_with_presence_but_no_arc(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """The brief's own example: "This character has appeared in 6 scenes. Want to define
    their arc?\""""
    with_arcs = {arc.character_id for arc in graph.arcs if arc.character_id}
    by_id = graph.character_by_id()
    out = []
    for character_id, count in sorted(state.scenes_by_character.items(), key=lambda kv: -kv[1]):
        character = by_id.get(character_id)
        if character is None or character_id in with_arcs:
            continue
        # A flat arc is an authorial decision, not an omission. Sherlock Holmes does not
        # change, and asking his author to give him an arc is noise.
        if character.arc_type == ArcType.FLAT:
            continue
        if count >= MIN_SCENES_FOR_ARC_PROMPT:
            out.append(
                ProposedSuggestion(
                    code="character.presence_without_arc",
                    message=(
                        f"{character.name} appears in {_plural(count, 'scene')} "
                        "but has no arc defined."
                    ),
                    character_id=character_id,
                )
            )
    return out


def recurring_name_that_is_not_a_character(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """A name the prose keeps using that the cast list has never heard of."""
    return [
        ProposedSuggestion(
            code="character.recurring_unknown_name",
            message=(
                f'"{name}" appears in {_plural(count, "scene")} but is not a character '
                "in this story yet."
            ),
            subject_key=name,
        )
        for name, count in sorted(state.unknown_name_scene_counts.items(), key=lambda kv: -kv[1])
        if count >= MIN_SCENES_FOR_UNKNOWN_NAME
    ]


def character_with_arc_but_no_presence(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """The inverse: an arc was planned for someone who never turns up on the page."""
    by_id = graph.character_by_id()
    out = []
    for arc in graph.arcs:
        if arc.character_id is None:
            continue
        if state.scenes_by_character.get(arc.character_id, 0) > 0:
            continue
        character = by_id.get(arc.character_id)
        if character is not None:
            out.append(
                ProposedSuggestion(
                    code="character.arc_without_presence",
                    message=(
                        f"{character.name} has an arc defined but does not appear in any "
                        "scene's prose."
                    ),
                    character_id=arc.character_id,
                )
            )
    return out


def thread_that_has_gone_quiet(graph: StoryGraph, state: NoticingState) -> list[ProposedSuggestion]:
    """A storyline the draft has drifted away from."""
    chapters = sorted(graph.chapters, key=lambda c: c.sort_key)
    if len(chapters) <= QUIET_THREAD_CHAPTER_GAP:
        return []

    position = {chapter.id: index for index, chapter in enumerate(chapters)}
    scene_chapter = {scene.id: scene.chapter_id for scene in graph.scenes}

    last_seen: dict[UUID, int] = {}
    for scene_id, thread_id, _ in graph.scene_threads:
        chapter_id = scene_chapter.get(scene_id)
        if chapter_id is None or chapter_id not in position:
            continue
        index = position[chapter_id]
        if index > last_seen.get(thread_id, -1):
            last_seen[thread_id] = index

    final = len(chapters) - 1
    out = []
    for thread in graph.threads:
        seen_at = last_seen.get(thread.id)
        if seen_at is None:
            continue  # Never appeared at all -- that is health's business, not a nudge.
        gap = final - seen_at
        if gap >= QUIET_THREAD_CHAPTER_GAP:
            label = thread.title or thread.type.replace("_", "-")
            out.append(
                ProposedSuggestion(
                    code="thread.gone_quiet",
                    message=(
                        f'Thread "{label}" has not appeared since chapter '
                        f"{chapters[seen_at].number} ({_plural(gap, 'chapter')} ago)."
                    ),
                    thread_id=thread.id,
                )
            )
    return out


def turning_point_not_pinned_to_a_beat(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """ "This feels like an Act 1 turning point. Want to pin it?" from the brief.

    Only ever asks. The author decides which beat, if any.
    """
    fulfilling = {scene_id for scene_id, _ in graph.scene_beats}
    by_id = {scene.id: scene for scene in graph.scenes}
    out = []
    for scene_id in sorted(state.turning_point_scene_ids, key=str):
        scene = by_id.get(scene_id)
        if scene is None or scene_id in fulfilling:
            continue
        title = scene.title or "An untitled scene"
        out.append(
            ProposedSuggestion(
                code="scene.unpinned_turning_point",
                message=f"{title} reads like a turning point but is not pinned to a beat.",
                scene_id=scene_id,
            )
        )
    return out


def scene_prose_missing_a_structural_element(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """Goal, conflict and outcome are what make a scene a scene.

    Distinct from `Scene.complete_when`, which checks whether the author filled in the
    fields: this reads the prose. A scene can have a goal in its field and none on the page.

    Structural, deliberately not evaluative -- it reports which element is absent, never
    whether the writing is any good.
    """
    by_id = {scene.id: scene for scene in graph.scenes}
    out = []
    for scene_id, missing in sorted(state.prose_element_gaps.items(), key=lambda kv: str(kv[0])):
        scene = by_id.get(scene_id)
        if scene is None or not missing:
            continue
        title = scene.title or "An untitled scene"
        joined = _join(missing)
        out.append(
            ProposedSuggestion(
                code="scene.prose_missing_element",
                message=f"{title}: the prose shows no {joined}.",
                scene_id=scene_id,
                # Keyed on which elements are absent, so a scene whose gap changes raises a
                # fresh observation rather than being deduped against the old one.
                subject_key=",".join(missing),
            )
        )
    return out


def scene_reads_like_an_unlinked_location(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """A scene whose prose clearly happens somewhere the author has already defined, with no
    link set. Asks; never sets the link itself."""
    locations = graph.location_by_id()
    by_id = {scene.id: scene for scene in graph.scenes}
    out = []
    for scene_id, (location_id, _) in sorted(
        state.location_readings.items(), key=lambda kv: str(kv[0])
    ):
        scene = by_id.get(scene_id)
        place = locations.get(location_id)
        if scene is None or place is None or scene.location_id is not None:
            continue
        title = scene.title or "An untitled scene"
        out.append(
            ProposedSuggestion(
                code="scene.location_unlinked",
                message=f'{title} reads like it takes place at "{place.name}".',
                scene_id=scene_id,
                subject_key=str(location_id),
            )
        )
    return out


def scene_location_disagrees_with_its_prose(
    graph: StoryGraph, state: NoticingState
) -> list[ProposedSuggestion]:
    """A scene linked to one place whose prose reads like another.

    Reuses the continuity helper so the wording and the gating live in one place. Phrased as a
    question, because the model may simply be wrong.
    """
    return [
        ProposedSuggestion(
            code=anomaly.code,
            message=anomaly.message,
            scene_id=anomaly.scene_ids[0] if anomaly.scene_ids else None,
            subject_key=str(anomaly.location_id),
        )
        for anomaly in location_disagreements(graph, state.location_readings)
    ]


RULES = (
    character_with_presence_but_no_arc,
    recurring_name_that_is_not_a_character,
    character_with_arc_but_no_presence,
    thread_that_has_gone_quiet,
    turning_point_not_pinned_to_a_beat,
    scene_prose_missing_a_structural_element,
    scene_reads_like_an_unlinked_location,
    scene_location_disagrees_with_its_prose,
)


def propose_suggestions(graph: StoryGraph, state: NoticingState) -> tuple[ProposedSuggestion, ...]:
    out: list[ProposedSuggestion] = []
    for rule in RULES:
        out.extend(rule(graph, state))
    return tuple(out)
