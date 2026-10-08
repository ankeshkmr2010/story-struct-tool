"""Add locations and character participation to story-world events.

Revision ID: 38c7a01e9d42
Revises: 7d4b9e0c2f1a
"""

import sqlalchemy as sa
from advanced_alchemy.types import GUID
from alembic import op

revision = "38c7a01e9d42"
down_revision = "7d4b9e0c2f1a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event", sa.Column("location_id", GUID(length=16), nullable=True))
    op.create_index("ix_event_location_id", "event", ["location_id"])
    op.create_foreign_key(
        "fk_event_location_id_location", "event", "location", ["location_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "event_character",
        sa.Column("event_id", GUID(length=16), nullable=False),
        sa.Column("character_id", GUID(length=16), nullable=False),
        sa.PrimaryKeyConstraint("event_id", "character_id", name="pk_event_character"),
        sa.ForeignKeyConstraint(
            ["event_id"], ["event.id"], ondelete="CASCADE",
            name="fk_event_character_event_id_event",
        ),
        sa.ForeignKeyConstraint(
            ["character_id"], ["character.id"], ondelete="CASCADE",
            name="fk_event_character_character_id_character",
        ),
    )
    # Existing events depicted by a scene at the same world time already have
    # reliable context. Carry over its place and authored cast, excluding guesses.
    op.execute("""
        UPDATE event SET location_id = scene.location_id
        FROM scene
        WHERE event.scene_id = scene.id AND event.story_id = scene.story_id
          AND event.sort_ordinal = scene.story_time_ordinal
    """)
    op.execute("""
        INSERT INTO event_character (event_id, character_id)
        SELECT event.id, scene.pov_character_id
        FROM event JOIN scene ON scene.id = event.scene_id
        JOIN character ON character.id = scene.pov_character_id
        WHERE event.story_id = scene.story_id AND character.story_id = event.story_id
          AND event.sort_ordinal = scene.story_time_ordinal
        UNION
        SELECT event.id, mention.character_id
        FROM event JOIN scene ON scene.id = event.scene_id
        JOIN scene_character_mention AS mention ON mention.scene_id = scene.id
        JOIN character ON character.id = mention.character_id
        WHERE event.story_id = scene.story_id AND character.story_id = event.story_id
          AND event.sort_ordinal = scene.story_time_ordinal
          AND NOT mention.is_rejected AND mention.source IN ('manual', 'confirmed')
    """)


def downgrade() -> None:
    op.drop_table("event_character")
    op.drop_constraint("fk_event_location_id_location", "event", type_="foreignkey")
    op.drop_index("ix_event_location_id", table_name="event")
    op.drop_column("event", "location_id")
