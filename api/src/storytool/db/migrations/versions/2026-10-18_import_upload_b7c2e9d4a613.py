"""Short-lived manuscript uploads, so an author (or their AI) can inspect and plan an import."""

import sqlalchemy as sa
from alembic import op

revision = "b7c2e9d4a613"
down_revision = "a1d5e7c3b902"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "import_upload",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("app_user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("format", sa.String(20), nullable=False),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "story_id", sa.UUID(), sa.ForeignKey("story.id", ondelete="SET NULL"), nullable=True
        ),
    )


def downgrade():
    op.drop_table("import_upload")
