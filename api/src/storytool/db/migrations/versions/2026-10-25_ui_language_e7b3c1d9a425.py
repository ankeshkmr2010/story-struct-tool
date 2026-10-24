"""Interface language per account; null follows the browser."""

import sqlalchemy as sa
from alembic import op

revision = "e7b3c1d9a425"
down_revision = "d5f1a7b3c902"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("app_user", sa.Column("ui_language", sa.String(10), nullable=True))


def downgrade():
    op.drop_column("app_user", "ui_language")
