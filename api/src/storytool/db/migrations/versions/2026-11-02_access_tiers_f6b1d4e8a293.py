"""Access tiers, account groups, per-account access and their change history (domain/plans).
Empty by default: with no tier or override, every account keeps full access."""

import sqlalchemy as sa
from advanced_alchemy.types import GUID, DateTimeUTC
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f6b1d4e8a293"
down_revision = "e5a9c3d7f182"
branch_labels = None
depends_on = None


def _base() -> list[sa.Column]:
    return [
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
    ]


def _json(name: str) -> sa.Column:
    return sa.Column(
        name, postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "access_tier",
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        _json("features"),
        _json("limits"),
        *_base(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_access_tier")),
        sa.UniqueConstraint("key", name=op.f("uq_access_tier_key")),
    )
    op.create_table(
        "account_group",
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("tier_id", GUID(length=16), nullable=True),
        sa.Column("seats", sa.Integer(), nullable=True),
        sa.Column("expires_at", DateTimeUTC(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        *_base(),
        sa.ForeignKeyConstraint(
            ["tier_id"],
            ["access_tier.id"],
            name=op.f("fk_account_group_tier_id_access_tier"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_group")),
    )
    op.create_index(op.f("ix_account_group_tier_id"), "account_group", ["tier_id"])
    op.create_table(
        "account_group_member",
        sa.Column("group_id", GUID(length=16), nullable=False),
        sa.Column("user_id", GUID(length=16), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        *_base(),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["account_group.id"],
            name=op.f("fk_account_group_member_group_id_account_group"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name=op.f("fk_account_group_member_user_id_app_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_group_member")),
        sa.UniqueConstraint("group_id", "user_id", name="one_membership"),
    )
    op.create_index(op.f("ix_account_group_member_group_id"), "account_group_member", ["group_id"])
    op.create_index(op.f("ix_account_group_member_user_id"), "account_group_member", ["user_id"])
    op.create_table(
        "account_access",
        sa.Column("user_id", GUID(length=16), nullable=False),
        sa.Column("tier_id", GUID(length=16), nullable=True),
        sa.Column("tier_expires_at", DateTimeUTC(timezone=True), nullable=True),
        _json("features"),
        _json("limits"),
        sa.Column("note", sa.String(length=500), nullable=True),
        *_base(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name=op.f("fk_account_access_user_id_app_user"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tier_id"],
            ["access_tier.id"],
            name=op.f("fk_account_access_tier_id_access_tier"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_access")),
        sa.UniqueConstraint("user_id", name=op.f("uq_account_access_user_id")),
    )
    op.create_index(op.f("ix_account_access_tier_id"), "account_access", ["tier_id"])
    op.create_table(
        "access_change",
        sa.Column("actor_id", GUID(length=16), nullable=True),
        sa.Column("subject", sa.String(length=20), nullable=False),
        sa.Column("subject_id", GUID(length=16), nullable=True),
        sa.Column("change", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        *_base(),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["app_user.id"],
            name=op.f("fk_access_change_actor_id_app_user"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_access_change")),
    )
    op.create_index(op.f("ix_access_change_actor_id"), "access_change", ["actor_id"])
    op.create_index(op.f("ix_access_change_subject_id"), "access_change", ["subject_id"])


def downgrade() -> None:
    op.drop_table("access_change")
    op.drop_table("account_access")
    op.drop_table("account_group_member")
    op.drop_table("account_group")
    op.drop_table("access_tier")
