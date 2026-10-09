"""Level 3: Characters, Relationships, and the Arcs either can carry."""

from uuid import UUID

from sqlalchemy import CheckConstraint, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import CompletableMixin, StoryToolBase


class Character(StoryToolBase, CompletableMixin):
    """Level 3. Who wants what, and what do they actually need?"""

    __tablename__ = "character"

    # want/need are the load-bearing pair -- a character without the gap between them
    # has no arc to advance.
    complete_when = ("name", "role")

    def completeness_fields(self) -> tuple[str, ...]:
        major = self.role in {"protagonist", "antagonist"} or self.arc_type in {
            "positive",
            "negative",
        }
        return ("name", "role", "want", "need") if major else ("name", "role")

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str | None] = mapped_column(String(40), default=None, index=True)

    wound: Mapped[str | None] = mapped_column(Text, default=None)
    misbelief: Mapped[str | None] = mapped_column(Text, default=None)
    want: Mapped[str | None] = mapped_column(Text, default=None)
    need: Mapped[str | None] = mapped_column(Text, default=None)

    arc_type: Mapped[str | None] = mapped_column(String(20), default=None)
    voice_notes: Mapped[str | None] = mapped_column(Text, default=None)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    aliases: Mapped[list[str] | None] = mapped_column(JSONB, default=None)
    relation_to_protagonist: Mapped[str | None] = mapped_column(Text, default=None)
    notes: Mapped[str | None] = mapped_column(Text, default=None)


class Relationship(StoryToolBase, CompletableMixin):
    """A pairwise dynamic. Can carry its own Arc."""

    __tablename__ = "relationship"

    complete_when = ("current_dynamic",)

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    character_a_id: Mapped[UUID] = mapped_column(
        ForeignKey("character.id", ondelete="CASCADE"), index=True
    )
    character_b_id: Mapped[UUID] = mapped_column(
        ForeignKey("character.id", ondelete="CASCADE"), index=True
    )
    history: Mapped[str | None] = mapped_column(Text, default=None)
    current_dynamic: Mapped[str | None] = mapped_column(Text, default=None)
    tension_notes: Mapped[str | None] = mapped_column(Text, default=None)

    __table_args__ = (
        CheckConstraint("character_a_id <> character_b_id", name="distinct_characters"),
    )


class Arc(StoryToolBase, CompletableMixin):
    """A trajectory owned by exactly one of: character, relationship, thread.

    Three nullable FKs plus a check constraint rather than a polymorphic
    (owner_type, owner_id) pair -- this keeps real referential integrity, the same reason
    beat fulfilment uses two typed join tables instead of one polymorphic one.
    """

    __tablename__ = "arc"

    complete_when = ("resolution",)

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("character.id", ondelete="CASCADE"), default=None, index=True
    )
    relationship_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("relationship.id", ondelete="CASCADE"), default=None, index=True
    )
    thread_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("thread.id", ondelete="CASCADE"), default=None, index=True
    )
    resolution: Mapped[str | None] = mapped_column(Text, default=None)

    __table_args__ = (
        CheckConstraint(
            "(character_id is not null)::int"
            " + (relationship_id is not null)::int"
            " + (thread_id is not null)::int = 1",
            name="exactly_one_owner",
        ),
    )

    @property
    def owner_id(self) -> UUID | None:
        return self.character_id or self.relationship_id or self.thread_id


class ArcStage(StoryToolBase, CompletableMixin):
    """One ordered step of an Arc.

    A real table, not a list of strings on Arc, so that scenes can point at a specific
    stage -- which is what makes "this character has an arc but no scenes advancing it"
    answerable at all.
    """

    __tablename__ = "arc_stage"

    complete_when = ("label",)

    arc_id: Mapped[UUID] = mapped_column(ForeignKey("arc.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)
