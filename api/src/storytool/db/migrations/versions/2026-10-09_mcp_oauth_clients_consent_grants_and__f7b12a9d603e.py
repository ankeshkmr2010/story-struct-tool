"""Persist MCP OAuth clients, consent, grants and hashed credentials."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f7b12a9d603e"
down_revision = "c91e45a79d22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mcp_oauth_client",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", sa.String(length=255), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mcp_oauth_client")),
        sa.UniqueConstraint("client_id", name=op.f("uq_mcp_oauth_client_client_id")),
    )
    op.create_table(
        "mcp_oauth_consent",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("client_id", sa.String(length=255), nullable=False),
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["mcp_oauth_client.client_id"],
            name=op.f("fk_mcp_oauth_consent_client_id_mcp_oauth_client"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mcp_oauth_consent")),
        sa.UniqueConstraint("request_hash", name=op.f("uq_mcp_oauth_consent_request_hash")),
    )
    op.create_table(
        "mcp_oauth_grant",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", sa.String(length=255), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("story_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scopes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["mcp_oauth_client.client_id"],
            name=op.f("fk_mcp_oauth_grant_client_id_mcp_oauth_client"),
        ),
        sa.ForeignKeyConstraint(
            ["story_id"],
            ["story.id"],
            name=op.f("fk_mcp_oauth_grant_story_id_story"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name=op.f("fk_mcp_oauth_grant_user_id_app_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mcp_oauth_grant")),
    )
    with op.batch_alter_table("mcp_oauth_grant", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_mcp_oauth_grant_story_id"), ["story_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_mcp_oauth_grant_user_id"), ["user_id"], unique=False)
    op.create_table(
        "mcp_oauth_token",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("grant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["grant_id"],
            ["mcp_oauth_grant.id"],
            name=op.f("fk_mcp_oauth_token_grant_id_mcp_oauth_grant"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mcp_oauth_token")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_mcp_oauth_token_token_hash")),
    )
    with op.batch_alter_table("mcp_oauth_token", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_mcp_oauth_token_grant_id"), ["grant_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("mcp_oauth_token", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_mcp_oauth_token_grant_id"))
    op.drop_table("mcp_oauth_token")
    with op.batch_alter_table("mcp_oauth_grant", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_mcp_oauth_grant_user_id"))
        batch_op.drop_index(batch_op.f("ix_mcp_oauth_grant_story_id"))
    op.drop_table("mcp_oauth_grant")
    op.drop_table("mcp_oauth_consent")
    op.drop_table("mcp_oauth_client")
