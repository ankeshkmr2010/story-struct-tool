"""Immutable whole-story checkpoints.

Revision ID: a3b47d98e612
Revises: 344a6443ea7d
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a3b47d98e612"
down_revision = "344a6443ea7d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "story_version",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("story_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column("state", postgresql.JSONB(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("statistics", postgresql.JSONB(), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.UniqueConstraint("story_id", "number", name="one_version_number_per_story"),
    )
    op.create_index("ix_story_version_story_id", "story_version", ["story_id"])
    op.create_index("ix_story_version_user_id", "story_version", ["user_id"])


def downgrade() -> None:
    op.drop_table("story_version")
