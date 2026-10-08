"""API DTOs. Separate from the ORM models on purpose -- the interesting parts of this API
(completeness, readiness, the chapter brief) are computed, not columns.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from storytool.domain.common import EntityOut
from storytool.domain.enums import AuthoringMode, PovStyle, StructureFramework


class StoryCreate(BaseModel):
    """Only a title is required -- everything can be filled in later, by design."""

    title: str = Field(min_length=1, max_length=300)
    premise: str | None = None
    genre: str | None = Field(default=None, max_length=120)
    pov_style: PovStyle | None = None
    structure_framework: StructureFramework = StructureFramework.THREE_ACT
    authoring_mode: AuthoringMode = AuthoringMode.HYBRID


class StoryUpdate(BaseModel):
    """All fields optional; absent means "leave alone"."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    premise: str | None = None
    genre: str | None = Field(default=None, max_length=120)
    pov_style: PovStyle | None = None
    structure_framework: StructureFramework | None = None
    authoring_mode: AuthoringMode | None = None


class StoryOut(EntityOut):
    title: str
    premise: str | None
    genre: str | None
    pov_style: str | None
    structure_framework: str
    authoring_mode: str
    parent_story_id: UUID | None
    deleted_at: datetime | None


# ----------------------------------------------------------- analysis DTOs


class ReadinessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    level: int
    label: str
    is_ready: bool
    blocked_by: tuple[str, ...]


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    story_is_complete: bool
    turning_point_count: int
    character_count: int
    complete_character_count: int
    has_protagonist: bool
    act_count: int
    complete_act_count: int
    beat_count: int
    complete_beat_count: int
    thread_count: int
    chapter_count: int
    scene_count: int


class LadderOut(BaseModel):
    """What the UI renders as the level ladder.

    `furthest_ready_level` is what Plotter mode follows; `levels` reports each rung
    independently, because a Pantser story may legally have scenes while Level 3 is unready.
    """

    story_id: UUID
    furthest_ready_level: int
    levels: list[ReadinessOut]
    snapshot: SnapshotOut


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    level: int
    severity: str
    message: str
    entity_type: str | None
    entity_id: UUID | None


class HealthOut(BaseModel):
    story_id: UUID
    max_level: int
    warning_count: int
    info_count: int
    findings: list[FindingOut]


class ScaffoldOut(BaseModel):
    """Result of seeding a framework. Zero counts mean it was already scaffolded."""

    story_id: UUID
    framework: str
    acts_created: int
    beats_created: int
    changed: bool
