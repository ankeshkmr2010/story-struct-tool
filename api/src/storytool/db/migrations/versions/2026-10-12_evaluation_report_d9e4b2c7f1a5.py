"""Saved AI evaluation reports, one row per run."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d9e4b2c7f1a5"
down_revision = "c3f8a1d6e2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evaluation_report",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("evaluator_id", sa.String(64), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("base_fingerprint", sa.String(64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("verdicts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["story.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_evaluation_report_story_id", "evaluation_report", ["story_id"])


def downgrade() -> None:
    op.drop_index("ix_evaluation_report_story_id", table_name="evaluation_report")
    op.drop_table("evaluation_report")
