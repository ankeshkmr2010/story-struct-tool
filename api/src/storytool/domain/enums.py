"""Controlled vocabularies.

Stored in Postgres as plain strings, not native ENUM types, and validated at the DTO
boundary. Postgres enums require a migration to add a value, which is the wrong trade for
vocabularies that will grow (new frameworks, new character roles).
"""

from enum import IntEnum, StrEnum


class AuthoringMode(StrEnum):
    PLOTTER = "plotter"
    PANTSER = "pantser"
    HYBRID = "hybrid"


class StructureFramework(StrEnum):
    THREE_ACT = "three_act"
    SAVE_THE_CAT = "save_the_cat"
    CUSTOM = "custom"


class PovStyle(StrEnum):
    FIRST = "first"
    THIRD_LIMITED = "third_limited"
    THIRD_OMNISCIENT = "third_omniscient"
    SECOND = "second"
    MIXED = "mixed"


class StoryStatus(StrEnum):
    """Derived, never stored -- see DESIGN.md principle 3."""

    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"


class CharacterRole(StrEnum):
    PROTAGONIST = "protagonist"
    ANTAGONIST = "antagonist"
    MENTOR = "mentor"
    FOIL = "foil"
    SUPPORTING = "supporting"
    MINOR = "minor"


class ArcType(StrEnum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    FLAT = "flat"


class ThreadType(StrEnum):
    A_STORY = "a_story"
    B_STORY = "b_story"
    C_STORY = "c_story"
    THROUGHLINE = "throughline"


class Level(IntEnum):
    """The structural ladder. Ordering is the point, hence IntEnum."""

    PREMISE = 1
    ARC_SKELETON = 2
    CHARACTERS = 3
    ACTS = 4
    BEATS = 5
    THREADS = 6
    CHAPTERS = 7
    SCENES = 8

    @property
    def label(self) -> str:
        return self.name.replace("_", " ").title()


class SceneType(StrEnum):
    """Scene = goal/conflict/outcome. Sequel = reaction/dilemma/decision."""

    SCENE = "scene"
    SEQUEL = "sequel"


class DraftStatus(StrEnum):
    """Authored, not derived.

    Unlike completeness, "drafted" versus "revised" is a judgement the author makes about
    their own work -- there is no fact in the data that distinguishes them.
    """

    PLACEHOLDER = "placeholder"
    OUTLINED = "outlined"
    DRAFTED = "drafted"
    REVISED = "revised"
