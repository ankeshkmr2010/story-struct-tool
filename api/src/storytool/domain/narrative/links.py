"""Upward-reference edges: what a chapter or scene fulfils and advances.

Every link is idempotent (`ON CONFLICT DO NOTHING`), because "this chapter fulfils the
Midpoint" is a statement of fact, not an event -- asserting it twice should not be an error.
"""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.narrative.models import (
    chapter_beat,
    scene_arc_advance,
    scene_beat,
    scene_thread,
)


async def link_chapter_beat(session: AsyncSession, chapter_id: UUID, beat_id: UUID) -> None:
    await session.execute(
        insert(chapter_beat)
        .values(chapter_id=chapter_id, beat_id=beat_id)
        .on_conflict_do_nothing()
    )


async def unlink_chapter_beat(session: AsyncSession, chapter_id: UUID, beat_id: UUID) -> None:
    await session.execute(
        delete(chapter_beat).where(
            chapter_beat.c.chapter_id == chapter_id, chapter_beat.c.beat_id == beat_id
        )
    )


async def chapter_beat_ids(session: AsyncSession, chapter_id: UUID) -> list[UUID]:
    rows = await session.execute(
        select(chapter_beat.c.beat_id).where(chapter_beat.c.chapter_id == chapter_id)
    )
    return [row.beat_id for row in rows]


async def link_scene_beat(session: AsyncSession, scene_id: UUID, beat_id: UUID) -> None:
    await session.execute(
        insert(scene_beat).values(scene_id=scene_id, beat_id=beat_id).on_conflict_do_nothing()
    )


async def unlink_scene_beat(session: AsyncSession, scene_id: UUID, beat_id: UUID) -> None:
    await session.execute(
        delete(scene_beat).where(
            scene_beat.c.scene_id == scene_id, scene_beat.c.beat_id == beat_id
        )
    )


async def link_scene_thread(
    session: AsyncSession, scene_id: UUID, thread_id: UUID, is_primary: bool = False
) -> None:
    """Upsert, so re-linking can flip `is_primary` rather than silently doing nothing."""
    await session.execute(
        insert(scene_thread)
        .values(scene_id=scene_id, thread_id=thread_id, is_primary=is_primary)
        .on_conflict_do_update(
            index_elements=["scene_id", "thread_id"], set_={"is_primary": is_primary}
        )
    )


async def unlink_scene_thread(session: AsyncSession, scene_id: UUID, thread_id: UUID) -> None:
    await session.execute(
        delete(scene_thread).where(
            scene_thread.c.scene_id == scene_id, scene_thread.c.thread_id == thread_id
        )
    )


async def link_scene_arc_stage(
    session: AsyncSession, scene_id: UUID, arc_stage_id: UUID
) -> None:
    await session.execute(
        insert(scene_arc_advance)
        .values(scene_id=scene_id, arc_stage_id=arc_stage_id)
        .on_conflict_do_nothing()
    )


async def unlink_scene_arc_stage(
    session: AsyncSession, scene_id: UUID, arc_stage_id: UUID
) -> None:
    await session.execute(
        delete(scene_arc_advance).where(
            scene_arc_advance.c.scene_id == scene_id,
            scene_arc_advance.c.arc_stage_id == arc_stage_id,
        )
    )


async def scene_links(session: AsyncSession, scene_id: UUID) -> dict[str, list[UUID]]:
    beats = await session.execute(
        select(scene_beat.c.beat_id).where(scene_beat.c.scene_id == scene_id)
    )
    threads = await session.execute(
        select(scene_thread.c.thread_id)
        .where(scene_thread.c.scene_id == scene_id)
        .order_by(scene_thread.c.is_primary.desc())
    )
    stages = await session.execute(
        select(scene_arc_advance.c.arc_stage_id).where(scene_arc_advance.c.scene_id == scene_id)
    )
    return {
        "beat_ids": [r.beat_id for r in beats],
        "thread_ids": [r.thread_id for r in threads],
        "arc_stage_ids": [r.arc_stage_id for r in stages],
    }
