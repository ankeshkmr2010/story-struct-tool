"""Version-bound beta readers, private conversations and reader polls."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "c8a6e4f2d901"
down_revision = "e2c1a7b9d406"
branch_labels = None
depends_on = None


def audit() -> list[sa.Column]:
    return [
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
    ]


def fk(name: str, target: str, nullable: bool = False, ondelete: str = "CASCADE") -> sa.Column:
    return sa.Column(name, sa.UUID(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    op.create_table("beta_round", *audit(), fk("story_id", "story.id"),
        sa.Column("title", sa.String(200), nullable=False), sa.Column("brief", sa.Text(), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True)), sa.Column("status", sa.String(20), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False), sa.Column("source_fingerprint", sa.String(64), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("link_enabled", sa.Boolean(), nullable=False), sa.Column("auto_approve", sa.Boolean(), nullable=False))
    op.create_index("ix_beta_round_story_id", "beta_round", ["story_id"])
    op.create_table("beta_member", *audit(), fk("round_id", "beta_round.id"), fk("user_id", "app_user.id"),
        sa.Column("status", sa.String(20), nullable=False), sa.Column("read_chapters", JSONB(), nullable=False),
        sa.Column("reading_status", sa.String(20), nullable=False), sa.Column("stopped_reason", sa.Text()),
        sa.UniqueConstraint("round_id", "user_id", name="one_beta_member"))
    op.create_index("ix_beta_member_round_id", "beta_member", ["round_id"])
    op.create_table("beta_thread", *audit(), fk("round_id", "beta_round.id"), fk("reader_id", "app_user.id", True, "SET NULL"),
        sa.Column("chapter_id", sa.UUID()), sa.Column("scene_id", sa.UUID()), sa.Column("quote", sa.Text()),
        sa.Column("paragraph", sa.Integer()), sa.Column("prose_hash", sa.String(64)),
        sa.Column("submitted", sa.Boolean(), nullable=False), sa.Column("resolved", sa.Boolean(), nullable=False))
    op.create_index("ix_beta_thread_round_id", "beta_thread", ["round_id"])
    op.create_table("beta_message", *audit(), fk("thread_id", "beta_thread.id"), fk("user_id", "app_user.id", True, "SET NULL"),
        sa.Column("name", sa.String(300), nullable=False), sa.Column("body", sa.Text(), nullable=False),
        sa.Column("submitted", sa.Boolean(), nullable=False), sa.Column("deleted", sa.Boolean(), nullable=False))
    op.create_index("ix_beta_message_thread_id", "beta_message", ["thread_id"])
    op.create_table("beta_poll", *audit(), fk("round_id", "beta_round.id"),
        sa.Column("chapter_id", sa.UUID()), sa.Column("question", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False), sa.Column("options", JSONB(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False), sa.Column("show_results", sa.Boolean(), nullable=False),
        sa.Column("anonymous", sa.Boolean(), nullable=False), sa.Column("version", sa.Integer(), nullable=False),
        fk("previous_id", "beta_poll.id", True, "SET NULL"))
    op.create_index("ix_beta_poll_round_id", "beta_poll", ["round_id"])
    op.create_table("beta_vote", *audit(), fk("poll_id", "beta_poll.id"), fk("user_id", "app_user.id", True, "SET NULL"),
        sa.Column("choices", JSONB(), nullable=False), sa.Column("answer", sa.Text(), nullable=False),
        sa.UniqueConstraint("poll_id", "user_id", name="one_beta_vote"))
    op.create_index("ix_beta_vote_poll_id", "beta_vote", ["poll_id"])


def downgrade() -> None:
    for name in ("beta_vote", "beta_poll", "beta_message", "beta_thread", "beta_member", "beta_round"):
        op.drop_table(name)
