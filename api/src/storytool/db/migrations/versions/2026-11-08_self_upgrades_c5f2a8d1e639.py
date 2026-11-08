"""Self-serve upgrades: tier listing fields, subscriptions and checkouts (domain/plans)."""

import sqlalchemy as sa
from advanced_alchemy.types import GUID, DateTimeUTC
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c5f2a8d1e639"
down_revision = "b3e8f1a6d257"
branch_labels = None
depends_on = None


def _base() -> list[sa.Column]:
    return [
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
    ]


def _fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        [f"{target}.id"],
        name=op.f(f"fk_{table}_{column}_{target}"),
        ondelete=ondelete,
    )


def upgrade() -> None:
    op.add_column(
        "access_tier",
        sa.Column("self_serve", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column("access_tier", sa.Column("price_note", sa.String(length=120), nullable=True))
    op.add_column(
        "access_tier",
        sa.Column(
            "durations",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[1, 3, 6, 12]",
            nullable=False,
        ),
    )
    op.create_table(
        "subscription",
        sa.Column("user_id", GUID(length=16), nullable=False),
        sa.Column("tier_id", GUID(length=16), nullable=True),
        sa.Column("starts_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("ends_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        *_base(),
        _fk("subscription", "user_id", "app_user", "CASCADE"),
        _fk("subscription", "tier_id", "access_tier", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscription")),
    )
    op.create_index(op.f("ix_subscription_user_id"), "subscription", ["user_id"])
    op.create_index(op.f("ix_subscription_tier_id"), "subscription", ["tier_id"])
    op.create_table(
        "checkout",
        sa.Column("user_id", GUID(length=16), nullable=False),
        sa.Column("tier_id", GUID(length=16), nullable=True),
        sa.Column("tier_key", sa.String(length=40), nullable=False),
        sa.Column("tier_name", sa.String(length=80), nullable=False),
        sa.Column("months", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("expires_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("subscription_id", GUID(length=16), nullable=True),
        *_base(),
        _fk("checkout", "user_id", "app_user", "CASCADE"),
        _fk("checkout", "tier_id", "access_tier", "SET NULL"),
        _fk("checkout", "subscription_id", "subscription", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_checkout")),
    )
    op.create_index(op.f("ix_checkout_user_id"), "checkout", ["user_id"])


def downgrade() -> None:
    op.drop_table("checkout")
    op.drop_table("subscription")
    op.drop_column("access_tier", "durations")
    op.drop_column("access_tier", "price_note")
    op.drop_column("access_tier", "self_serve")
