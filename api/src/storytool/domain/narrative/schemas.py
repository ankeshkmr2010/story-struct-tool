"""DTOs for Levels 7 and 8, plus the Chapter Context Brief."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from storytool.domain.common import EntityOut, TimestampedOut
from storytool.domain.enums import DraftStatus, SceneType

# ------------------------------------------------------------------- Chapter


class ChapterCreate(BaseModel):
    number: int = Field(default=1, ge=1)
    title: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    epigraph: str | None = None
    opening_note: str | None = None
    closing_note: str | None = None
    act_id: UUID | None = None
    pov_character_id: UUID | None = None
    emotional_shift_from: str | None = Field(default=None, max_length=120)
    emotional_shift_to: str | None = Field(default=None, max_length=120)
    status: DraftStatus = DraftStatus.PLACEHOLDER
    sort_key: float = 0.0


class ChapterUpdate(BaseModel):
    number: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    epigraph: str | None = None
    opening_note: str | None = None
    closing_note: str | None = None
    act_id: UUID | None = None
    pov_character_id: UUID | None = None
    emotional_shift_from: str | None = Field(default=None, max_length=120)
    emotional_shift_to: str | None = Field(default=None, max_length=120)
    status: DraftStatus | None = None
    sort_key: float | None = None


class ChapterOut(EntityOut):
    story_id: UUID
    act_id: UUID | None
    number: int
    title: str | None
    summary: str | None
    epigraph: str | None
    opening_note: str | None
    closing_note: str | None
    pov_character_id: UUID | None
    emotional_shift_from: str | None
    emotional_shift_to: str | None
    status: str
    sort_key: float


# --------------------------------------------------------------------- Scene


class SceneCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    type: SceneType = SceneType.SCENE
    chapter_id: UUID | None = None
    summary: str | None = None
    notes: str | None = None
    location: str | None = Field(default=None, max_length=200)
    location_id: UUID | None = None
    story_time_ordinal: int | None = None
    time_label: str | None = Field(default=None, max_length=200)
    is_flashback: bool = False
    pov_character_id: UUID | None = None
    goal: str | None = None
    conflict: str | None = None
    outcome: str | None = None
    emotional_value_from: str | None = Field(default=None, max_length=120)
    emotional_value_to: str | None = Field(default=None, max_length=120)
    status: DraftStatus = DraftStatus.PLACEHOLDER
    sort_key: float = 0.0


class SceneUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    type: SceneType | None = None
    chapter_id: UUID | None = None
    summary: str | None = None
    notes: str | None = None
    location: str | None = Field(default=None, max_length=200)
    location_id: UUID | None = None
    story_time_ordinal: int | None = None
    time_label: str | None = Field(default=None, max_length=200)
    is_flashback: bool | None = None
    pov_character_id: UUID | None = None
    goal: str | None = None
    conflict: str | None = None
    outcome: str | None = None
    emotional_value_from: str | None = Field(default=None, max_length=120)
    emotional_value_to: str | None = Field(default=None, max_length=120)
    status: DraftStatus | None = None
    sort_key: float | None = None


class SceneOut(EntityOut):
    story_id: UUID
    word_count: int
    chapter_id: UUID | None
    type: str
    title: str | None
    summary: str | None
    notes: str | None
    location: str | None
    location_id: UUID | None
    story_time_ordinal: int | None
    time_label: str | None
    is_flashback: bool
    pov_character_id: UUID | None
    goal: str | None
    conflict: str | None
    outcome: str | None
    emotional_value_from: str | None
    emotional_value_to: str | None
    status: str
    sort_key: float


# -------------------------------------------------------------------- moving


class SceneMove(BaseModel):
    """Position expressed as a neighbour, not an index.

    An index is only meaningful against a list the client fetched a moment ago; a neighbour id
    still means the same thing if someone inserted a scene in between. Omitting both appends.
    """

    chapter_id: UUID | None = None
    after_scene_id: UUID | None = None
    before_scene_id: UUID | None = None


class ChapterMove(BaseModel):
    after_chapter_id: UUID | None = None
    before_chapter_id: UUID | None = None


class MoveResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sort_key: float
    rebalanced: bool
    """True when siblings had to be renumbered because the midpoints ran out."""
    chapter_id: UUID | None = None


# --------------------------------------------------------------- fulfilment


class BeatLink(BaseModel):
    beat_id: UUID


class ThreadLink(BaseModel):
    thread_id: UUID
    is_primary: bool = False


class ArcStageLink(BaseModel):
    arc_stage_id: UUID


class LinksOut(BaseModel):
    """What a scene or chapter currently points at upward."""

    beat_ids: list[UUID]
    thread_ids: list[UUID] = []
    arc_stage_ids: list[UUID] = []


# ------------------------------------------------------------------- the brief


class BeatObligationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    beat_id: UUID
    label: str
    framework_position: str | None
    is_fulfilled: bool


class ArcAdvanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    arc_id: UUID
    owner_name: str | None
    from_stage: str | None
    to_stage: str | None
    summary: str


class SceneLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    scene_id: UUID
    title: str | None
    type: str
    status: str
    is_complete: bool


class ChapterBriefOut(BaseModel):
    """Every field here is derived from the levels above the chapter.

    None of it is entered at chapter level, which is what makes opening a brand-new
    chapter informative rather than a blank form.
    """

    model_config = ConfigDict(from_attributes=True)

    chapter_id: UUID
    number: int
    title: str | None
    status: str

    act_number: int | None
    act_title: str | None

    beats: list[BeatObligationOut]
    arcs_advancing: list[ArcAdvanceOut]
    threads: list[str]

    emotional_shift_from: str | None
    emotional_shift_to: str | None
    emotional_shift_inherited: bool

    pov_character_name: str | None
    scenes: list[SceneLineOut]
    placeholder_scene_count: int
    unfulfilled_beat_count: int


# ----------------------------------------------------------------- prose


class SceneContentUpdate(BaseModel):
    """Prose write. `word_count` is deliberately absent -- the server owns it."""

    content: str | None = None
    snapshot: bool = Field(
        default=False,
        description="Capture the previous content as a revision before overwriting.",
    )
    snapshot_label: str | None = Field(default=None, max_length=200)
    expected_content: str | None = Field(
        default=None,
        description="If supplied, save only when the current prose still matches this text.",
    )


class SaveResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    word_count: int
    revision_created: bool
    annotations_reanchored: int
    annotations_orphaned: int


class SceneContentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    scene_id: UUID
    content: str | None
    word_count: int


class SceneRevisionOut(TimestampedOut):
    scene_id: UUID
    content: str | None
    word_count: int
    label: str | None


class AnnotationCreate(BaseModel):
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    quoted_text: str = Field(min_length=1)
    note: str | None = None


class AnnotationUpdate(BaseModel):
    note: str | None = None
    resolved: bool | None = None


class AnnotationOut(TimestampedOut):
    scene_id: UUID
    start_offset: int
    end_offset: int
    quoted_text: str
    note: str | None
    is_orphaned: bool
    resolved: bool


class ChapterProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chapter_id: UUID
    number: int
    title: str | None
    word_count: int
    scene_count: int
    drafted_scene_count: int


class StoryProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    story_id: UUID
    word_count: int
    scene_count: int
    drafted_scene_count: int
    unplaced_scene_word_count: int
    chapters: list[ChapterProgressOut]
