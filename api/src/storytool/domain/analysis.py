"""Bridge between persistence and the pure engines.

`load_graph` is the only part that touches the database. Everything downstream of it --
snapshot derivation, readiness, health -- is pure, which is what keeps the interesting
logic unit-testable without a fixture database.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.enums import CharacterRole
from storytool.domain.health import StoryGraph
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
        # Chapters and scenes arrive in Phase 2.
        chapter_count=0,
        scene_count=0,
    )


async def load_graph(session: AsyncSession, story: Story) -> StoryGraph:
    """Load every entity belonging to a story in one pass per table.

    Deliberately eager and flat rather than lazy relationship traversal: the health rules
    iterate most collections anyway, and this keeps the query count fixed and visible
    instead of letting N+1s hide behind attribute access.
    """

    async def fetch(model, order_by=None):  # type: ignore[no-untyped-def]
        stmt = select(model).where(model.story_id == story.id)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        return tuple((await session.execute(stmt)).scalars().all())

    arcs = await fetch(Arc)
    arc_ids = [arc.id for arc in arcs]
    stages: tuple[ArcStage, ...] = ()
    if arc_ids:
        stage_stmt = (
            select(ArcStage).where(ArcStage.arc_id.in_(arc_ids)).order_by(ArcStage.sort_key)
        )
        stages = tuple((await session.execute(stage_stmt)).scalars().all())

    return StoryGraph(
        story=story,
        events=await fetch(Event, Event.sort_ordinal),
        acts=await fetch(Act, Act.sort_key),
        beats=await fetch(Beat, Beat.sort_key),
        threads=await fetch(Thread, Thread.sort_key),
        characters=await fetch(Character, Character.name),
        relationships=await fetch(Relationship),
        arcs=arcs,
        arc_stages=stages,
    )


async def load_graph_by_id(session: AsyncSession, story_id: UUID) -> StoryGraph | None:
    story = (await session.execute(select(Story).where(Story.id == story_id))).scalar_one_or_none()
    if story is None:
        return None
    return await load_graph(session, story)
