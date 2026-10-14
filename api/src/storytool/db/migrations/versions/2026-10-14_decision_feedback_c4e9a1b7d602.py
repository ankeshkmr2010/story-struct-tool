"""Derived decision feedback and cache ownership metadata."""

import sqlalchemy as sa
from alembic import op

revision = "c4e9a1b7d602"
down_revision = "b2f7d4c9e503"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("decision_cache", sa.Column("actor_key", sa.String(64)))
    op.add_column("decision_cache", sa.Column("provider", sa.String(200)))
    op.create_table(
        "decision_feedback",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column("actor_key", sa.String(64), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE")),
        sa.Column("unit", sa.String(64), nullable=False),
        sa.Column("check_code", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(200), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("rubric_version", sa.String(40), nullable=False),
        sa.Column("probability", sa.Float(), nullable=False),
        sa.Column("accepted", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("actor_key", "unit", "check_code", name="one_decision_label"),
    )
    op.create_index("ix_decision_feedback_user_id", "decision_feedback", ["user_id"])


def downgrade():
    op.drop_table("decision_feedback")
    op.drop_column("decision_cache", "provider")
    op.drop_column("decision_cache", "actor_key")
