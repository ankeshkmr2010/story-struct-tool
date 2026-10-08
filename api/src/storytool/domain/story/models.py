"""Level 1 of the ladder: the Story itself."""

from uuid import UUID

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase
from storytool.domain.enums import AuthoringMode, StructureFramework


class Story(StoryToolBase, CompletableMixin):
    __tablename__ = "story"

    # Level 1 is premise. A story with a title but no premise is a valid placeholder.
    complete_when = ("title", "premise")

    title: Mapped[str] = mapped_column(String(300))
    premise: Mapped[str | None] = mapped_column(Text, default=None)
    genre: Mapped[str | None] = mapped_column(String(120), default=None)
    pov_style: Mapped[str | None] = mapped_column(String(40), default=None)
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

    # NOTE: `status` and `thematic_statement` are deliberately absent.
    # status is derived (DESIGN.md principle 3); thematic_statement belongs to Theme.
