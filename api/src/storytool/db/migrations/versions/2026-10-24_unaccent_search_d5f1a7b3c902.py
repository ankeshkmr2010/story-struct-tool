"""Accent-insensitive text search: "Jose" finds "José"."""

from alembic import op

revision = "d5f1a7b3c902"
down_revision = "c4e8a1f6d209"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade():
    op.execute("DROP EXTENSION IF EXISTS unaccent")
