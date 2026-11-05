"""Roadmap: planned Live design hints (built-in and custom checks on every Design level)."""

from alembic import op

revision = "d4a8b2c6e917"
down_revision = "c9e4f7a1d526"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO roadmap_item
            (id, created_at, updated_at, title, description, status, hero, delivered_on, sort_key)
        SELECT 'd4a8b2c6-e917-4f3a-9b5c-2e7d1a6f8c40', now(), now(),
            'Live design hints',
            'Advisory notes under each Design field a moment after you save it, for every level: '
                'premise, arc, characters, acts, beats, threads, chapters, scene cards, places '
                'and glossary. Built-in checks plus your own custom checks, which can read '
                'Design fields as well as prose. Flagged, never blocked.',
            'planned', false, NULL,
            (SELECT COALESCE(MAX(sort_key), 0) + 100 FROM roadmap_item)
        WHERE NOT EXISTS (SELECT 1 FROM roadmap_item WHERE lower(title) = 'live design hints')
    """)


def downgrade() -> None:
    op.execute("DELETE FROM roadmap_item WHERE id = 'd4a8b2c6-e917-4f3a-9b5c-2e7d1a6f8c40'")
