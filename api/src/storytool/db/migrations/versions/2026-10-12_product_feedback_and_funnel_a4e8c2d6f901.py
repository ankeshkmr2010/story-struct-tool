"""Private product feedback and minimal funnel milestones."""

import sqlalchemy as sa
from alembic import op

revision = "a4e8c2d6f901"
down_revision = "d9e4b2c7f1a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_feedback",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["app_user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_product_feedback_user_id", "product_feedback", ["user_id"])
    op.create_table(
        "funnel_event",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("subject_id", sa.UUID(), nullable=False),
        sa.Column("visitor_id", sa.UUID(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["app_user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "subject_id", name="one_funnel_milestone"),
    )


def downgrade() -> None:
    op.drop_table("funnel_event")
    op.drop_index("ix_product_feedback_user_id", table_name="product_feedback")
    op.drop_table("product_feedback")
