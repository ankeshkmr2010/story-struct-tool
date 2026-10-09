"""Story health: tier-2, graph-level structural findings.

Tier 1 (is this entity filled in?) falls out of `completeness` for free. This module holds
what completeness cannot see: relationships *between* entities.

Rules are registered against the level they belong to, and `run_health` only runs rules at
or below the requested level. That is what stops an early-phase story from being buried in
"beat has no chapter fulfilling it" findings before chapters exist at all.

Every rule is a pure function of a loaded graph -- no queries, no I/O.
"""

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from storytool.domain.enums import CharacterRole, Level, ThreadType
from storytool.domain.graph import StoryGraph

__all__ = ("Finding", "Severity", "StoryGraph", "registered_rule_count", "rule", "run_health")

MIN_TURNING_POINTS = 3
MAX_TURNING_POINTS = 5
MIN_ARC_STAGES = 2


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"


@dataclass(frozen=True, slots=True)
class Finding:
    code: str
    level: Level
    severity: Severity
    message: str
    entity_type: str | None = None
    entity_id: UUID | None = None


HealthRule = Callable[[StoryGraph], Iterable[Finding]]
_RULES: list[tuple[Level, HealthRule]] = []


def rule(level: Level) -> Callable[[HealthRule], HealthRule]:
    def register(fn: HealthRule) -> HealthRule:
        _RULES.append((level, fn))
        return fn

    return register


def run_health(graph: StoryGraph, max_level: Level = Level.SCENES) -> tuple[Finding, ...]:
    findings: list[Finding] = []
    for level, fn in _RULES:
        if level <= max_level:
            findings.extend(fn(graph))
    return tuple(sorted(findings, key=lambda f: (f.level, f.code)))


def registered_rule_count(max_level: Level = Level.SCENES) -> int:
    return sum(1 for level, _ in _RULES if level <= max_level)


# --------------------------------------------------------------------------- Level 1


@rule(Level.PREMISE)
def story_needs_premise(g: StoryGraph) -> Iterator[Finding]:
    if not (g.story.premise or "").strip():
        yield Finding(
            code="story.no_premise",
            level=Level.PREMISE,
            severity=Severity.WARNING,
            message="The story has no premise. Everything above it is guesswork.",
            entity_type="story",
            entity_id=g.story.id,
        )


# --------------------------------------------------------------------------- Level 2


@rule(Level.ARC_SKELETON)
def turning_point_count_is_sane(g: StoryGraph) -> Iterator[Finding]:
    count = len(g.turning_points)
    if count < MIN_TURNING_POINTS:
        yield Finding(
            code="arc.too_few_turning_points",
            level=Level.ARC_SKELETON,
            severity=Severity.WARNING,
            message=(
                f"Only {count} turning point(s) marked; an arc skeleton wants at least "
                f"{MIN_TURNING_POINTS}."
            ),
            entity_type="story",
            entity_id=g.story.id,
        )
    elif count > MAX_TURNING_POINTS:
        yield Finding(
            code="arc.too_many_turning_points",
            level=Level.ARC_SKELETON,
            severity=Severity.INFO,
            message=(
                f"{count} turning points marked. More than {MAX_TURNING_POINTS} usually "
                "means some are beats rather than major turns."
            ),
            entity_type="story",
            entity_id=g.story.id,
        )


# --------------------------------------------------------------------------- Level 3


@rule(Level.CHARACTERS)
def story_needs_a_protagonist(g: StoryGraph) -> Iterator[Finding]:
    if g.characters and not any(c.role == CharacterRole.PROTAGONIST for c in g.characters):
        yield Finding(
            code="character.no_protagonist",
            level=Level.CHARACTERS,
            severity=Severity.WARNING,
            message="No character is marked as protagonist.",
            entity_type="story",
            entity_id=g.story.id,
        )


@rule(Level.CHARACTERS)
def characters_need_want_and_need(g: StoryGraph) -> Iterator[Finding]:
    for character in g.characters:
        missing = [
            f
            for f in ("want", "need")
            if f in character.completeness.required and not (getattr(character, f) or "").strip()
        ]
        if missing:
            yield Finding(
                code="character.missing_want_or_need",
                level=Level.CHARACTERS,
                severity=Severity.WARNING,
                message=f"{character.name} has no {' or '.join(missing)} defined.",
                entity_type="character",
                entity_id=character.id,
            )


