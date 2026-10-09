"""Separate reader-facing blurb from the working premise."""

import sqlalchemy as sa
from alembic import op

revision = "5a83b914e672"
down_revision = "91ea385fdd60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("story", sa.Column("blurb", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("story", "blurb")
