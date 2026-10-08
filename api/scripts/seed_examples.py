"""Backfill independent starter examples for every existing registered account.

Run from api/: uv run python scripts/seed_examples.py
Existing examples and user edits are preserved. Future accounts receive these on login.
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from storytool.config import get_settings
from storytool.domain.auth.models import User
from storytool.examples.provision import ensure_starter_examples


async def main() -> None:
    engine = create_async_engine(get_settings().database_url)
    try:
        async with AsyncSession(engine) as session:
            user_ids = list((await session.execute(select(User.id))).scalars())
        for user_id in user_ids:
            async with AsyncSession(engine) as session:
                await ensure_starter_examples(session, user_id)
                await session.commit()
        print(f"Starter examples ready for {len(user_ids)} registered accounts.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
