"""Private image storage and versioned image attachments."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "f7a2c9d5e801"
down_revision = "c8a6e4f2d901"
branch_labels = None
depends_on = None


def audit():
    return [sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True)]


def upgrade():
    op.create_table("image_blob", *audit(),
        sa.Column("story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_key", sa.String(300), nullable=False, unique=True),
        sa.Column("mime", sa.String(30), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False))
    op.create_index("ix_image_blob_story_id", "image_blob", ["story_id"])
    op.create_table("story_image", *audit(),
        sa.Column("story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blob_id", sa.UUID(), sa.ForeignKey("image_blob.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("alt", sa.String(500), nullable=False),
        sa.Column("caption", sa.String(1000), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("attachments", JSONB(), nullable=False))
    op.create_index("ix_story_image_story_id", "story_image", ["story_id"])


def downgrade():
    op.drop_table("story_image")
    op.drop_table("image_blob")
