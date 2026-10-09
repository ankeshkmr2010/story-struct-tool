"""Story terminology and the scene where it is first explained."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d17e48c95a32"
down_revision = "5a83b914e672"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "glossary_entry",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("term", sa.String(200), nullable=False),
        sa.Column("aliases", postgresql.JSONB(), nullable=True),
        sa.Column("definition", sa.Text(), nullable=True),
        sa.Column("first_explained_scene_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["story.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["first_explained_scene_id"], ["scene.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_glossary_entry_story_id", "glossary_entry", ["story_id"])


def downgrade() -> None:
    op.drop_table("glossary_entry")
