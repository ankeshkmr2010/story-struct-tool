"""Story health: tier-2, graph-level structural findings.

Tier 1 (is this entity filled in?) falls out of `completeness` for free. This module holds
what completeness cannot see: relationships *between* entities.

Rules are registered against the level they belong to, and `run_health` only runs rules at
or below the requested level. That is what stops a Phase 1 story from being buried in
"beat has no chapter fulfilling it" findings before chapters exist at all.

Every rule is a pure function of a loaded graph -- no queries, no I/O.
"""

from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.enums import CharacterRole, Level, ThreadType
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread

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


@dataclass(frozen=True, slots=True)
class StoryGraph:
    """Everything a rule may inspect, loaded once."""

    story: Story
    events: tuple[Event, ...] = field(default_factory=tuple)
    acts: tuple[Act, ...] = field(default_factory=tuple)
    beats: tuple[Beat, ...] = field(default_factory=tuple)
    threads: tuple[Thread, ...] = field(default_factory=tuple)
    characters: tuple[Character, ...] = field(default_factory=tuple)
    relationships: tuple[Relationship, ...] = field(default_factory=tuple)
    arcs: tuple[Arc, ...] = field(default_factory=tuple)
    arc_stages: tuple[ArcStage, ...] = field(default_factory=tuple)

    @property
    def turning_points(self) -> tuple[Event, ...]:
        return tuple(e for e in self.events if e.is_turning_point)

    def stages_by_arc(self) -> dict[UUID, list[ArcStage]]:
        grouped: dict[UUID, list[ArcStage]] = defaultdict(list)
        for stage in self.arc_stages:
            grouped[stage.arc_id].append(stage)
        return grouped

    def beats_by_act(self) -> dict[UUID | None, list[Beat]]:
        grouped: dict[UUID | None, list[Beat]] = defaultdict(list)
        for beat in self.beats:
            grouped[beat.act_id].append(beat)
        return grouped


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
        missing = [f for f in ("want", "need") if not (getattr(character, f) or "").strip()]
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
