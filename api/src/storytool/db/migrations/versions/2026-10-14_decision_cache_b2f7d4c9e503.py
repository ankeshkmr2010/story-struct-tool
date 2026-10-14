"""Private typed-decision cache and shared-reader daily budgets."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "b2f7d4c9e503"
down_revision = "a9d3f1b6c802"
branch_labels = None
depends_on = None


def audit():
    return [
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
    ]


def upgrade():
    op.create_table(
        "decision_cache",
        *audit(),
        sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE")),
        sa.Column("answer", JSONB(), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_decision_cache_user_id", "decision_cache", ["user_id"])
    op.create_index("ix_decision_cache_expires_at", "decision_cache", ["expires_at"])
    op.create_table(
        "decision_budget",
        *audit(),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE")),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("minute", sa.DateTime(timezone=True), nullable=False),
        *(
            sa.Column(name, sa.Integer(), nullable=False)
            for name in [
                "minute_calls",
                "calls",
                "reserved_tokens",
                "input_tokens",
                "failures",
                "latency_ms",
            ]
        ),
        sa.UniqueConstraint("actor", "day", name="one_decision_budget_per_day"),
    )
    op.create_index("ix_decision_budget_user_id", "decision_budget", ["user_id"])


def downgrade():
    op.drop_table("decision_budget")
    op.drop_table("decision_cache")
