"""Levels 2, 4, 5, 6: Events (arc skeleton), Acts, Beats, Threads.

Two conventions throughout:

* ``sort_key`` is a float, so reordering is "take the midpoint of my neighbours" rather
  than rewriting an array. Ordering lives on the child, never as a list on the parent.
* Parent links above the immediate owner are nullable. A beat can exist before it is
  assigned to an act -- nothing is blocked from creation.
"""

from uuid import UUID

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase


class Event(StoryToolBase, CompletableMixin):
    """Something that happens in the story world.

    Distinct from a Scene: an Event is *fabula* (when it happened), a Scene is *sjuzhet*
    (when it is told). Level 2's "arc skeleton" is Events with ``is_turning_point`` set.
    """

    __tablename__ = "event"

    complete_when = ("label",)

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, default=None)

    # Only ordering matters, and fictional calendars break real datetimes. An abstract
    # ordinal sorts; the display label is whatever the author wants to call it.
    sort_ordinal: Mapped[int] = mapped_column(Integer, default=0)
    display_label: Mapped[str | None] = mapped_column(String(200), default=None)

    is_turning_point: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Does a scene exist for this, or does it happen off-page? The scene_id link arrives
    # with Level 8 in Phase 2.
    is_on_page: Mapped[bool] = mapped_column(Boolean, default=False)


class Act(StoryToolBase, CompletableMixin):
    """Level 4. What changes across this stretch of the story?"""

    __tablename__ = "act"

    complete_when = ("title", "summary", "emotional_shift_from", "emotional_shift_to")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str | None] = mapped_column(String(200), default=None)
    summary: Mapped[str | None] = mapped_column(Text, default=None)

    # The brief wrote this as "hope -> doubt". Stored as two fields so it is queryable
    # instead of a string someone has to parse.
    emotional_shift_from: Mapped[str | None] = mapped_column(String(120), default=None)
    emotional_shift_to: Mapped[str | None] = mapped_column(String(120), default=None)

    opening_turning_point_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("event.id", ondelete="SET NULL"), default=None
    )
    closing_turning_point_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("event.id", ondelete="SET NULL"), default=None
    )
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)


class Beat(StoryToolBase, CompletableMixin):
    """Level 5. What must happen for an act to do its job?

    ``is_fulfilled`` is deliberately absent -- it is derived from the chapter_beat /
    scene_beat join tables arriving in Phase 2.
    """

    __tablename__ = "beat"

    complete_when = ("label", "description")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    # Nullable: a beat may be captured before the author knows which act owns it.
    act_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("act.id", ondelete="SET NULL"), default=None, index=True
    )
    label: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, default=None)

    # A loose string like "save_the_cat.midpoint", never an FK into a template table --
    # a framework must never become a cage.
    framework_position: Mapped[str | None] = mapped_column(String(80), default=None)
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)


class Thread(StoryToolBase, CompletableMixin):
    """Level 6. Which storyline carries which beats?"""

    __tablename__ = "thread"

    complete_when = ("title", "type")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str | None] = mapped_column(String(200), default=None)
    owner_character_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("character.id", ondelete="SET NULL"), default=None
    )
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)
