from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class VersionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    number: int
    label: str
    source: str
    created_at: datetime
    statistics: dict[str, Any]


class VersionChange(BaseModel):
    entity: str
    title: str
    action: str
    fields: list[str] = Field(default_factory=list)
    before: dict[str, str] = Field(default_factory=dict)
    after: dict[str, str] = Field(default_factory=dict)


class VersionPreview(BaseModel):
    version: VersionOut
    current_fingerprint: str
    current_statistics: dict[str, Any]
    changes: list[VersionChange]
    change_count: int


class VersionRestore(BaseModel):
    expected_fingerprint: str = Field(min_length=64, max_length=64)


class VersionRestoreOut(BaseModel):
    restored_number: int
    recovery_version: VersionOut
    restored_version: VersionOut
