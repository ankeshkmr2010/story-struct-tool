"""Opt-in public showcase links, one random token per story."""

import sqlalchemy as sa
from alembic import op

revision = "e4c1a9b27d50"
down_revision = "6c842a719f30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "story_showcase",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["story.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", name="uq_story_showcase_story_id"),
        sa.UniqueConstraint("token", name="uq_story_showcase_token"),
    )


def downgrade() -> None:
    op.drop_table("story_showcase")
