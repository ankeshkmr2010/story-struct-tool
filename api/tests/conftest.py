"""Integration test harness.

Tests run against a real Postgres (`storytool_test`), and the schema is built by **running
the migrations**, not by `metadata.create_all()`.

That distinction matters: with `create_all` the suite validates the models and never
executes a migration, so a broken migration passes a fully green test run. It happened --
a NOT NULL column with no server default half-applied against populated tables. Building
the test schema the same way production is built means every test run is also a migration
test.
"""

import os
import subprocess
import sys
from collections.abc import AsyncGenerator
from pathlib import Path

import asyncpg
import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

PG_HOST, PG_PORT = "localhost", 5432
PG_USER, PG_PASSWORD = "storytool", "storytool"
PG_BASE = f"postgresql+asyncpg://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}"
TEST_DB = "storytool_test"
TEST_URL = f"{PG_BASE}/{TEST_DB}"

API_ROOT = Path(__file__).resolve().parent.parent


async def _recreate_database() -> None:
    """Drop and recreate the public schema so migrations always run from nothing."""
    admin = await asyncpg.connect(
        user=PG_USER, password=PG_PASSWORD, host=PG_HOST, port=PG_PORT, database="postgres"
    )
    try:
        if not await admin.fetchval("select 1 from pg_database where datname = $1", TEST_DB):
            await admin.execute(f'create database "{TEST_DB}"')
    finally:
        await admin.close()

    db = await asyncpg.connect(
        user=PG_USER, password=PG_PASSWORD, host=PG_HOST, port=PG_PORT, database=TEST_DB
    )
    try:
        await db.execute("drop schema public cascade; create schema public;")
    finally:
        await db.close()


def run_migrations(target: str = "upgrade") -> subprocess.CompletedProcess[str]:
    """Invoke the same CLI used in production, against the test database.

    A subprocess rather than Alembic's Python API on purpose: this exercises the real
    command, including env.py and the advanced-alchemy config wiring.
    """
    env = {
        **os.environ,
        "STORYTOOL_DATABASE_URL": TEST_URL,
        "LITESTAR_APP": "storytool.app:app",
    }
    command = [sys.executable, "-m", "litestar", "database", *target.split(), "--no-prompt"]
    return subprocess.run(
        command, cwd=API_ROOT, env=env, capture_output=True, text=True, check=False
    )


@pytest.fixture(scope="session", autouse=True)
def _point_settings_at_test_db() -> None:
    os.environ["STORYTOOL_DATABASE_URL"] = TEST_URL

    # Force deterministic noticing for the whole suite. Settings read api/.env, so a
    # developer with a real key would otherwise have every noticing test make live API
    # calls -- slow, network-dependent, and quietly spending money. Tests that genuinely
    # exercise a model construct their own client and are skipped without a key.
    os.environ["STORYTOOL_NOTICING_BACKEND"] = "deterministic"

    from storytool.config import get_settings

    get_settings.cache_clear()


@pytest.fixture(scope="session")
async def engine(_point_settings_at_test_db: None) -> AsyncGenerator[AsyncEngine, None]:
    await _recreate_database()

    result = run_migrations("upgrade")
    if result.returncode != 0:
        pytest.fail(
            "Migrations failed, so no test can be trusted.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

    eng = create_async_engine(TEST_URL)
    yield eng
    await eng.dispose()


@pytest.fixture(autouse=True)
async def _truncate(engine: AsyncEngine) -> AsyncGenerator[None, None]:
    """Each test starts from empty tables -- but the migrated schema stays in place."""
    from sqlalchemy import text

    from storytool.db import models as _models  # noqa: F401  -- registers all tables
    from storytool.db.base import metadata

    yield
    tables = ", ".join(f'"{t.name}"' for t in metadata.sorted_tables)
    if tables:
        async with engine.begin() as conn:
            await conn.execute(text(f"truncate {tables} restart identity cascade"))


@pytest.fixture
async def client(engine: AsyncEngine) -> AsyncGenerator[AsyncTestClient, None]:
    from storytool.app import create_app

    async with AsyncTestClient(app=create_app()) as test_client:
        yield test_client
