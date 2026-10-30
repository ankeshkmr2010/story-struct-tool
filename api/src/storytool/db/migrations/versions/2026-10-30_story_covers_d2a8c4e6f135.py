"""Book covers and jackets: an image role, its crop focus and public visibility."""

import sqlalchemy as sa
from alembic import op

revision = "d2a8c4e6f135"
down_revision = "c7d1e9f3a284"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("story_image", sa.Column("role", sa.String(10), nullable=True))
    op.add_column(
        "story_image", sa.Column("focus_x", sa.Float(), nullable=False, server_default="0.5")
    )
    op.add_column(
        "story_image", sa.Column("focus_y", sa.Float(), nullable=False, server_default="0.5")
    )
    op.add_column(
        "story_image",
        sa.Column("show_public", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    for column in ("show_public", "focus_y", "focus_x", "role"):
        op.drop_column("story_image", column)
