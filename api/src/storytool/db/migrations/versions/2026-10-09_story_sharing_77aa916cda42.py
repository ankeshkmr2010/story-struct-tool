"""Email-scoped story sharing and explicit import permission."""

from alembic import op
import sqlalchemy as sa

revision = "77aa916cda42"
down_revision = "0b8d83e917a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "story_share",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("recipient_email", sa.String(320), nullable=False),
        sa.Column("allow_import", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["story.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", "recipient_email", name="uq_story_recipient"),
    )
    op.create_index("ix_story_share_story_id", "story_share", ["story_id"])
    op.create_index("ix_story_share_recipient_email", "story_share", ["recipient_email"])


def downgrade() -> None:
    op.drop_table("story_share")
