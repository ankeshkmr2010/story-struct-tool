"""Private cross-device workspace positions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e8b3d0a6f214"
down_revision = "d7a2c9e5f103"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workspace_position",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("position", postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint("user_id", "story_id"),
    )


def downgrade():
    op.drop_table("workspace_position")
