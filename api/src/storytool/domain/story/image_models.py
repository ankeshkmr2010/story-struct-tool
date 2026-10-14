"""Immutable image files and authored, versioned image descriptions/attachments."""

from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase


class ImageBlob(StoryToolBase):
    __tablename__ = "image_blob"

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    object_key: Mapped[str] = mapped_column(String(300), unique=True)
    mime: Mapped[str] = mapped_column(String(30))
    size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)


class StoryImage(StoryToolBase):
    __tablename__ = "story_image"

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    blob_id: Mapped[UUID] = mapped_column(ForeignKey("image_blob.id"))
    name: Mapped[str] = mapped_column(String(200))
    alt: Mapped[str] = mapped_column(String(500), default="")
    caption: Mapped[str] = mapped_column(String(1000), default="")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # Each entry is {entity: character|location|glossary|scene, id: UUID}.
    attachments: Mapped[list[dict[str, str]]] = mapped_column(JSONB, default=list)
