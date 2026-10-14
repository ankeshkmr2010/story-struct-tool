"""Durable image cleanup after permanent story deletion."""

import sqlalchemy as sa
from alembic import op

revision = "a9d3f1b6c802"
down_revision = "f7a2c9d5e801"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "image_deletion",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("bucket", sa.String(63), nullable=False),
        sa.Column("object_key", sa.String(300), nullable=False, unique=True),
    )


def downgrade():
    op.drop_table("image_deletion")
