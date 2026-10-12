"""Separate export byline from the Google profile name."""

import sqlalchemy as sa
from alembic import op

revision = "b6f0d8a2c413"
down_revision = "a4e8c2d6f901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_user", sa.Column("author_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("app_user", "author_name")
