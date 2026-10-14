"""Private typed validator definitions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d7a2c9e5f103"
down_revision = "c4e9a1b7d602"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "decision_validator",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("definition", postgresql.JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("definition_hash", sa.String(64), nullable=False),
    )
    op.create_index("ix_decision_validator_user_id", "decision_validator", ["user_id"])


def downgrade():
    op.drop_table("decision_validator")
