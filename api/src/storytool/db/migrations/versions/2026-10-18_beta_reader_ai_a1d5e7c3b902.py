"""Beta-reader AI access: an author opt-in per round, and round-scoped MCP grants."""

import sqlalchemy as sa
from alembic import op

revision = "a1d5e7c3b902"
down_revision = "f9c4e1b7a325"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "beta_round",
        sa.Column("allow_reader_ai", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "mcp_oauth_grant",
        sa.Column(
            "round_id",
            sa.UUID(),
            sa.ForeignKey("beta_round.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("mcp_oauth_grant", "round_id")
    op.drop_column("beta_round", "allow_reader_ai")
