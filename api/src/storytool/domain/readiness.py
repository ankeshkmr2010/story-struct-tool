"""Level gating -- advisory, computed, never enforced.

The API accepts writes at any level regardless of what this module says. Readiness is a
signal the client chooses how strictly to honour, which is what makes the three authoring
modes one engine instead of three products:

  * Plotter -- dim the next level until it is ready
  * Hybrid  -- show readiness as a nudge
  * Pantser -- ignore it entirely

Deliberately a pure function of a counts snapshot rather than a query. The service layer
builds the snapshot; this module stays trivially testable.
"""

from dataclasses import dataclass, field

from storytool.domain.enums import Level

# Advisory thresholds. The brief asks for "3-5 major turning points" at Level 2.
MIN_TURNING_POINTS = 3
MIN_ACTS = 2
MIN_BEATS = 3


@dataclass(frozen=True, slots=True)
class StorySnapshot:
    """Counts needed to judge readiness. Chapters/scenes land in Phase 2."""

    story_is_complete: bool = False
    turning_point_count: int = 0
    character_count: int = 0
    complete_character_count: int = 0
    has_protagonist: bool = False
    act_count: int = 0
    complete_act_count: int = 0
    beat_count: int = 0
    complete_beat_count: int = 0
    thread_count: int = 0
    chapter_count: int = 0
    scene_count: int = 0


@dataclass(frozen=True, slots=True)
class Readiness:
    level: Level
    is_ready: bool
    blocked_by: tuple[str, ...] = field(default_factory=tuple)

    @property
    def label(self) -> str:
        return self.level.label


def _blockers(level: Level, s: StorySnapshot) -> tuple[str, ...]:
    """Human-readable reasons this level is not yet scaffolded by the one above."""
    match level:
        case Level.PREMISE:
            # The entry point is always open -- there is nothing above it.
            return ()
        case Level.ARC_SKELETON:
            return () if s.story_is_complete else ("The story needs a premise.",)
        case Level.CHARACTERS:
            if s.turning_point_count < MIN_TURNING_POINTS:
                return (
                    f"Mark at least {MIN_TURNING_POINTS} turning points "
                    f"(currently {s.turning_point_count}).",
                )
            return ()
        case Level.ACTS:
            reasons = []
            if not s.has_protagonist:
                reasons.append("No character is marked protagonist.")
            if s.complete_character_count < 1:
                reasons.append("No character has both a want and a need defined.")
            return tuple(reasons)
        case Level.BEATS:
            if s.act_count < MIN_ACTS:
                return (f"Define at least {MIN_ACTS} acts (currently {s.act_count}).",)
            return ()
        case Level.THREADS:
            if s.beat_count < MIN_BEATS:
                return (f"Define at least {MIN_BEATS} beats (currently {s.beat_count}).",)
            return ()
        case Level.CHAPTERS:
            return () if s.thread_count >= 1 else ("No storyline threads defined yet.",)
        case Level.SCENES:
            return () if s.chapter_count >= 1 else ("No chapters exist yet.",)
    return ()


def readiness(level: Level, snapshot: StorySnapshot) -> Readiness:
    blockers = _blockers(level, snapshot)
    return Readiness(level=level, is_ready=not blockers, blocked_by=blockers)


def ladder(snapshot: StorySnapshot) -> tuple[Readiness, ...]:
    """Readiness for all eight levels -- what the UI renders as the ladder view."""
    return tuple(readiness(level, snapshot) for level in Level)


def furthest_ready_level(snapshot: StorySnapshot) -> Level:
    """The deepest level reachable without skipping a gate.

    Used by Plotter mode to decide where to send the author next. Note this stops at the
    first gate, whereas `ladder` reports every level independently -- a story can have
    scenes while Level 3 is unready, and that is a legal (if messy) Pantser state.
    """
    furthest = Level.PREMISE
    for level in Level:
        if readiness(level, snapshot).is_ready:
            furthest = level
        else:
            break
    return furthest
