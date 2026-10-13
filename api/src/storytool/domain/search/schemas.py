from typing import Literal
from uuid import UUID

from pydantic import BaseModel

SearchContext = Literal[
    "prose",
    "story",
    "scene",
    "character",
    "location",
    "glossary_entry",
    "chapter",
    "event",
    "act",
    "beat",
    "thread",
    "timeline",
]


class SearchMatch(BaseModel):
    field: str
    excerpt: str


class SearchHit(BaseModel):
    entity: str
    id: UUID
    title: str
    chapter_id: UUID | None = None
    chapter_title: str | None = None
    matches: list[SearchMatch]


class SearchPage(BaseModel):
    items: list[SearchHit]
    next_offset: int | None = None
    semantic_available: bool = False


class SearchCapabilities(BaseModel):
    semantic_available: bool
