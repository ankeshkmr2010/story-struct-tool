"""Integration test harness.

Tests run against a real Postgres (`storytool_test`), and the schema is built by **running
the migrations**, not by `metadata.create_all()`.

That distinction matters: with `create_all` the suite validates the models and never
executes a migration, so a broken migration passes a fully green test run. It happened --
a NOT NULL column with no server default half-applied against populated tables. Building
the test schema the same way production is built means every test run is also a migration
test.
"""

import hashlib
import os
import subprocess
import sys
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg
import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

PG_HOST, PG_PORT = "localhost", 5432
PG_USER, PG_PASSWORD = "storytool", "storytool"
PG_BASE = f"postgresql+asyncpg://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}"
TEST_DB = "storytool_test"
# The local Docker Postgres does not use TLS. Avoid asyncpg's opportunistic TLS
# negotiation, which intermittently resets Windows sockets in long test runs.
TEST_URL = f"{PG_BASE}/{TEST_DB}?ssl=disable"

API_ROOT = Path(__file__).resolve().parent.parent


async def _recreate_database() -> None:
    """Drop and recreate the public schema so migrations always run from nothing."""
    admin = await asyncpg.connect(
        user=PG_USER,
        password=PG_PASSWORD,
        host=PG_HOST,
        port=PG_PORT,
        database="postgres",
        ssl=False,
    )
    try:
        if not await admin.fetchval("select 1 from pg_database where datname = $1", TEST_DB):
            await admin.execute(f'create database "{TEST_DB}"')
    finally:
        await admin.close()

    db = await asyncpg.connect(
        user=PG_USER, password=PG_PASSWORD, host=PG_HOST, port=PG_PORT, database=TEST_DB, ssl=False
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

    eng = create_async_engine(TEST_URL, poolclass=NullPool)
    yield eng
    await eng.dispose()


@pytest.fixture(autouse=True)
async def _truncate(engine: AsyncEngine) -> AsyncGenerator[None, None]:
    """Each test starts from empty tables -- but the migrated schema stays in place."""
    from sqlalchemy import text

    from storytool.db import models as _models  # noqa: F401  -- registers all tables
    from storytool.db.base import metadata

    yield
    # Plain table list, not sorted_tables: TRUNCATE ... CASCADE needs no ordering, and
    # asking for a topological sort warns about the (legitimate) event/scene/act cycle.
    tables = ", ".join(f'"{name}"' for name in metadata.tables)
    if tables:
        async with engine.begin() as conn:
            await conn.execute(text(f"truncate {tables} restart identity cascade"))


@pytest.fixture
async def client(engine: AsyncEngine) -> AsyncGenerator[AsyncTestClient, None]:
    """A fresh app per test, with its engine disposed afterwards.

    The app cannot be shared across tests -- entering `AsyncTestClient` runs the app's
    lifespan, so a second client would get an already-shut-down app. But each app builds its
    own engine with its own pool, and nothing was releasing it: the suite leaked one Postgres
    connection per test and everything past roughly the hundredth returned 500. The symptom
    was maddening (every file passed alone, the full run failed), so the engine is now
    disposed explicitly.
    """
    from advanced_alchemy.extensions.litestar import SQLAlchemyPlugin

    from storytool.app import create_app
    from storytool.db.plugin import build_db_config
    from storytool.domain.auth.models import User, UserSession

    async with AsyncSession(engine) as session:
        user = User(google_sub="test-author", email="author@example.com")
        session.add(user)
        await session.flush()
        session.add(
            UserSession(
                user_id=user.id,
                token_hash=hashlib.sha256(b"test-session").hexdigest(),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await session.commit()

    config = build_db_config()
    # TestClient's portal has its own loop. Do not retain asyncpg sockets across
    # portal shutdown: on Windows they become stale and fail subsequent requests.
    config.engine_instance = create_async_engine(TEST_URL, poolclass=NullPool)
    try:
        async with AsyncTestClient(
            app=create_app(db_plugin=SQLAlchemyPlugin(config=config))
        ) as test_client:
            test_client.cookies.set("storytool_session", "test-session", path="/api")
            yield test_client
    finally:
        await config.get_engine().dispose()
