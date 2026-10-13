"""Optional semantic search storage; feature remains disabled by default."""

import sqlalchemy as sa
from alembic import op

from storytool.domain.search.models import Vector

revision = "e2c1a7b9d406"
down_revision = "b6f0d8a2c413"
branch_labels = None
depends_on = None


def audit_columns() -> list[sa.Column]:
    return [
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "search_chunk",
        *audit_columns(),
        sa.Column(
            "story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("entity", sa.String(40), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=False),
        sa.Column("field", sa.String(60), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("profile", sa.String(64), nullable=False),
        sa.Column("embedding", Vector(), nullable=False),
    )
    op.create_index("ix_search_chunk_story_id", "search_chunk", ["story_id"])
    op.create_table(
        "search_index",
        *audit_columns(),
        sa.Column(
            "story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("profile", sa.String(64), nullable=False),
        sa.UniqueConstraint("story_id", name="one_search_index_per_story"),
    )


def downgrade() -> None:
    op.drop_table("search_index")
    op.drop_table("search_chunk")
