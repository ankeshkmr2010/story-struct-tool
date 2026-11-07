"""Roadmap: Story-language AI reading delivered (the shared reader is told the story's language)."""

from alembic import op

revision = "a7d2e5c8b914"
down_revision = "f3c9a1e7b285"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE roadmap_item SET status = 'delivered', delivered_on = DATE '2026-11-07',
            description = 'The shared reader is told the language of a story written in French, '
                'German, Spanish, Portuguese or Italian, so Live hints, Live design hints, your '
                'own checks, Evaluate and other AI reading judge the text in that language and '
                'quote it as written. Uses the story''s language, or your account''s if the '
                'story sets none.',
            updated_at = now()
        WHERE lower(title) = 'story-language ai reading' AND status <> 'delivered'
    """)


def downgrade() -> None:
    # Do not undo later author edits to the roadmap.
    pass
