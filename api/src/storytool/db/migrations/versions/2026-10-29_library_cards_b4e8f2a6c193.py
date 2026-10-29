"""Your stories: per-account card arrangement and a daily writing tally."""

import sqlalchemy as sa
from alembic import op

revision = "b4e8f2a6c193"
down_revision = "e7b3c1d9a425"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "library_card",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("position", sa.Float(), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("user_id", "story_id", name="one_card_per_story"),
    )
    op.create_index("ix_library_card_user_id", "library_card", ["user_id"])
    op.create_table(
        "writing_day",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("words", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sessions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_save_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "day", name="one_tally_per_day"),
    )
    op.create_index("ix_writing_day_user_id", "writing_day", ["user_id"])


def downgrade():
    op.drop_table("writing_day")
    op.drop_table("library_card")
