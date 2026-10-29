"""Writing goals: a daily habit per account, a target per story, per-story tallies, sprints."""

import sqlalchemy as sa
from alembic import op

revision = "c7d1e9f3a284"
down_revision = "b4e8f2a6c193"
branch_labels = None
depends_on = None


def _base():
    return [
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer()),
    ]


def _user():
    return sa.Column(
        "user_id", sa.UUID(), sa.ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )


def _story(**kwargs):
    return sa.Column(
        "story_id",
        sa.UUID(),
        sa.ForeignKey("story.id", ondelete="CASCADE"),
        nullable=False,
        **kwargs,
    )


def upgrade():
    op.add_column(
        "writing_day", sa.Column("ai_words", sa.Integer(), nullable=False, server_default="0")
    )
    op.create_table(
        "writing_goal",
        *_base(),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("app_user.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("daily_words", sa.Integer(), nullable=True),
        sa.Column("writing_days", sa.Integer(), nullable=False, server_default="127"),
        sa.Column("forgive_missed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("count_ai", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
    )
    op.create_table(
        "story_goal",
        *_base(),
        _user(),
        _story(unique=True),
        sa.Column("target_words", sa.Integer(), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("daily_words", sa.Integer(), nullable=True),
        sa.Column("baseline_words", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("start_day", sa.Date(), nullable=False),
    )
    op.create_table(
        "story_day",
        *_base(),
        _user(),
        _story(),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("words", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ai_words", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("story_id", "day", name="one_story_tally_per_day"),
    )
    op.create_index("ix_story_day_user_id", "story_day", ["user_id"])
    op.create_table(
        "writing_sprint",
        *_base(),
        _user(),
        _story(),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("target_words", sa.Integer(), nullable=True),
        sa.Column("words", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_writing_sprint_user_id", "writing_sprint", ["user_id"])


def downgrade():
    op.drop_table("writing_sprint")
    op.drop_table("story_day")
    op.drop_table("story_goal")
    op.drop_table("writing_goal")
    op.drop_column("writing_day", "ai_words")
