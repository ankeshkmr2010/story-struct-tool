"""Stored speakers for quoted lines (narrative/models.py DialogueSpeaker). Empty by default:
nothing is filled until a code or reader pass, an agent or the author sets a speaker."""

import sqlalchemy as sa
from advanced_alchemy.types import GUID, DateTimeUTC
from alembic import op

revision = "d4e8b2f61a37"
down_revision = "c3f7a1d9e264"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dialogue_speaker",
        sa.Column("scene_id", GUID(length=16), nullable=False),
        sa.Column("quote_text", sa.Text(), nullable=False),
        sa.Column("occurrence", sa.Integer(), nullable=False),
        sa.Column("character_id", GUID(length=16), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["character.id"],
            name=op.f("fk_dialogue_speaker_character_id_character"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["scene_id"],
            ["scene.id"],
            name=op.f("fk_dialogue_speaker_scene_id_scene"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dialogue_speaker")),
    )
    op.create_index(
        op.f("ix_dialogue_speaker_scene_id"), "dialogue_speaker", ["scene_id"], unique=False
    )
    op.create_index(
        op.f("ix_dialogue_speaker_character_id"), "dialogue_speaker", ["character_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_dialogue_speaker_character_id"), table_name="dialogue_speaker")
    op.drop_index(op.f("ix_dialogue_speaker_scene_id"), table_name="dialogue_speaker")
    op.drop_table("dialogue_speaker")
