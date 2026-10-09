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

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
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
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    # Free text is the *placeholder*: a scene can name a place before that place exists as an
    # entity. `location_id` is the committed form, and continuity checks only use that --
    # they cannot reason about a string.
    location: Mapped[str | None] = mapped_column(String(200), default=None)
    location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("location.id", ondelete="SET NULL"), default=None, index=True
    )
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

    # Marks a deliberate jump backwards in story time. Without it, an out-of-order scene is
    # indistinguishable from a continuity error, so the anomaly engine would accuse every
    # flashback in the book.
    is_flashback: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    status: Mapped[str] = mapped_column(String(20), default=DraftStatus.PLACEHOLDER)
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)

    # Prose, as Markdown. Portable, diffable, greppable for Phase 4 inference, and it
    # exports without an intermediate representation.
    content: Mapped[str | None] = mapped_column(Text, default=None)

    # A *cache* of a derived value, not an authored field: recomputed server-side from
    # content on every write and never settable by a client. Stored because a chapter or
    # story word-count rollup would otherwise have to load every scene's full prose.
    # server_default so this column can be added to a table that already has rows --
    # NOT NULL with no default is rejected by Postgres on a populated table.
    word_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class SceneRevision(StoryToolBase):
    """A prose snapshot.

    Taken on a debounce (blur or interval), never per keystroke -- the point is to let an
    author recover a paragraph they regret deleting, not to replay their typing.
    """

    __tablename__ = "scene_revision"

    scene_id: Mapped[UUID] = mapped_column(ForeignKey("scene.id", ondelete="CASCADE"), index=True)
    content: Mapped[str | None] = mapped_column(Text, default=None)
    # server_default so this column can be added to a table that already has rows --
    # NOT NULL with no default is rejected by Postgres on a populated table.
    word_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Free-text label, e.g. "before rewriting Act 2".
    label: Mapped[str | None] = mapped_column(String(200), default=None)


class Annotation(StoryToolBase):
    """A comment or highlight anchored to a span of a scene's prose.

    Offsets drift as the author types above them. CodeMirror's position mapping keeps live
    decorations correct within a session; `quoted_text` is the fallback for edits made
    elsewhere. If the quoted text can no longer be found, the annotation is marked
    **orphaned** rather than silently relocated -- a visibly broken annotation is far
    better than one quietly pointing at the wrong sentence.
    """

    __tablename__ = "annotation"

    scene_id: Mapped[UUID] = mapped_column(ForeignKey("scene.id", ondelete="CASCADE"), index=True)
    start_offset: Mapped[int] = mapped_column(Integer)
    end_offset: Mapped[int] = mapped_column(Integer)
    quoted_text: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text, default=None)
    is_orphaned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)


class SceneCharacterMention(StoryToolBase):
    """Which characters appear in a scene -- the table that *is* Pantser mode.

    A deterministic pass matches known character names against the prose and writes rows
    with `source="inferred"`; the author confirms or rejects them. `is_rejected` is
    remembered so a later pass cannot resurrect a mention the author already dismissed.

    DESIGN.md sketched this as a polymorphic `entity_mention(entity_type, entity_id)`.
    Implemented as a character-specific table with a real foreign key instead, for the same
    reason beat fulfilment uses two typed tables: a polymorphic id cannot carry one.
    Locations get their own table when World/Location are built.
    """

    __tablename__ = "scene_character_mention"

    scene_id: Mapped[UUID] = mapped_column(ForeignKey("scene.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[UUID] = mapped_column(
        ForeignKey("character.id", ondelete="CASCADE"), index=True
    )
    # manual | inferred | confirmed
    source: Mapped[str] = mapped_column(String(10), default="inferred")
    is_rejected: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    __table_args__ = (UniqueConstraint("scene_id", "character_id", name="one_per_pair"),)


class Suggestion(StoryToolBase):
    """A dismissible nudge.

    Persisted and deduplicated on purpose: without memory the tool would re-raise the same
    observation on every load, which would make Pantser mode insufferable rather than
    helpful. A dismissed suggestion stays dismissed.

    Suggestions only ever *notice* -- they describe what is already on the page. None of
    them proposes prose or plot.
    """

    __tablename__ = "suggestion"

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(60), index=True)
    message: Mapped[str] = mapped_column(Text)
    # Optional subjects, as real FKs rather than a polymorphic pair.
    character_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("character.id", ondelete="CASCADE"), default=None
    )
    scene_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("scene.id", ondelete="CASCADE"), default=None
    )
    thread_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("thread.id", ondelete="CASCADE"), default=None
    )
    is_dismissed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # "deterministic" or "claude" -- so the author can tell what noticed it.
    noticed_by: Mapped[str] = mapped_column(String(20), default="deterministic")

    # Discriminator for suggestions whose subject is not an entity -- an unrecognised name
    # has no FK to point at, so without this every such name collapses into one row and the
    # author only ever hears about the first.
    subject_key: Mapped[str] = mapped_column(String(120), default="", server_default="")

    __table_args__ = (
        # NULLS NOT DISTINCT because most suggestions have no subject: Postgres treats
        # NULLs as distinct by default, so (story, code, NULL, NULL, NULL) would never
        # conflict with itself and every pass would duplicate the row.
        UniqueConstraint(
            "story_id",
            "code",
            "character_id",
            "scene_id",
            "thread_id",
            "subject_key",
            name="one_per_subject",
            postgresql_nulls_not_distinct=True,
        ),
    )
