"""Integration test harness.

Tests run against a real Postgres (`storytool_test`), not SQLite. The whole reason we
chose Postgres for dev was dev/prod parity, and testing against a different engine would
throw that away.
"""

import os
from collections.abc import AsyncGenerator

import asyncpg
import pytest
from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

PG_BASE = "postgresql+asyncpg://storytool:storytool@localhost:5432"
TEST_DB = "storytool_test"
TEST_URL = f"{PG_BASE}/{TEST_DB}"


@pytest.fixture(scope="session", autouse=True)
def _point_settings_at_test_db() -> None:
    os.environ["STORYTOOL_DATABASE_URL"] = TEST_URL
    from storytool.config import get_settings

    get_settings.cache_clear()


@pytest.fixture(scope="session")
async def engine(_point_settings_at_test_db: None) -> AsyncGenerator[AsyncEngine, None]:
    admin = await asyncpg.connect(
        user="storytool", password="storytool", host="localhost", port=5432, database="postgres"
    )
    try:
        if not await admin.fetchval("select 1 from pg_database where datname = $1", TEST_DB):
            await admin.execute(f'create database "{TEST_DB}"')
    finally:
        await admin.close()

    # Import the registry explicitly: create_all only builds tables that have been
    # imported, and relying on another test module's imports makes schema creation depend
    # on collection order.
    from storytool.db import models as _models  # noqa: F401
    from storytool.db.base import metadata

    eng = create_async_engine(TEST_URL)
    async with eng.begin() as conn:
        await conn.run_sync(metadata.drop_all)
        await conn.run_sync(metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture(autouse=True)
async def _truncate(engine: AsyncEngine) -> AsyncGenerator[None, None]:
    """Each test starts from an empty database."""
    from sqlalchemy import text

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
