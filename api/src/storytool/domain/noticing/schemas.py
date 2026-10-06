"""DTOs for noticing.

Note there is no endpoint and no DTO anywhere that accepts or returns generated prose. The
only text crossing this boundary is a suggestion message composed from counts and the
author's own entity names.
"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from storytool.domain.common import TimestampedOut


class NoticerInfoOut(BaseModel):
    """Who is reading the prose, surfaced so the author is never in doubt."""

    noticer: str
    model: str | None
    claude_available: bool
    jev_available: bool


class PassResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    noticed_by: str
    scenes_read: int
    mentions_added: int
    unknown_names_found: int
    turning_points_flagged: int
    suggestions_added: int


class SuggestionOut(TimestampedOut):
    story_id: UUID
    code: str
    message: str
    character_id: UUID | None
    scene_id: UUID | None
    thread_id: UUID | None
    is_dismissed: bool
    noticed_by: str
    subject_key: str


class SuggestionUpdate(BaseModel):
    is_dismissed: bool


class MentionOut(TimestampedOut):
    scene_id: UUID
    character_id: UUID
    source: str
    is_rejected: bool


class MentionUpdate(BaseModel):
    """Confirm or reject an inferred mention.

    Rejecting is remembered: a later pass will not propose it again.
    """

    source: str | None = None
    is_rejected: bool | None = None
