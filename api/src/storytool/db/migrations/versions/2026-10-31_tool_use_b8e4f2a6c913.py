"""First-run measures: which workspace tools each account opened, first and last time."""

import sqlalchemy as sa
from alembic import op

revision = "b8e4f2a6c913"
down_revision = "a7d3e9c1b524"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tool_use",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("tool", sa.String(30), nullable=False),
        sa.Column("sessions", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["app_user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "tool", name="one_tool_use"),
    )
    op.create_index("ix_tool_use_user_id", "tool_use", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_tool_use_user_id", table_name="tool_use")
    op.drop_table("tool_use")
