"""Per-story Design view choices: show every tool, show every ladder level (null = by story age)."""

import sqlalchemy as sa
from alembic import op

revision = "f6c2a8d4e917"
down_revision = "e5b9d3a7c214"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("library_card", sa.Column("show_all_tools", sa.Boolean(), nullable=True))
    op.add_column("library_card", sa.Column("full_ladder", sa.Boolean(), nullable=True))


def downgrade():
    op.drop_column("library_card", "full_ladder")
    op.drop_column("library_card", "show_all_tools")
