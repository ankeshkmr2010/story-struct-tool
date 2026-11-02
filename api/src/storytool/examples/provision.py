"""Provision each account once, without resurrecting examples the author deleted."""

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.auth.models import User
from storytool.examples.catalog import STARTER_OUTLINES
from storytool.examples.demo import fill_demo_speakers, retire_old_examples, seed_demo
from storytool.examples.outline import seed_outline
from storytool.examples.tutorial import seed_tutorial

EXAMPLES_VERSION = 4


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
    if user.examples_seed_version < 3:
        await retire_old_examples(session, user_id)
        await seed_demo(session, user_id)
    if user.examples_seed_version < 4:
        await session.flush()
        # Sign-in must not fail over the demo's speakers: on any error they are left empty.
        try:
            async with session.begin_nested():
                await fill_demo_speakers(session, user_id)
        except Exception:
            logging.getLogger(__name__).exception("Could not fill the demo story's speakers")
    user.examples_seed_version = EXAMPLES_VERSION
    await session.flush()
