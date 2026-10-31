"""Story text encrypted at rest (db/encryption.py): widen encrypted VARCHAR columns to TEXT,
since ciphertext is longer than the plain value, and drop the location-name unique constraint,
which cannot compare ciphertext (the API checks duplicates instead). No data is encrypted here."""

import sqlalchemy as sa
from alembic import op

revision = "c3f7a1d9e264"
down_revision = "b8e4f2a6c913"
branch_labels = None
depends_on = None

# (table, column, previous VARCHAR length)
WIDENED = [
    ("thread", "title", 200),
    ("arc_stage", "label", 200),
    ("story_image", "name", 200),
    ("story_image", "alt", 500),
    ("story_image", "caption", 1000),
    ("location", "name", 200),
    ("glossary_entry", "term", 200),
    ("event", "label", 300),
    ("event", "display_label", 200),
    ("act", "title", 200),
    ("act", "emotional_shift_from", 120),
    ("act", "emotional_shift_to", 120),
    ("beta_round", "title", 200),
    ("beta_message", "name", 300),
    ("scene_revision", "label", 200),
    ("story", "title", 300),
    ("story", "genre", 120),
    ("character", "name", 200),
    ("beat", "label", 200),
    ("story_version", "label", 200),
    ("chapter", "title", 200),
    ("chapter", "emotional_shift_from", 120),
    ("chapter", "emotional_shift_to", 120),
    ("scene", "title", 200),
    ("scene", "location", 200),
    ("scene", "time_label", 200),
    ("scene", "emotional_value_from", 120),
    ("scene", "emotional_value_to", 120),
]


def upgrade() -> None:
    for table, column, _ in WIDENED:
        op.alter_column(table, column, type_=sa.Text(), existing_nullable=None)
    op.drop_constraint("one_name_per_story", "location", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("one_name_per_story", "location", ["story_id", "name"])
    for table, column, length in WIDENED:
        op.alter_column(table, column, type_=sa.String(length))
