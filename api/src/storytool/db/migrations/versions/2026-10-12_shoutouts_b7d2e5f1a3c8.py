"""Shoutouts on the /thanks page, editable by the site owner. Seeds the original six."""

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "b7d2e5f1a3c8"
down_revision = "e4c1a9b27d50"
branch_labels = None
depends_on = None

SEED = [
    (
        "Madam Stuti Dutta",
        "The wife (for health and legal reasons she has to be first). "
        "Great feedback and encouragement.",
        "rose",
        "👑",
    ),
    ("Nikhil Doshi", "The first reviewer. He actually wrote something.", "amber", "✍️"),
    ("Saransh Sharma", "The most “author” review.", "emerald", "📚"),
    (
        "Hena Varma",
        "For the very encouraging and positive feedback and comprehensive feedback.",
        "sky",
        "🌟",
    ),
    ("Ananya", "The positive vibes.", "lime", "✨"),
    (
        "Aditya Bhatia",
        "The first person I bounced this idea off. "
        "(Last on the list: he has the most time and still hasn't reviewed it.)",
        "slate",
        "⏳",
    ),
]


def upgrade() -> None:
    table = op.create_table(
        "shoutout",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("thanks", sa.Text(), nullable=False),
        sa.Column("colour", sa.String(20), nullable=False),
        sa.Column("mark", sa.String(16), nullable=False),
        sa.Column("sort_key", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sa_orm_sentinel", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    now = datetime.now(UTC)
    op.bulk_insert(
        table,
        [
            {
                "id": uuid.uuid4(),
                "name": name,
                "thanks": thanks,
                "colour": colour,
                "mark": mark,
                "sort_key": (index + 1) * 100.0,
                "created_at": now,
                "updated_at": now,
            }
            for index, (name, thanks, colour, mark) in enumerate(SEED)
        ],
    )


def downgrade() -> None:
    op.drop_table("shoutout")
