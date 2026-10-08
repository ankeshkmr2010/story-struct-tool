from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Provider = Literal["anthropic", "openai", "openrouter", "jev"]
Entity = Literal[
    "story",
    "character",
    "relationship",
    "arc",
    "arc_stage",
    "act",
    "beat",
    "thread",
    "location",
    "chapter",
    "scene",
    "event",
    "chapter_beat",
    "scene_beat",
    "scene_thread",
    "scene_arc_advance",
    "event_character",
    "scene_presence",
]


class ConnectionSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider
    model: str = Field(min_length=1, max_length=200)
    api_key: str = Field(min_length=8, max_length=4096, repr=False)


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    provider: Provider
    model: str
    key_suffix: str


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal["create", "update", "link", "unlink"]
    entity: Entity
    ref: str = Field(min_length=1, max_length=100)
    data: dict[str, Any]


class Recommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=200)
    explanation: str = Field(max_length=4000)
    observation_ids: list[UUID] = Field(default_factory=list)
    priority: Literal["low", "medium", "high"] = "medium"


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=8000)
    assumptions: list[str] = Field(default_factory=list, max_length=30)
    recommendations: list[Recommendation] = Field(default_factory=list, max_length=30)
    operations: list[Operation] = Field(default_factory=list, max_length=200)


class PromptRequest(BaseModel):
    connection_id: UUID
    prompt: str = Field(min_length=1, max_length=12000)
    include_prose: bool = False
    mode: Literal["author", "review"] = "author"
    conversation_run_ids: list[UUID] = Field(default_factory=list, max_length=20)


class ObservationOut(BaseModel):
    id: UUID
    scene_id: UUID
    scene_title: str
    source: str
    payload: dict[str, Any]


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    story_id: UUID
    provider: str
    model: str
    prompt: str
    summary: str
    status: str
    proposal: Proposal
    result: dict[str, Any] | None
    usage: dict[str, Any]
    evidence: list[ObservationOut]


class TokenRequest(BaseModel):
    story_id: UUID
    label: str = Field(default="Story agent", min_length=1, max_length=100)
