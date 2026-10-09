"""DTOs for Level 3: Characters, Relationships, Arcs, ArcStages."""

from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from storytool.domain.common import EntityOut
from storytool.domain.enums import ArcType, CharacterRole

# ----------------------------------------------------------------- Character


class CharacterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    role: CharacterRole | None = None
    wound: str | None = None
    misbelief: str | None = None
    want: str | None = None
    need: str | None = None
    arc_type: ArcType | None = None
    voice_notes: str | None = None
    description: str | None = None
    aliases: list[str] | None = Field(default=None, max_length=30)
    relation_to_protagonist: str | None = None
    notes: str | None = None


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: CharacterRole | None = None
    wound: str | None = None
    misbelief: str | None = None
    want: str | None = None
    need: str | None = None
    arc_type: ArcType | None = None
    voice_notes: str | None = None
    description: str | None = None
    aliases: list[str] | None = Field(default=None, max_length=30)
    relation_to_protagonist: str | None = None
    notes: str | None = None


class CharacterOut(EntityOut):
    story_id: UUID
    name: str
    role: str | None
    wound: str | None
    misbelief: str | None
    want: str | None
    need: str | None
    arc_type: str | None
    voice_notes: str | None
    description: str | None
    aliases: list[str] | None
    relation_to_protagonist: str | None
    notes: str | None


# -------------------------------------------------------------- Relationship


class RelationshipCreate(BaseModel):
    character_a_id: UUID
    character_b_id: UUID
    history: str | None = None
    current_dynamic: str | None = None
    tension_notes: str | None = None

    @model_validator(mode="after")
    def characters_must_differ(self) -> "RelationshipCreate":
        """Mirrors the ck_relationship_distinct_characters DB constraint, so the client gets
        a 400 with a clear message instead of a 500 from Postgres."""
        if self.character_a_id == self.character_b_id:
            raise ValueError("A relationship needs two different characters.")
        return self


class RelationshipUpdate(BaseModel):
    history: str | None = None
    current_dynamic: str | None = None
    tension_notes: str | None = None


class RelationshipOut(EntityOut):
    story_id: UUID
    character_a_id: UUID
    character_b_id: UUID
    history: str | None
    current_dynamic: str | None
    tension_notes: str | None


# ----------------------------------------------------------------------- Arc


class ArcCreate(BaseModel):
    """Exactly one owner, mirroring the ck_arc_exactly_one_owner constraint."""

    character_id: UUID | None = None
    relationship_id: UUID | None = None
    thread_id: UUID | None = None
    resolution: str | None = None

    @model_validator(mode="after")
    def exactly_one_owner(self) -> "ArcCreate":
        owners = [self.character_id, self.relationship_id, self.thread_id]
        if sum(owner is not None for owner in owners) != 1:
            raise ValueError(
                "An arc must belong to exactly one of: character, relationship, thread."
            )
        return self


class ArcUpdate(BaseModel):
    resolution: str | None = None


class ArcOut(EntityOut):
    story_id: UUID
    character_id: UUID | None
    relationship_id: UUID | None
    thread_id: UUID | None
    resolution: str | None


# ------------------------------------------------------------------ ArcStage


class ArcStageCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    description: str | None = None
    sort_key: float = 0.0


class ArcStageUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    sort_key: float | None = None


class ArcStageOut(EntityOut):
    arc_id: UUID
    label: str
    description: str | None
    sort_key: float