@rule(Level.CHARACTERS)
def want_should_differ_from_need(g: StoryGraph) -> Iterator[Finding]:
    """If want and need are identical there is no internal conflict to dramatise."""
    for character in g.characters:
        want = (character.want or "").strip().lower()
        need = (character.need or "").strip().lower()
        if want and want == need:
            yield Finding(
                code="character.want_equals_need",
                level=Level.CHARACTERS,
                severity=Severity.INFO,
                message=(
                    f"{character.name}'s want and need are identical, so there is no "
                    "internal conflict to resolve."
                ),
                entity_type="character",
                entity_id=character.id,
            )


@rule(Level.CHARACTERS)
def arcs_need_stages_and_resolution(g: StoryGraph) -> Iterator[Finding]:
    stages = g.stages_by_arc()
    for arc in g.arcs:
        if len(stages.get(arc.id, [])) < MIN_ARC_STAGES:
            yield Finding(
                code="arc.too_few_stages",
                level=Level.CHARACTERS,
                severity=Severity.WARNING,
                message=(
                    f"An arc has fewer than {MIN_ARC_STAGES} stages, so it describes no change."
                ),
                entity_type="arc",
                entity_id=arc.id,
            )
        if not (arc.resolution or "").strip():
            yield Finding(
                code="arc.no_resolution",
                level=Level.CHARACTERS,
                severity=Severity.INFO,
                message="An arc has no resolution recorded.",
                entity_type="arc",
                entity_id=arc.id,
            )


# --------------------------------------------------------------------------- Level 4


@rule(Level.ACTS)
def acts_need_emotional_shift(g: StoryGraph) -> Iterator[Finding]:
    for act in g.acts:
        has_from = bool((act.emotional_shift_from or "").strip())
        has_to = bool((act.emotional_shift_to or "").strip())
        if not (has_from and has_to):
            yield Finding(
                code="act.no_emotional_shift",
                level=Level.ACTS,
                severity=Severity.WARNING,
                message=f"Act {act.number} records no emotional shift, so nothing changes in it.",
                entity_type="act",
                entity_id=act.id,
            )


@rule(Level.ACTS)
def act_numbers_should_be_unique(g: StoryGraph) -> Iterator[Finding]:
    for number, count in Counter(a.number for a in g.acts).items():
        if count > 1:
            yield Finding(
                code="act.duplicate_number",
                level=Level.ACTS,
                severity=Severity.WARNING,
                message=f"{count} acts share the number {number}.",
                entity_type="story",
                entity_id=g.story.id,
            )


@rule(Level.ACTS)
def acts_should_turn_on_events(g: StoryGraph) -> Iterator[Finding]:
    for act in g.acts:
        if act.closing_turning_point_id is None:
            yield Finding(
                code="act.no_closing_turning_point",
                level=Level.ACTS,
                severity=Severity.INFO,
                message=f"Act {act.number} has no turning point marking its end.",
                entity_type="act",
                entity_id=act.id,
            )


# --------------------------------------------------------------------------- Level 5


@rule(Level.BEATS)
def beats_should_belong_to_an_act(g: StoryGraph) -> Iterator[Finding]:
    orphans = [b for b in g.beats if b.act_id is None]
    if orphans:
        yield Finding(
            code="beat.unassigned_to_act",
            level=Level.BEATS,
            severity=Severity.WARNING,
            message=f"{len(orphans)} beat(s) are not assigned to any act.",
            entity_type="story",
            entity_id=g.story.id,
        )


@rule(Level.BEATS)
def acts_should_contain_beats(g: StoryGraph) -> Iterator[Finding]:
    by_act = g.beats_by_act()
    for act in g.acts:
        if not by_act.get(act.id):
            yield Finding(
                code="act.no_beats",
                level=Level.BEATS,
                severity=Severity.WARNING,
                message=f"Act {act.number} has no beats, so nothing is required to happen in it.",
                entity_type="act",
                entity_id=act.id,
            )


# --------------------------------------------------------------------------- Level 6


