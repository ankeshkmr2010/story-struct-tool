"""Level 1 of the ladder: the Story itself."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase
from storytool.db.encryption import EncryptedJSON, EncryptedText
from storytool.domain.enums import AuthoringMode, StructureFramework


class Story(StoryToolBase, CompletableMixin):
    __tablename__ = "story"

    # Level 1 is premise. A story with a title but no premise is a valid placeholder.
    complete_when = ("title", "premise")

    title: Mapped[str] = mapped_column(EncryptedText)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, index=True
    )
    premise: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    blurb: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    thematic_statement: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    motifs: Mapped[list[str] | None] = mapped_column(EncryptedJSON, default=None)
    world_rules: Mapped[list[str] | None] = mapped_column(EncryptedJSON, default=None)
    style_rules: Mapped[list[str] | None] = mapped_column(EncryptedJSON, default=None)
    notes: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    genre: Mapped[str | None] = mapped_column(EncryptedText, default=None)
    pov_style: Mapped[str | None] = mapped_column(String(40), default=None)
    # None follows the author's account language.
    language: Mapped[str | None] = mapped_column(String(10), default=None)
    # Consistency findings the author chose to keep ("Keep both"), by finding key.
    consistency_exceptions: Mapped[list[str] | None] = mapped_column(EncryptedJSON, default=None)
    structure_framework: Mapped[str] = mapped_column(
        String(40), default=StructureFramework.THREE_ACT
    )
    authoring_mode: Mapped[str] = mapped_column(String(20), default=AuthoringMode.HYBRID)

    # Legacy stories remain unowned until the configured owner signs in once.
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), default=None, index=True
    )
    parent_story_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("story.id", ondelete="SET NULL"), default=None, index=True
    )

    # Status is derived (DESIGN.md principle 3).
