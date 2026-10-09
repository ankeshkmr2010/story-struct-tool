"""Allow explicit OAuth library grants without a selected story."""

from alembic import op
import sqlalchemy as sa

revision = "0b8d83e917a4"
down_revision = "f7b12a9d603e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("mcp_oauth_grant", "story_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    # Remove library grants (and cascaded credentials) before restoring the old constraint.
    op.execute("DELETE FROM mcp_oauth_grant WHERE story_id IS NULL")
    op.alter_column("mcp_oauth_grant", "story_id", existing_type=sa.UUID(), nullable=False)
