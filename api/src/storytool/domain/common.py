"""Shared DTO bases and CRUD helpers.

`CompletenessOut` lives here rather than in each entity's schemas module so the OpenAPI
schema (and therefore the generated TypeScript) has exactly one definition of it.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from litestar.exceptions import NotFoundException
from pydantic import BaseModel, ConfigDict


class CompletenessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    is_complete: bool
    missing: tuple[str, ...]
    required: tuple[str, ...]
    ratio: float


class TimestampedOut(BaseModel):
    """Identity and timestamps, for records that have no completeness semantics.

    Revisions and annotations are artefacts of the writing process, not entities the author
    fills in, so asking whether they are "complete" is meaningless.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


class EntityOut(TimestampedOut):
    """A ladder entity: identity, timestamps, and its derived completeness."""

    completeness: CompletenessOut


async def fetch_or_404(service: Any, label: str, **filters: Any) -> Any:
    """Fetch one record by arbitrary filters, or raise 404.

    Callers on nested routes pass *both* the entity id and the parent id, so addressing
    `/stories/A/beats/{id}` where the beat belongs to story B yields 404 rather than
    leaking another story's row. Returns Any because the eight entity services have no
    useful common supertype; each caller immediately validates into its own DTO.
    """
    record = await service.get_one_or_none(**filters)
    if record is None:
        entity_id = filters.get("id", "?")
        raise NotFoundException(detail=f"No {label} with id {entity_id} in this story")
    return record


def apply_patch[RecordT](record: RecordT, data: BaseModel) -> RecordT:
    """Apply only the fields the client actually sent.

    `exclude_unset` is what makes an absent field mean "leave alone" rather than "set to
    null" -- essential when most fields are legitimately nullable placeholders.
    """
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(record, field, value)
    return record
