"""CRUD for Levels 7 and 8, the fulfilment links, and the Chapter Context Brief."""

from collections.abc import AsyncGenerator
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.di import Provide
from litestar.exceptions import ClientException, NotFoundException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.common import apply_patch, fetch_or_404
from storytool.domain.narrative import links as link_ops
from storytool.domain.narrative.brief import build_chapter_brief
from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.narrative.moving import MoveError, move_chapter, move_scene
from storytool.domain.narrative.schemas import (
    ArcStageLink,
    BeatLink,
    ChapterBriefOut,
    ChapterCreate,
    ChapterMove,
    ChapterOut,
    ChapterUpdate,
    LinksOut,
    MoveResultOut,
    SceneCreate,
    SceneMove,
    SceneOut,
    SceneUpdate,
    ThreadLink,
)
from storytool.domain.narrative.services import ChapterService, SceneService
from storytool.domain.ordering import chapter_order_key, scene_order_key


async def provide_chapters(db_session: AsyncSession) -> AsyncGenerator[ChapterService, None]:
    yield ChapterService(session=db_session)


async def provide_scenes(db_session: AsyncSession) -> AsyncGenerator[SceneService, None]:
    yield SceneService(session=db_session)


class ChapterController(Controller):
    """Level 7."""

    path = "/api/stories/{story_id:uuid}/chapters"
    tags = ["chapters"]
    dependencies = {"chapters": Provide(provide_chapters)}
    signature_namespace = {"AsyncSession": AsyncSession, "ChapterService": ChapterService}

    @get(summary="List chapters in order")
    async def list_chapters(self, chapters: ChapterService, story_id: UUID) -> list[ChapterOut]:
        records = await chapters.get_many(
            Chapter.story_id == story_id, order_by=Chapter.sort_key.asc()
        )
        return [ChapterOut.model_validate(r) for r in sorted(records, key=chapter_order_key)]

    @post(status_code=201, summary="Create a chapter")
    async def create_chapter(
        self, chapters: ChapterService, story_id: UUID, data: ChapterCreate
    ) -> ChapterOut:
        record = await chapters.create(Chapter(story_id=story_id, **data.model_dump()))
        return ChapterOut.model_validate(record)

    @get("/{chapter_id:uuid}", summary="Get a chapter")
    async def get_chapter(
        self, chapters: ChapterService, story_id: UUID, chapter_id: UUID
    ) -> ChapterOut:
        record = await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        return ChapterOut.model_validate(record)

    @patch("/{chapter_id:uuid}", summary="Update a chapter")
    async def update_chapter(
        self,
        chapters: ChapterService,
        story_id: UUID,
        chapter_id: UUID,
        data: ChapterUpdate,
    ) -> ChapterOut:
        record = await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        record = await chapters.update(apply_patch(record, data))
        return ChapterOut.model_validate(record)

    @delete("/{chapter_id:uuid}", summary="Delete a chapter")
    async def delete_chapter(
        self, chapters: ChapterService, story_id: UUID, chapter_id: UUID
    ) -> None:
        await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        await chapters.delete(chapter_id)

    @post("/{chapter_id:uuid}/move", summary="Reorder a chapter")
    async def move_chapter_route(
        self,
        db_session: AsyncSession,
        chapters: ChapterService,
        story_id: UUID,
        chapter_id: UUID,
        data: ChapterMove,
    ) -> MoveResultOut:
        record = await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        try:
            result = await move_chapter(
                db_session,
                record,
                after_chapter_id=data.after_chapter_id,
                before_chapter_id=data.before_chapter_id,
            )
        except MoveError as exc:
            raise ClientException(status_code=400, detail=str(exc)) from exc
        return MoveResultOut.model_validate(result)

    @get(
        "/{chapter_id:uuid}/brief",
        summary="The Chapter Context Brief",
        description=(
            "Everything the chapter owes, computed from the levels above it: its act, the "
            "beats it must fulfil, the arcs its scenes advance, its threads and emotional "
            "shift. No field here is entered at chapter level."
        ),
    )
    async def get_brief(
        self, db_session: AsyncSession, story_id: UUID, chapter_id: UUID
    ) -> ChapterBriefOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        chapter = next((c for c in graph.chapters if c.id == chapter_id), None)
        if chapter is None:
            raise NotFoundException(detail=f"No chapter with id {chapter_id} in this story")

        return ChapterBriefOut.model_validate(build_chapter_brief(graph, chapter))

    @get("/{chapter_id:uuid}/beats", summary="Beats this chapter fulfils directly")
    async def list_chapter_beats(
        self, db_session: AsyncSession, chapters: ChapterService, story_id: UUID, chapter_id: UUID
    ) -> LinksOut:
        await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        return LinksOut(beat_ids=await link_ops.chapter_beat_ids(db_session, chapter_id))

    @post("/{chapter_id:uuid}/beats", status_code=201, summary="Declare a beat fulfilled")
    async def link_beat(
        self,
        db_session: AsyncSession,
        chapters: ChapterService,
        story_id: UUID,
        chapter_id: UUID,
        data: BeatLink,
    ) -> LinksOut:
        await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        await link_ops.link_chapter_beat(db_session, chapter_id, data.beat_id)
        return LinksOut(beat_ids=await link_ops.chapter_beat_ids(db_session, chapter_id))

    @delete(
        "/{chapter_id:uuid}/beats/{beat_id:uuid}",
        status_code=204,
        summary="Withdraw a beat fulfilment",
    )
    async def unlink_beat(
        self,
        db_session: AsyncSession,
        chapters: ChapterService,
        story_id: UUID,
        chapter_id: UUID,
        beat_id: UUID,
    ) -> None:
        await fetch_or_404(chapters, "chapter", id=chapter_id, story_id=story_id)
        await link_ops.unlink_chapter_beat(db_session, chapter_id, beat_id)


