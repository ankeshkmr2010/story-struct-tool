import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from storytool.db.base import StoryToolBase
from storytool.db.encryption import EncryptedText


class Vector(UserDefinedType):
    """pgvector without fixed dimensions until a model is selected."""

    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "vector"

    def bind_processor(self, dialect: Any) -> Any:
        return lambda value: json.dumps(value) if value is not None else None

    def result_processor(self, dialect: Any, coltype: Any) -> Any:
        return lambda value: json.loads(value) if isinstance(value, str) else value


class SearchChunk(StoryToolBase):
    __tablename__ = "search_chunk"
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[UUID] = mapped_column()
    field: Mapped[str] = mapped_column(String(60))
    ordinal: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(EncryptedText)
    content_hash: Mapped[str] = mapped_column(String(64))
    profile: Mapped[str] = mapped_column(String(64))
    embedding: Mapped[list[float]] = mapped_column(Vector())


class SearchIndex(StoryToolBase):
    __tablename__ = "search_index"
    __table_args__ = (UniqueConstraint("story_id", name="one_search_index_per_story"),)
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"))
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    profile: Mapped[str] = mapped_column(String(64))
