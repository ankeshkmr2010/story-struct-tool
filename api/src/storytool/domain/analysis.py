"""Bridge between persistence and the pure engines.

`load_graph` is the only part of the domain that touches the database. Everything
downstream of it -- snapshot derivation, readiness, health, the chapter brief -- is pure,
which is what keeps the interesting logic unit-testable without a fixture database.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.enums import CharacterRole
from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import (
    Chapter,
    Scene,
    chapter_beat,
    scene_arc_advance,
    scene_beat,
    scene_thread,
)
from storytool.domain.readiness import StorySnapshot
from storytool.domain.story.models import Story
from storytool.domain.structure.models import Act, Beat, Event, Thread


def snapshot_from_graph(graph: StoryGraph) -> StorySnapshot:
    """Reduce a loaded graph to the counts readiness cares about. Pure."""
    return StorySnapshot(
        story_is_complete=graph.story.is_complete,
        turning_point_count=len(graph.turning_points),
        character_count=len(graph.characters),
        complete_character_count=sum(1 for c in graph.characters if c.is_complete),
        has_protagonist=any(c.role == CharacterRole.PROTAGONIST for c in graph.characters),
        act_count=len(graph.acts),
        complete_act_count=sum(1 for a in graph.acts if a.is_complete),
        beat_count=len(graph.beats),
        complete_beat_count=sum(1 for b in graph.beats if b.is_complete),
        thread_count=len(graph.threads),
        chapter_count=len(graph.chapters),
        scene_count=len(graph.scenes),
    )


async def load_graph(session: AsyncSession, story: Story) -> StoryGraph:
    """Load every entity and edge belonging to a story.

    Deliberately eager and flat rather than lazy relationship traversal: the health rules
    iterate most collections anyway, so this keeps the query count fixed and visible
    instead of letting N+1s hide behind attribute access.
    """

    async def fetch(model: Any, order_by: Any = None) -> tuple[Any, ...]:
        stmt = select(model).where(model.story_id == story.id)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        return tuple((await session.execute(stmt)).scalars().all())

    arcs = await fetch(Arc)
    chapters = await fetch(Chapter, Chapter.sort_key.asc())
    scenes = await fetch(Scene, Scene.sort_key.asc())

    arc_ids = [arc.id for arc in arcs]
    chapter_ids = [chapter.id for chapter in chapters]
    scene_ids = [scene.id for scene in scenes]

    stages: tuple[ArcStage, ...] = ()
    if arc_ids:
        stages = tuple(
            (
                await session.execute(
                    select(ArcStage).where(ArcStage.arc_id.in_(arc_ids)).order_by(ArcStage.sort_key)
                )
            )
            .scalars()
            .all()
        )

    chapter_beats: tuple[tuple[UUID, UUID], ...] = ()
    if chapter_ids:
        rows = await session.execute(
            select(chapter_beat.c.chapter_id, chapter_beat.c.beat_id).where(
                chapter_beat.c.chapter_id.in_(chapter_ids)
            )
        )
        chapter_beats = tuple((r.chapter_id, r.beat_id) for r in rows)

    scene_beats: tuple[tuple[UUID, UUID], ...] = ()
    scene_threads: tuple[tuple[UUID, UUID, bool], ...] = ()
    scene_arc_advances: tuple[tuple[UUID, UUID], ...] = ()
    if scene_ids:
        rows = await session.execute(
            select(scene_beat.c.scene_id, scene_beat.c.beat_id).where(
                scene_beat.c.scene_id.in_(scene_ids)
            )
        )
        scene_beats = tuple((r.scene_id, r.beat_id) for r in rows)

        rows = await session.execute(
            select(
                scene_thread.c.scene_id, scene_thread.c.thread_id, scene_thread.c.is_primary
            ).where(scene_thread.c.scene_id.in_(scene_ids))
        )
        scene_threads = tuple((r.scene_id, r.thread_id, r.is_primary) for r in rows)

        rows = await session.execute(
            select(scene_arc_advance.c.scene_id, scene_arc_advance.c.arc_stage_id).where(
                scene_arc_advance.c.scene_id.in_(scene_ids)
            )
        )
        scene_arc_advances = tuple((r.scene_id, r.arc_stage_id) for r in rows)

    return StoryGraph(
        story=story,
        events=await fetch(Event, Event.sort_ordinal.asc()),
        acts=await fetch(Act, Act.sort_key.asc()),
        beats=await fetch(Beat, Beat.sort_key.asc()),
        threads=await fetch(Thread, Thread.sort_key.asc()),
        characters=await fetch(Character, Character.name.asc()),
        relationships=await fetch(Relationship),
        arcs=arcs,
        arc_stages=stages,
        chapters=chapters,
        scenes=scenes,
        chapter_beats=chapter_beats,
        scene_beats=scene_beats,
        scene_threads=scene_threads,
        scene_arc_advances=scene_arc_advances,
    )


async def load_graph_by_id(session: AsyncSession, story_id: UUID) -> StoryGraph | None:
    story = (await session.execute(select(Story).where(Story.id == story_id))).scalar_one_or_none()
    if story is None:
        return None
    return await load_graph(session, story)
