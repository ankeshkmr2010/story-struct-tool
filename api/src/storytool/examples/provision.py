"""Provision each account once, without resurrecting examples the author deleted."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.models import User
from storytool.examples.catalog import STARTER_OUTLINES
from storytool.examples.outline import seed_outline
from storytool.examples.tutorial import seed_tutorial

EXAMPLES_VERSION = 2


async def ensure_starter_examples(session: AsyncSession, user_id: UUID) -> None:
    # Serialise concurrent logins for one account. Refresh a previously loaded User
    # after acquiring the lock so a second request sees the first one's saved version.
    user = await session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or user.examples_seed_version >= EXAMPLES_VERSION:
        return
    if user.examples_seed_version < 1:
        for outline in STARTER_OUTLINES:
            await seed_outline(session, user_id, outline)
    if user.examples_seed_version < 2:
        await seed_tutorial(session, user_id)
    user.examples_seed_version = EXAMPLES_VERSION
    await session.flush()
