"""DTOs for locations and continuity."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from storytool.domain.common import EntityOut


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    atmosphere_notes: str | None = None
    sort_key: float = 0.0


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    atmosphere_notes: str | None = None
    sort_key: float | None = None


class LocationOut(EntityOut):
    story_id: UUID
    name: str
    description: str | None
    atmosphere_notes: str | None
    sort_key: float


class LocationUsageOut(BaseModel):
    """Where a location actually appears -- the tracking half of the feature."""

    location_id: UUID
    name: str
    scene_count: int
    chapter_numbers: list[int]
    character_ids: list[UUID]
    first_story_time: int | None
    last_story_time: int | None


class AnomalyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    kind: str
    message: str
    scene_ids: list[UUID]
    character_id: UUID | None
    location_id: UUID | None
    event_id: UUID | None
    confidence: float | None


class ContinuityOut(BaseModel):
    """Contradictions are facts; possible anomalies are questions. Counted separately so the
    UI never presents a guess with the authority of a proof."""

    story_id: UUID
    contradiction_count: int
    possible_count: int
    anomalies: list[AnomalyOut]
