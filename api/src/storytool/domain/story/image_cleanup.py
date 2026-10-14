"""Delete only files queued by a committed, permanent story purge."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from uuid import UUID

from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig
from litestar import Litestar
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.story.image_models import ImageDeletion
from storytool.domain.story.image_storage import client
from storytool.domain.story.models import Story

logger = logging.getLogger("storytool.images")


async def drain_image_deletions(db: AsyncSession) -> None:
    jobs = list(
        await db.scalars(
            select(ImageDeletion)
            .order_by(ImageDeletion.created_at, ImageDeletion.id)
            .limit(50)
            .with_for_update(skip_locked=True)
        )
    )
    for job in jobs:
        # A rolled-back purge never exposes a queue row. Recheck defensively too.
        if await db.get(Story, job.story_id) is not None:
            continue
        parts = job.object_key.split("/")
        if len(parts) != 3 or parts[:2] != ["stories", str(job.story_id)]:
            logger.warning("Skipped an invalid image cleanup key")
            continue
        try:
            UUID(parts[2])
        except ValueError:
            logger.warning("Skipped an invalid image cleanup identifier")
            continue
        try:
            await asyncio.to_thread(client().delete_object, Bucket=job.bucket, Key=job.object_key)
        except Exception as error:
            logger.warning("Image cleanup will retry (%s)", type(error).__name__)
            continue
        await db.delete(job)
    # A successful delete is idempotent if a later commit fails or the process stops.
    await db.commit()


def image_cleanup_lifespan(db_config: SQLAlchemyAsyncConfig):
    @asynccontextmanager
    async def lifespan(_app: Litestar) -> AsyncIterator[None]:
        async def worker() -> None:
            while True:
                settings = get_settings()
                if all(
                    (
                        settings.image_storage_endpoint,
                        settings.image_storage_access_key,
                        settings.image_storage_secret_key,
                    )
                ):
                    try:
                        async with db_config.get_session() as db:
                            await drain_image_deletions(db)
                    except Exception as error:
                        logger.warning("Image cleanup will retry (%s)", type(error).__name__)
                await asyncio.sleep(300)

        task = asyncio.create_task(worker())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    return lifespan
