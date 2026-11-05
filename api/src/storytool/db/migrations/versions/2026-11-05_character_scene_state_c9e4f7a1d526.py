"""Scene-by-scene character arc states (narrative/models.py CharacterSceneState). Empty by
default: rows exist only once the author or an agent records a state."""

import sqlalchemy as sa
from advanced_alchemy.types import GUID, DateTimeUTC
from alembic import op

revision = "c9e4f7a1d526"
down_revision = "b8d3e6f0c415"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "character_scene_state",
        sa.Column("scene_id", GUID(length=16), nullable=False),
        sa.Column("character_id", GUID(length=16), nullable=False),
        sa.Column("misbelief", sa.String(length=10), nullable=True),
        sa.Column("want", sa.String(length=10), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["scene_id"],
            ["scene.id"],
            name=op.f("fk_character_scene_state_scene_id_scene"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["character.id"],
            name=op.f("fk_character_scene_state_character_id_character"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_character_scene_state")),
        sa.UniqueConstraint("scene_id", "character_id", name="one_state_per_scene"),
    )
    op.create_index(
        op.f("ix_character_scene_state_scene_id"), "character_scene_state", ["scene_id"]
    )
    op.create_index(
        op.f("ix_character_scene_state_character_id"), "character_scene_state", ["character_id"]
    )
    op.execute("""
        UPDATE roadmap_item SET status = 'delivered', delivered_on = DATE '2026-11-05',
            description = 'Record where each character''s misbelief and want stand scene by '
                'scene in Design. A craft check flags arcs that stall, turn off the page or '
                'never resolve. A connected AI can suggest states for you to accept.',
            updated_at = now()
        WHERE lower(title) = 'character arcs' AND status <> 'delivered'
    """)


def downgrade() -> None:
    op.drop_table("character_scene_state")