@rule(Level.THREADS)
def story_needs_threads(g: StoryGraph) -> Iterator[Finding]:
    if g.beats and not g.threads:
        yield Finding(
            code="thread.none_defined",
            level=Level.THREADS,
            severity=Severity.WARNING,
            message="Beats exist but no storyline threads carry them.",
            entity_type="story",
            entity_id=g.story.id,
        )


@rule(Level.THREADS)
def exactly_one_a_story(g: StoryGraph) -> Iterator[Finding]:
    a_stories = [t for t in g.threads if t.type == ThreadType.A_STORY]
    if len(a_stories) > 1:
        yield Finding(
            code="thread.multiple_a_stories",
            level=Level.THREADS,
            severity=Severity.WARNING,
            message=f"{len(a_stories)} threads are marked A-story; only one can be the spine.",
            entity_type="story",
            entity_id=g.story.id,
        )


# --------------------------------------------------------------------------- Level 7


@rule(Level.CHAPTERS)
def beats_should_be_fulfilled(g: StoryGraph) -> Iterator[Finding]:
    """The brief's "Act 2 has no Midpoint beat assigned", generalised.

    Registered at Level 7 because fulfilment requires chapters or scenes to exist -- which
    is exactly why this rule stayed silent throughout Phase 1.
    """
    fulfilled = g.fulfilled_beat_ids()
    acts = g.act_by_id()
    for beat in g.beats:
        if beat.id not in fulfilled:
            where = f"Act {acts[beat.act_id].number}" if beat.act_id in acts else "The story"
            yield Finding(
                code="beat.unfulfilled",
                level=Level.CHAPTERS,
                severity=Severity.INFO,
                message=(f'Planned work: {where} is awaiting fulfilment of "{beat.label}".'),
                entity_type="beat",
                entity_id=beat.id,
            )


@rule(Level.CHAPTERS)
def chapters_should_belong_to_an_act(g: StoryGraph) -> Iterator[Finding]:
    for chapter in g.chapters:
        if chapter.act_id is None:
            yield Finding(
                code="chapter.no_act",
                level=Level.CHAPTERS,
                severity=Severity.WARNING,
                message=f"Chapter {chapter.number} is not assigned to an act.",
                entity_type="chapter",
                entity_id=chapter.id,
            )


@rule(Level.CHAPTERS)
def chapters_should_owe_a_beat(g: StoryGraph) -> Iterator[Finding]:
    """A chapter that fulfils nothing has no structural reason to exist."""
    for chapter in g.chapters:
        if not g.beat_ids_for_chapter(chapter.id):
            yield Finding(
                code="chapter.no_beats",
                level=Level.CHAPTERS,
                severity=Severity.WARNING,
                message=(
                    f"Chapter {chapter.number} fulfils no beats, directly or through its scenes."
                ),
                entity_type="chapter",
                entity_id=chapter.id,
            )


@rule(Level.CHAPTERS)
def chapters_need_a_pov(g: StoryGraph) -> Iterator[Finding]:
    for chapter in g.chapters:
        if chapter.pov_character_id is None:
            yield Finding(
                code="chapter.no_pov",
                level=Level.CHAPTERS,
                severity=Severity.INFO,
                message=f"Chapter {chapter.number} has no POV character.",
                entity_type="chapter",
                entity_id=chapter.id,
            )


# --------------------------------------------------------------------------- Level 8


@rule(Level.SCENES)
def chapters_should_contain_scenes(g: StoryGraph) -> Iterator[Finding]:
    by_chapter = g.scenes_by_chapter()
    for chapter in g.chapters:
        if not by_chapter.get(chapter.id):
            yield Finding(
                code="chapter.no_scenes",
                level=Level.SCENES,
                severity=Severity.INFO,
                message=f"Chapter {chapter.number} has no scenes yet.",
                entity_type="chapter",
                entity_id=chapter.id,
            )


@rule(Level.SCENES)
def scenes_should_sit_in_a_chapter(g: StoryGraph) -> Iterator[Finding]:
    orphans = [s for s in g.scenes if s.chapter_id is None]
    if orphans:
        yield Finding(
            code="scene.not_in_chapter",
            level=Level.SCENES,
            severity=Severity.WARNING,
            message=f"{len(orphans)} scene(s) do not belong to any chapter.",
            entity_type="story",
            entity_id=g.story.id,
        )


