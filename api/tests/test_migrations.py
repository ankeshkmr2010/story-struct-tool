"""Tests for the migrations themselves.

These exist because of a real incident: a generated migration added a NOT NULL column with
no server default, Postgres rejected it against populated tables, and because the template
wrapped every migration in an autocommit block the failure left a half-applied schema with
no version stamp. A fully green test suite said nothing, since the suite built its schema
from the models rather than from the migrations.

Four guards, cheapest first.
"""

import re
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from conftest import run_migrations
from sqlalchemy.ext.asyncio import AsyncEngine

MIGRATIONS = Path(__file__).resolve().parent.parent / "src/storytool/db/migrations"
VERSIONS = MIGRATIONS / "versions"


def migration_files() -> list[Path]:
    return sorted(p for p in VERSIONS.glob("*.py") if p.name != "__init__.py")


def test_there_are_migrations_to_check() -> None:
    """Guards the guards: a glob that silently matches nothing would pass everything."""
    assert len(migration_files()) >= 1


# ------------------------------------------------------------ static guards


ADD_COLUMN = re.compile(r"add_column\(\s*(sa\.Column\(.*?\))\s*\)\s*$", re.DOTALL | re.MULTILINE)


@pytest.mark.parametrize("path", migration_files(), ids=lambda p: p.stem[-12:])
def test_added_columns_are_nullable_or_have_a_server_default(path: Path) -> None:
    """The exact bug that bit us.

    Adding a NOT NULL column to a table that already has rows fails unless Postgres is told
    what to backfill. `default=` is a Python-side default applied on INSERT and does
    nothing for existing rows -- only `server_default` works here.
    """
    source = path.read_text(encoding="utf-8")
    for column in ADD_COLUMN.findall(source):
        if "nullable=False" in column and "server_default" not in column:
            pytest.fail(
                f"{path.name} adds a NOT NULL column with no server_default, which fails "
                f"against a populated table:\n{column.strip()}"
            )


@pytest.mark.parametrize("path", migration_files(), ids=lambda p: p.stem[-12:])
def test_migrations_do_not_use_blanket_autocommit(path: Path) -> None:
    """Autocommit discards Postgres's transactional DDL, so a failure half-applies.

    advanced-alchemy's template wrapped every migration in `autocommit_block()`. It is
    legitimate for statements that genuinely cannot run in a transaction (CREATE INDEX
    CONCURRENTLY); as a blanket default it turns any failed migration into manual cleanup.
    """
    source = path.read_text(encoding="utf-8")
    assert "autocommit_block" not in source, (
        f"{path.name} runs outside a transaction, so a partial failure cannot roll back"
    )


def test_the_template_will_not_reintroduce_autocommit() -> None:
    """Fixing the existing files is pointless if the next generated one brings it back."""
    template = (MIGRATIONS / "script.py.mako").read_text(encoding="utf-8")
    assert "autocommit_block" not in template


def test_env_runs_one_transaction_per_migration() -> None:
    env = (MIGRATIONS / "env.py").read_text(encoding="utf-8")
    assert "transaction_per_migration=True" in env


@pytest.mark.parametrize("path", migration_files(), ids=lambda p: p.stem[-12:])
def test_every_migration_can_be_undone(path: Path) -> None:
    """A migration with no downgrade is a one-way door, which makes the round-trip test
    below impossible and leaves no way back from a bad deploy."""
    source = path.read_text(encoding="utf-8")
    body = source.split("def schema_downgrades()")[-1]
    assert "op." in body, f"{path.name} has no schema_downgrades operations"


# ---------------------------------------------------------- live behaviour


async def test_models_and_migrations_do_not_drift(engine: AsyncEngine) -> None:
    """The migrated schema must match what the models describe.

    Without this, adding a column to a model and forgetting the migration passes every
    other test -- because the app and the test schema would both come from the models.
    """
    from storytool.db import models as _models  # noqa: F401  -- registers all tables
    from storytool.db.base import metadata

    async with engine.connect() as conn:
        diffs = await conn.run_sync(
            lambda sync_conn: compare_metadata(MigrationContext.configure(sync_conn), metadata)
        )

    # Alembic's own bookkeeping table is not in our metadata, so it always reads as extra.
    meaningful = [diff for diff in diffs if "alembic_version" not in str(diff)]
    assert meaningful == [], f"models and migrations have drifted: {meaningful}"


async def test_full_downgrade_and_upgrade_round_trip(engine: AsyncEngine) -> None:
    """Walk every migration down to nothing and back up.

    This is what would have caught the half-applied failure: a migration that cannot cleanly
    apply, or cannot be undone, fails here instead of in production.

    Runs last-ish by design -- it rebuilds the schema the rest of the session uses, and
    leaves it at head.
    """
    down = run_migrations("downgrade base")
    assert down.returncode == 0, f"downgrade failed:\n{down.stdout}\n{down.stderr}"

    up = run_migrations("upgrade")
    assert up.returncode == 0, f"re-upgrade failed:\n{up.stdout}\n{up.stderr}"

    from storytool.db import models as _models  # noqa: F401
    from storytool.db.base import metadata

    async with engine.connect() as conn:
        diffs = await conn.run_sync(
            lambda sync_conn: compare_metadata(MigrationContext.configure(sync_conn), metadata)
        )
    meaningful = [d for d in diffs if "alembic_version" not in str(d)]
    assert meaningful == [], f"schema differs after a round trip: {meaningful}"


def test_the_not_null_guard_actually_catches_the_original_bug() -> None:
    """A guard that cannot fail is decoration.

    The first fragment is the migration Alembic generated for us verbatim, which Postgres
    rejected; the second is the corrected form.
    """
    original = (
        "    with op.batch_alter_table('scene', schema=None) as batch_op:\n"
        "        batch_op.add_column(sa.Column('content', sa.Text(), nullable=True))\n"
        "        batch_op.add_column(sa.Column('word_count', sa.Integer(), nullable=False))\n"
    )
    corrected = (
        "    with op.batch_alter_table('scene', schema=None) as batch_op:\n"
        "        batch_op.add_column("
        "sa.Column('word_count', sa.Integer(), server_default='0', nullable=False))\n"
    )

    def violations(source: str) -> list[str]:
        return [
            column
            for column in ADD_COLUMN.findall(source)
            if "nullable=False" in column and "server_default" not in column
        ]

    assert len(violations(original)) == 1
    assert violations(corrected) == []
