"""Plain reference fields, notes, world/style/theme, and private field authorship."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "91ea385fdd60"
down_revision = "77aa916cda42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("description", "relation_to_protagonist", "notes"):
        op.add_column("character", sa.Column(name, sa.Text(), nullable=True))
    op.add_column("character", sa.Column("aliases", postgresql.JSONB(), nullable=True))
    for name in ("thematic_statement", "notes"):
        op.add_column("story", sa.Column(name, sa.Text(), nullable=True))
    for name in ("world_rules", "style_rules", "motifs"):
        op.add_column("story", sa.Column(name, postgresql.JSONB(), nullable=True))
    op.add_column("scene", sa.Column("notes", sa.Text(), nullable=True))
    op.create_table(
        "field_authorship",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("story_id", sa.UUID(), nullable=False),
        sa.Column("entity_type", sa.String(40), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=False),
        sa.Column("field", sa.String(100), nullable=False),
        sa.Column("origin", sa.String(30), nullable=False),
        sa.Column("actor_label", sa.String(200), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["story.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["app_user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_field_authorship_story_id", "field_authorship", ["story_id"])
    op.create_index("ix_field_authorship_entity_id", "field_authorship", ["entity_id"])


def downgrade() -> None:
    op.drop_table("field_authorship")
    op.drop_column("scene", "notes")
    for name in ("thematic_statement", "notes", "world_rules", "style_rules", "motifs"):
        op.drop_column("story", name)
    for name in ("description", "relation_to_protagonist", "notes", "aliases"):
        op.drop_column("character", name)
