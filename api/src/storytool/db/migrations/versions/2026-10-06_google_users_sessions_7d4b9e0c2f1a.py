"""Add Google users and server-side login sessions.

Revision ID: 7d4b9e0c2f1a
Revises: 56e8b177969b
"""

import sqlalchemy as sa
from advanced_alchemy.types import DateTimeUTC, GUID
from alembic import op

revision = "7d4b9e0c2f1a"
down_revision = "56e8b177969b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_user",
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("google_sub", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(300), nullable=True),
        sa.Column("picture_url", sa.String(1000), nullable=True),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_app_user"),
    )
    op.create_index("ix_app_user_google_sub", "app_user", ["google_sub"], unique=True)
    op.create_index("ix_app_user_email", "app_user", ["email"])

    op.create_table(
        "user_session",
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("user_id", GUID(length=16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_user.id"], ondelete="CASCADE", name="fk_user_session_user_id_app_user"),
        sa.PrimaryKeyConstraint("id", name="pk_user_session"),
        sa.UniqueConstraint("token_hash", name="uq_user_session_token_hash"),
    )
    op.create_index("ix_user_session_user_id", "user_session", ["user_id"])
    op.create_index("ix_user_session_expires_at", "user_session", ["expires_at"])
    op.create_foreign_key("fk_story_user_id_app_user", "story", "app_user", ["user_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_story_user_id_app_user", "story", type_="foreignkey")
    op.drop_index("ix_user_session_expires_at", table_name="user_session")
    op.drop_index("ix_user_session_user_id", table_name="user_session")
    op.drop_table("user_session")
    op.drop_index("ix_app_user_email", table_name="app_user")
    op.drop_index("ix_app_user_google_sub", table_name="app_user")
    op.drop_table("app_user")
