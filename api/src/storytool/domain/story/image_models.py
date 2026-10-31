"""Immutable image files and authored, versioned image descriptions/attachments."""

from uuid import UUID

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.db.encryption import EncryptedText


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
    name: Mapped[str] = mapped_column(EncryptedText)
    alt: Mapped[str] = mapped_column(EncryptedText, default="")
    caption: Mapped[str] = mapped_column(EncryptedText, default="")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # Each entry is {entity: character|location|glossary|scene, id: UUID}.
    attachments: Mapped[list[dict[str, str]]] = mapped_column(JSONB, default=list)
    # The story's front cover or full jacket (one of each per story), its crop focus (0-1),
    # and whether a public showcase may show it. Shared and beta readers always see the cover.
    role: Mapped[str | None] = mapped_column(String(10), default=None)
    focus_x: Mapped[float] = mapped_column(Float, default=0.5)
    focus_y: Mapped[float] = mapped_column(Float, default=0.5)
    show_public: Mapped[bool] = mapped_column(Boolean, default=False)


class ImageDeletion(StoryToolBase):
    """Durable cleanup jobs committed with a permanent story purge."""

    __tablename__ = "image_deletion"

    # No foreign key: the job must survive deletion of the story and its blobs.
    story_id: Mapped[UUID] = mapped_column()
    bucket: Mapped[str] = mapped_column(String(63))
    object_key: Mapped[str] = mapped_column(String(300), unique=True)
