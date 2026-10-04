"""Levels 7 and 8: Chapters and Scenes, plus the join tables that make the upward
references real.

The four association tables here are the load-bearing part of the whole design. Beat
fulfilment deliberately uses **two typed tables** (`chapter_beat`, `scene_beat`) rather
than one polymorphic `(fulfiller_type, fulfiller_id)` pair: a polymorphic column cannot
carry a foreign key, and this is the hinge every generated brief and health finding hangs
from, so it gets real referential integrity.

`is_fulfilled` is not a column anywhere. It is derived by asking whether a beat appears in
either join table.
"""

from uuid import UUID

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase, metadata
from storytool.domain.enums import DraftStatus, SceneType

# --------------------------------------------------------------- join tables

chapter_beat = Table(
    "chapter_beat",
    metadata,
    Column("chapter_id", ForeignKey("chapter.id", ondelete="CASCADE"), primary_key=True),
    Column("beat_id", ForeignKey("beat.id", ondelete="CASCADE"), primary_key=True),
)
"""A chapter fulfils a beat. Composite PK makes the pairing idempotent."""

scene_beat = Table(
    "scene_beat",
    metadata,
    Column("scene_id", ForeignKey("scene.id", ondelete="CASCADE"), primary_key=True),
    Column("beat_id", ForeignKey("beat.id", ondelete="CASCADE"), primary_key=True),
)
"""A scene fulfils a beat -- finer grained than chapter_beat, and both count."""

scene_thread = Table(
    "scene_thread",
    metadata,
    Column("scene_id", ForeignKey("scene.id", ondelete="CASCADE"), primary_key=True),
    Column("thread_id", ForeignKey("thread.id", ondelete="CASCADE"), primary_key=True),
    # Many-to-many because good scenes routinely advance A- and B-story at once; one
    # thread may be flagged primary for display purposes.
    Column("is_primary", Boolean, nullable=False, server_default="false"),
)

scene_arc_advance = Table(
    "scene_arc_advance",
    metadata,
    Column("scene_id", ForeignKey("scene.id", ondelete="CASCADE"), primary_key=True),
    Column("arc_stage_id", ForeignKey("arc_stage.id", ondelete="CASCADE"), primary_key=True),
)
"""The edge the original brief lacked. Without it, "this character has an arc but no
scenes advancing it" cannot be answered at all."""


# ------------------------------------------------------------------- Chapter


class Chapter(StoryToolBase, CompletableMixin):
    """Level 7. A container that exists to fulfil specific beats."""

    __tablename__ = "chapter"

    complete_when = ("title", "summary", "pov_character_id")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    # Nullable: a chapter may be sketched before the author knows which act owns it.
    act_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("act.id", ondelete="SET NULL"), default=None, index=True
    )
    number: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str | None] = mapped_column(String(200), default=None)
    summary: Mapped[str | None] = mapped_column(Text, default=None)

    pov_character_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("character.id", ondelete="SET NULL"), default=None
    )
    emotional_shift_from: Mapped[str | None] = mapped_column(String(120), default=None)
    emotional_shift_to: Mapped[str | None] = mapped_column(String(120), default=None)

    status: Mapped[str] = mapped_column(String(20), default=DraftStatus.PLACEHOLDER)
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)


# --------------------------------------------------------------------- Scene


class Scene(StoryToolBase, CompletableMixin):
    """Level 8. The atomic unit of writing.

    `story_id` is carried directly rather than reached through the chapter, because a
    scene may exist before it belongs to any chapter -- which is exactly how Pantser mode
    starts.
    """

    __tablename__ = "scene"

    # goal/conflict/outcome is what makes a scene a scene rather than an episode.
    complete_when = ("goal", "conflict", "outcome", "pov_character_id")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    chapter_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("chapter.id", ondelete="SET NULL"), default=None, index=True
    )

    type: Mapped[str] = mapped_column(String(10), default=SceneType.SCENE)
    title: Mapped[str | None] = mapped_column(String(200), default=None)
    summary: Mapped[str | None] = mapped_column(Text, default=None)

    location: Mapped[str | None] = mapped_column(String(200), default=None)
    # Same reasoning as Event: only ordering is mechanical, the label is the author's.
    story_time_ordinal: Mapped[int | None] = mapped_column(Integer, default=None)
    time_label: Mapped[str | None] = mapped_column(String(200), default=None)

    pov_character_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("character.id", ondelete="SET NULL"), default=None
    )
    goal: Mapped[str | None] = mapped_column(Text, default=None)
    conflict: Mapped[str | None] = mapped_column(Text, default=None)
    outcome: Mapped[str | None] = mapped_column(Text, default=None)
    emotional_value_from: Mapped[str | None] = mapped_column(String(120), default=None)
    emotional_value_to: Mapped[str | None] = mapped_column(String(120), default=None)

    status: Mapped[str] = mapped_column(String(20), default=DraftStatus.PLACEHOLDER)
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)

    # NOTE: prose `content`, `word_count` and annotations arrive in Phase 3.
    # word_count will be derived from content, never authored.
