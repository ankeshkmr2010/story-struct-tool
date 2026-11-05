"""Roadmap: Live design hints delivered (built-in and custom checks under Design fields)."""

from alembic import op

revision = "f3c9a1e7b285"
down_revision = "e2b7c9d4f051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE roadmap_item SET status = 'delivered', delivered_on = DATE '2026-11-06',
            description = 'Turn on Live design hints in the Hints panel: a moment after you save '
                'a Design field, the shared reader notes possible gaps under that field, for the '
                'premise, characters, acts, beats, threads, chapters, scene cards, places and '
                'glossary. Your own checks can read Design fields too. Flagged, never blocked.',
            updated_at = now()
        WHERE lower(title) = 'live design hints' AND status <> 'delivered'
    """)


def downgrade() -> None:
    # Do not undo later author edits to the roadmap.
    pass
