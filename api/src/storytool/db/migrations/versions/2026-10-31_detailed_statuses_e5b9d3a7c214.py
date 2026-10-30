"""Scene statuses per account: existing accounts keep the detailed set, new ones start simple."""

import sqlalchemy as sa
from alembic import op

revision = "e5b9d3a7c214"
down_revision = "d2a8c4e6f135"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "app_user",
        sa.Column("detailed_statuses", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # Rows created from now on get the simple set unless the app says otherwise.
    op.alter_column("app_user", "detailed_statuses", server_default=sa.false())


def downgrade():
    op.drop_column("app_user", "detailed_statuses")
