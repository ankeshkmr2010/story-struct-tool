"""DTOs for Levels 2, 4, 5, 6.

`story_id` is never in a request body -- it comes from the nested route path, so a client
cannot create a beat belonging to a different story than the one it addressed.
"""

from uuid import UUID

from pydantic import BaseModel, Field

from storytool.domain.common import EntityOut
from storytool.domain.enums import ThreadType

# --------------------------------------------------------------------- Event


class EventCreate(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    description: str | None = None
    sort_ordinal: int = 0
    display_label: str | None = Field(default=None, max_length=200)
    is_turning_point: bool = False
    is_on_page: bool = False


class EventUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    sort_ordinal: int | None = None
    display_label: str | None = Field(default=None, max_length=200)
    is_turning_point: bool | None = None
    is_on_page: bool | None = None


class EventOut(EntityOut):
    story_id: UUID
    label: str
    description: str | None
    sort_ordinal: int
    display_label: str | None
    is_turning_point: bool
    is_on_page: bool


# ----------------------------------------------------------------------- Act


class ActCreate(BaseModel):
    number: int = Field(default=1, ge=1)
    title: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    emotional_shift_from: str | None = Field(default=None, max_length=120)
    emotional_shift_to: str | None = Field(default=None, max_length=120)
    opening_turning_point_id: UUID | None = None
    closing_turning_point_id: UUID | None = None
    sort_key: float = 0.0


class ActUpdate(BaseModel):
    number: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    emotional_shift_from: str | None = Field(default=None, max_length=120)
    emotional_shift_to: str | None = Field(default=None, max_length=120)
    opening_turning_point_id: UUID | None = None
    closing_turning_point_id: UUID | None = None
    sort_key: float | None = None


class ActOut(EntityOut):
    story_id: UUID
    number: int
    title: str | None
    summary: str | None
    emotional_shift_from: str | None
    emotional_shift_to: str | None
    opening_turning_point_id: UUID | None
    closing_turning_point_id: UUID | None
    sort_key: float


# ---------------------------------------------------------------------- Beat


class BeatCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    description: str | None = None
    # Nullable: a beat may be captured before the author knows which act owns it.
    act_id: UUID | None = None
    framework_position: str | None = Field(default=None, max_length=80)
    sort_key: float = 0.0


class BeatUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    act_id: UUID | None = None
    framework_position: str | None = Field(default=None, max_length=80)
    sort_key: float | None = None


class BeatOut(EntityOut):
    story_id: UUID
    act_id: UUID | None
    label: str
    description: str | None
    framework_position: str | None
    sort_key: float


# -------------------------------------------------------------------- Thread


class ThreadCreate(BaseModel):
    type: ThreadType
    title: str | None = Field(default=None, max_length=200)
    owner_character_id: UUID | None = None
    sort_key: float = 0.0


class ThreadUpdate(BaseModel):
    type: ThreadType | None = None
    title: str | None = Field(default=None, max_length=200)
    owner_character_id: UUID | None = None
    sort_key: float | None = None


class ThreadOut(EntityOut):
    story_id: UUID
    type: str
    title: str | None
    owner_character_id: UUID | None
    sort_key: float
