"""Writing language for accounts and stories, and kept consistency variants per story."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4e8a1f6d209"
down_revision = "b7c2e9d4a613"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "app_user",
        sa.Column("language", sa.String(10), nullable=False, server_default="en-US"),
    )
    op.add_column("story", sa.Column("language", sa.String(10), nullable=True))
    op.add_column("story", sa.Column("consistency_exceptions", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("story", "consistency_exceptions")
    op.drop_column("story", "language")
    op.drop_column("app_user", "language")
