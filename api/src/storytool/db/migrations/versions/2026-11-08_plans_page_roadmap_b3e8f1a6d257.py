"""Roadmap: planned Your plan and upgrades (tier page, upgrade flow with a payment stub)."""

from alembic import op

revision = "b3e8f1a6d257"
down_revision = "a7d2e5c8b914"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO roadmap_item
            (id, created_at, updated_at, title, description, status, hero, delivered_on, sort_key)
        SELECT 'b3e8f1a6-d257-4c9e-8a1f-5d2b7e3c9a64', now(), now(),
            'Your plan and upgrades',
            'See your current plan, where it comes from and when it ends in Settings, compare '
                'plans on a Plans page and upgrade for 1, 3, 6 or 12 months. Payment comes '
                'later; until then upgrades go through a switchable stand-in.',
            'planned', false, NULL,
            (SELECT COALESCE(MAX(sort_key), 0) + 100 FROM roadmap_item)
        WHERE NOT EXISTS (SELECT 1 FROM roadmap_item WHERE lower(title) = 'your plan and upgrades')
    """)


def downgrade() -> None:
    op.execute("DELETE FROM roadmap_item WHERE id = 'b3e8f1a6-d257-4c9e-8a1f-5d2b7e3c9a64'")
