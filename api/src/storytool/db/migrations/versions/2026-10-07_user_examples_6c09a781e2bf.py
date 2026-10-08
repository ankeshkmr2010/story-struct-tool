"""Remember whether an account has received its starter examples.

Revision ID: 6c09a781e2bf
Revises: 38c7a01e9d42
"""

import sqlalchemy as sa
from alembic import op

revision = "6c09a781e2bf"
down_revision = "38c7a01e9d42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_user", sa.Column("examples_seed_version", sa.Integer(), nullable=False,
                                       server_default="0"))


def downgrade() -> None:
    op.drop_column("app_user", "examples_seed_version")
