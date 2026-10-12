"""Optional MICE category on threads, read only by the on-demand evaluator."""

import sqlalchemy as sa
from alembic import op

revision = "c3f8a1d6e2b4"
down_revision = "b7d2e5f1a3c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("thread", sa.Column("mice", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("thread", "mice")
