"""Setups and payoffs marked in the prose (narrative/models.py SetupMark, SetupLink). Empty by
default: rows exist only once the author or an agent marks a passage."""

import sqlalchemy as sa
from advanced_alchemy.types import GUID, DateTimeUTC
from alembic import op

revision = "e5a9c3d7f182"
down_revision = "d4e8b2f61a37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "setup_mark",
        sa.Column("scene_id", GUID(length=16), nullable=False),
        sa.Column("kind", sa.String(length=7), nullable=False),
        sa.Column("quote_text", sa.Text(), nullable=False),
        sa.Column("occurrence", sa.Integer(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["scene_id"],
            ["scene.id"],
            name=op.f("fk_setup_mark_scene_id_scene"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_setup_mark")),
    )
    op.create_index(op.f("ix_setup_mark_scene_id"), "setup_mark", ["scene_id"], unique=False)
    op.create_table(
        "setup_link",
        sa.Column("setup_id", GUID(length=16), nullable=False),
        sa.Column("payoff_id", GUID(length=16), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("id", GUID(length=16), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.Column("created_at", DateTimeUTC(timezone=True), nullable=False),
        sa.Column("updated_at", DateTimeUTC(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["setup_id"],
            ["setup_mark.id"],
            name=op.f("fk_setup_link_setup_id_setup_mark"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["payoff_id"],
            ["setup_mark.id"],
            name=op.f("fk_setup_link_payoff_id_setup_mark"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_setup_link")),
        sa.UniqueConstraint("setup_id", "payoff_id", name="one_link_per_pair"),
    )
    op.create_index(op.f("ix_setup_link_setup_id"), "setup_link", ["setup_id"], unique=False)
    op.create_index(op.f("ix_setup_link_payoff_id"), "setup_link", ["payoff_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_setup_link_payoff_id"), table_name="setup_link")
    op.drop_index(op.f("ix_setup_link_setup_id"), table_name="setup_link")
    op.drop_table("setup_link")
    op.drop_index(op.f("ix_setup_mark_scene_id"), table_name="setup_mark")
    op.drop_table("setup_mark")
