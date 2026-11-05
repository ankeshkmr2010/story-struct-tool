"""Roadmap: delivered consistent word counts (audit F-010)."""

from alembic import op

revision = "e2b7c9d4f051"
down_revision = "d4a8b2c6e917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO roadmap_item
            (id, created_at, updated_at, title, description, status, hero, delivered_on, sort_key)
        SELECT 'e2b7c9d4-f051-4c6a-8d3e-7a1b5f9c2e48', now(), now(),
            'Consistent word counts',
            'The Write editor and the import file check now count words the same way as the '
                'story header, footer and library: dashes and formatting marks are not words.',
            'delivered', false, DATE '2026-11-05', 0
        WHERE NOT EXISTS (SELECT 1 FROM roadmap_item WHERE lower(title) = 'consistent word counts')
    """)


def downgrade() -> None:
    op.execute("DELETE FROM roadmap_item WHERE id = 'e2b7c9d4-f051-4c6a-8d3e-7a1b5f9c2e48'")
