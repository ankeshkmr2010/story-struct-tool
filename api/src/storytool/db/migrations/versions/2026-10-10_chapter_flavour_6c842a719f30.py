"""Optional reader-facing chapter epigraph, opening and closing notes."""

import sqlalchemy as sa
from alembic import op

revision = "6c842a719f30"
down_revision = "d17e48c95a32"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for field in ("epigraph", "opening_note", "closing_note"):
        op.add_column("chapter", sa.Column(field, sa.Text(), nullable=True))


def downgrade() -> None:
    for field in ("epigraph", "opening_note", "closing_note"):
        op.drop_column("chapter", field)