class SceneController(Controller):
    """Level 8. `story_id` is carried directly, so a scene may exist with no chapter."""

    path = "/api/stories/{story_id:uuid}/scenes"
    tags = ["scenes"]
    dependencies = {"scenes": Provide(provide_scenes)}
    signature_namespace = {"AsyncSession": AsyncSession, "SceneService": SceneService}

    @get(summary="List scenes in order")
    async def list_scenes(
        self, scenes: SceneService, story_id: UUID, db_session: AsyncSession
    ) -> list[SceneOut]:
        records = await scenes.get_many(Scene.story_id == story_id, order_by=Scene.sort_key.asc())
        chapters = (
            await db_session.scalars(select(Chapter).where(Chapter.story_id == story_id))
        ).all()
        rank: dict[UUID | None, int] = {
            chapter.id: index
            for index, chapter in enumerate(sorted(chapters, key=chapter_order_key))
        }
        ordered = sorted(
            records,
            key=lambda scene: (rank.get(scene.chapter_id, len(rank)), *scene_order_key(scene)),
        )
        return [SceneOut.model_validate(r) for r in ordered]

    @post(status_code=201, summary="Create a scene")
    async def create_scene(
        self, scenes: SceneService, story_id: UUID, data: SceneCreate
    ) -> SceneOut:
        record = await scenes.create(Scene(story_id=story_id, **data.model_dump()))
        return SceneOut.model_validate(record)

    @get("/{scene_id:uuid}", summary="Get a scene")
    async def get_scene(self, scenes: SceneService, story_id: UUID, scene_id: UUID) -> SceneOut:
        record = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        return SceneOut.model_validate(record)

    @patch("/{scene_id:uuid}", summary="Update a scene")
    async def update_scene(
        self, scenes: SceneService, story_id: UUID, scene_id: UUID, data: SceneUpdate
    ) -> SceneOut:
        record = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        record = await scenes.update(apply_patch(record, data))
        return SceneOut.model_validate(record)

    @delete("/{scene_id:uuid}", summary="Delete a scene with whole-story recovery versions")
    async def delete_scene(
        self,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        db_session: AsyncSession,
        request: Request,
    ) -> None:
        from storytool.domain.versioning.service import automatic_checkpoint, checkpoint, full_state

        scene = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        user_id = request.scope["state"]["storytool_user_id"]
        title = scene.title or "Untitled scene"
        request.scope["state"]["explicit_deletion_checkpoint"] = True
        await checkpoint(
            db_session, story_id, user_id, f"Before deleting scene: {title}"[:200], "recovery"
        )
        await scenes.delete(scene_id)
        await automatic_checkpoint(
            db_session,
            story_id,
            user_id,
            await full_state(db_session, story_id),
            f"After deleting scene: {title}"[:200],
            force=True,
        )

    @post(
        "/{scene_id:uuid}/move",
        summary="Reorder a scene, or move it to another chapter",
        description=(
            "The server computes sort_key -- midpoint arithmetic plus the rebalance case is "
            "exactly the sort of thing that goes subtly wrong if duplicated client-side. "
            "Sending chapter_id as null unplaces the scene, which is a legal state."
        ),
    )
    async def move_scene_route(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        data: SceneMove,
    ) -> MoveResultOut:
        record = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        # Distinguish "chapter_id absent" from "chapter_id: null" -- the latter unplaces.
        keep_chapter = "chapter_id" not in data.model_dump(exclude_unset=True)
        try:
            result = await move_scene(
                db_session,
                record,
                chapter_id=data.chapter_id,
                keep_chapter=keep_chapter,
                after_scene_id=data.after_scene_id,
                before_scene_id=data.before_scene_id,
            )
        except MoveError as exc:
            raise ClientException(status_code=400, detail=str(exc)) from exc
        return MoveResultOut.model_validate(result)

    @get("/{scene_id:uuid}/links", summary="What this scene points at upward")
    async def get_links(
        self, db_session: AsyncSession, scenes: SceneService, story_id: UUID, scene_id: UUID
    ) -> LinksOut:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        return LinksOut(**await link_ops.scene_links(db_session, scene_id))

    @post("/{scene_id:uuid}/beats", status_code=201, summary="This scene fulfils a beat")
    async def link_scene_beat(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        data: BeatLink,
    ) -> LinksOut:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        await link_ops.link_scene_beat(db_session, scene_id, data.beat_id)
        return LinksOut(**await link_ops.scene_links(db_session, scene_id))

    @delete(
        "/{scene_id:uuid}/beats/{beat_id:uuid}", status_code=204, summary="Withdraw a beat link"
    )
    async def unlink_scene_beat(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        beat_id: UUID,
    ) -> None:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        await link_ops.unlink_scene_beat(db_session, scene_id, beat_id)

    @post("/{scene_id:uuid}/threads", status_code=201, summary="This scene advances a thread")
    async def link_thread(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        data: ThreadLink,
    ) -> LinksOut:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        await link_ops.link_scene_thread(db_session, scene_id, data.thread_id, data.is_primary)
        return LinksOut(**await link_ops.scene_links(db_session, scene_id))

    @delete(
        "/{scene_id:uuid}/threads/{thread_id:uuid}",
        status_code=204,
        summary="Withdraw a thread link",
    )
    async def unlink_thread(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        thread_id: UUID,
    ) -> None:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        await link_ops.unlink_scene_thread(db_session, scene_id, thread_id)

    @post(
        "/{scene_id:uuid}/arc-stages",
        status_code=201,
        summary="This scene advances a character arc to a stage",
    )
    async def link_arc_stage(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        data: ArcStageLink,
    ) -> LinksOut:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        await link_ops.link_scene_arc_stage(db_session, scene_id, data.arc_stage_id)
        return LinksOut(**await link_ops.scene_links(db_session, scene_id))

    @delete(
        "/{scene_id:uuid}/arc-stages/{arc_stage_id:uuid}",
        status_code=204,
        summary="Withdraw an arc advance",
    )
    async def unlink_arc_stage(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        arc_stage_id: UUID,
    ) -> None:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        await link_ops.unlink_scene_arc_stage(db_session, scene_id, arc_stage_id)
