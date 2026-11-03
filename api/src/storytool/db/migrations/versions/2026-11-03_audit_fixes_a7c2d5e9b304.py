"""Reconcile shipped prose links and record the production audit fixes."""

from alembic import op

revision = "a7c2d5e9b304"
down_revision = "f6b1d4e8a293"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE roadmap_item SET status = 'delivered', delivered_on = DATE '2026-11-02',
            description = 'Select prose to mark a setup or payoff, name it, link the pair '
                'and revisit or unlink it from Write or Design.', updated_at = now()
        WHERE lower(title) = 'setups and payoffs' AND status <> 'delivered'
    """)
    op.execute("""
        INSERT INTO roadmap_item
            (id, created_at, updated_at, title, description, status, hero, delivered_on, sort_key)
        VALUES ('a7c2d5e9-b304-4931-a6e9-5185977ce15c', now(), now(),
            'Production audit fixes',
            'Safer glossary rename proposals, consistent check access, working count-check '
            'templates, fresh speaker choices, direct Admin navigation, mobile workspace '
            'header wrapping and clearer scene structure labels.',
            'delivered', false, DATE '2026-11-03', 0)
    """)


def downgrade() -> None:
    # Do not undo subsequent author edits or restore an inaccurate planned status.
    op.execute("DELETE FROM roadmap_item WHERE id = 'a7c2d5e9-b304-4931-a6e9-5185977ce15c'")
