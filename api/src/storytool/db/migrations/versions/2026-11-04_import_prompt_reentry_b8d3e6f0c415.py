"""Record restored library entry points for manuscript import prompts."""

from alembic import op

revision = "b8d3e6f0c415"
down_revision = "a7c2d5e9b304"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO roadmap_item
            (id, created_at, updated_at, title, description, status, hero, delivered_on, sort_key)
        VALUES ('b8d3e6f0-c415-4931-a6e9-5185977ce15c', now(), now(),
            'Return to import planning prompts',
            'Word, Markdown, text, EPUB and Scrivener imports keep their Imported badge '
            'and Import prompts action after navigation, reload and later edits.',
            'delivered', false, DATE '2026-11-04', 0)
    """)


def downgrade() -> None:
    op.execute("DELETE FROM roadmap_item WHERE id = 'b8d3e6f0-c415-4931-a6e9-5185977ce15c'")
