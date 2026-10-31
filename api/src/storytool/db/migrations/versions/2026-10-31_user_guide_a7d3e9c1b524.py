"""Teach-in-place state on the user: first-hour checklist and first-use tips."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a7d3e9c1b524"
down_revision = "f6c2a8d4e917"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "app_user",
        sa.Column(
            "guide", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
    )


def downgrade():
    op.drop_column("app_user", "guide")
