"""Preserve deleted stories and their full version history in Trash."""

import sqlalchemy as sa
from alembic import op

revision = "c91e45a79d22"
down_revision = "a3b47d98e612"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("story", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_story_deleted_at", "story", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_story_deleted_at", table_name="story")
    op.drop_column("story", "deleted_at")