@rule(Level.SCENES)
def scenes_should_serve_a_beat(g: StoryGraph) -> Iterator[Finding]:
    """The brief's "5 scenes have no beat assigned"."""
    assigned = {scene_id for scene_id, _ in g.scene_beats}
    # A scene inside a chapter that owes beats is covered by its chapter.
    chapters_with_beats = {c.id for c in g.chapters if g.beat_ids_for_chapter(c.id)}
    unserved = [
        s for s in g.scenes if s.id not in assigned and s.chapter_id not in chapters_with_beats
    ]
    if unserved:
        yield Finding(
            code="scene.no_beat",
            level=Level.SCENES,
            severity=Severity.WARNING,
            message=f"{len(unserved)} scene(s) contribute to no beat.",
            entity_type="story",
            entity_id=g.story.id,
        )


@rule(Level.SCENES)
def scenes_should_belong_to_a_thread(g: StoryGraph) -> Iterator[Finding]:
    threaded = {scene_id for scene_id, _, _ in g.scene_threads}
    unthreaded = [s for s in g.scenes if s.id not in threaded]
    if unthreaded and g.threads:
        yield Finding(
            code="scene.no_thread",
            level=Level.SCENES,
            severity=Severity.INFO,
            message=f"{len(unthreaded)} scene(s) advance no storyline thread.",
            entity_type="story",
            entity_id=g.story.id,
        )


@rule(Level.SCENES)
def arcs_should_be_advanced_by_scenes(g: StoryGraph) -> Iterator[Finding]:
    """The brief's "Character X has an arc defined but no scenes advancing it".

    Only answerable because of the scene_arc_advance edge added to the original schema.
    """
    advanced = g.advanced_arc_ids()
    characters = g.character_by_id()
    for arc in g.arcs:
        if arc.id in advanced:
            continue
        owner = characters.get(arc.character_id) if arc.character_id else None
        subject = owner.name if owner else "An arc"
        yield Finding(
            code="arc.not_advanced",
            level=Level.SCENES,
            severity=Severity.WARNING,
            message=f"{subject} has an arc defined but no scenes advancing it.",
            entity_type="arc",
            entity_id=arc.id,
        )


@rule(Level.SCENES)
def threads_should_appear_in_every_act(g: StoryGraph) -> Iterator[Finding]:
    """The brief's "Thread B has no scenes in Act 3"."""
    if not (g.acts and g.threads and g.scenes):
        return

    chapter_act = {c.id: c.act_id for c in g.chapters}
    scene_act = {
        s.id: (chapter_act.get(s.chapter_id) if s.chapter_id is not None else None)
        for s in g.scenes
    }

    acts_per_thread: dict[UUID, set[UUID]] = defaultdict(set)
    for scene_id, thread_id, _ in g.scene_threads:
        act_id = scene_act.get(scene_id)
        if act_id is not None:
            acts_per_thread[thread_id].add(act_id)

    for thread in g.threads:
        covered = acts_per_thread.get(thread.id, set())
        if not covered:
            continue  # "no scenes at all" is scene.no_thread's business, not this rule's.
        for act in g.acts:
            if act.id not in covered:
                label = thread.title or thread.type.replace("_", "-")
                yield Finding(
                    code="thread.absent_from_act",
                    level=Level.SCENES,
                    severity=Severity.INFO,
                    message=f'Thread "{label}" has no scenes in Act {act.number}.',
                    entity_type="thread",
                    entity_id=thread.id,
                )


@rule(Level.SCENES)
def scene_pov_should_match_its_chapter(g: StoryGraph) -> Iterator[Finding]:
    """A chapter declaring one POV while its scenes use another is usually a mistake."""
    chapter_pov = {c.id: c.pov_character_id for c in g.chapters}
    names = g.character_by_id()
    for scene in g.scenes:
        declared = chapter_pov.get(scene.chapter_id) if scene.chapter_id is not None else None
        if declared and scene.pov_character_id and declared != scene.pov_character_id:
            who = names.get(scene.pov_character_id)
            yield Finding(
                code="scene.pov_mismatch",
                level=Level.SCENES,
                severity=Severity.INFO,
                message=(
                    f"A scene is in {who.name if who else 'another character'}'s POV but its "
                    "chapter declares a different POV character."
                ),
                entity_type="scene",
                entity_id=scene.id,
            )
