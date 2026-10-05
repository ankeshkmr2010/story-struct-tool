"""Prose, revisions, annotations, progress and export.

`word_count` is never accepted from a client anywhere in this module -- it is recomputed
from the prose on every write. Clients cannot desynchronise it.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

from litestar import Controller, MediaType, Response, delete, get, patch, post, put
from litestar.di import Provide
from litestar.exceptions import NotFoundException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.common import apply_patch, fetch_or_404
from storytool.domain.narrative.models import Annotation, SceneRevision
from storytool.domain.narrative.prose import (
    compile_manuscript,
    count_words,
    save_scene_content,
    story_progress,
)
from storytool.domain.narrative.schemas import (
    AnnotationCreate,
    AnnotationOut,
    AnnotationUpdate,
    SaveResultOut,
    SceneContentOut,
    SceneContentUpdate,
    SceneRevisionOut,
    StoryProgressOut,
)
from storytool.domain.narrative.services import SceneService


async def provide_scenes(db_session: AsyncSession) -> AsyncGenerator[SceneService, None]:
    yield SceneService(session=db_session)


class SceneProseController(Controller):
    """Phase 3. The writing surface, kept beside the structure it serves."""

    path = "/api/stories/{story_id:uuid}/scenes/{scene_id:uuid}"
    tags = ["prose"]
    dependencies = {"scenes": Provide(provide_scenes)}
    signature_namespace = {"AsyncSession": AsyncSession, "SceneService": SceneService}

    @get("/content", summary="Get a scene's prose")
    async def get_content(
        self, scenes: SceneService, story_id: UUID, scene_id: UUID
    ) -> SceneContentOut:
        scene = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        return SceneContentOut(
            scene_id=scene.id, content=scene.content, word_count=scene.word_count
        )

    @put("/content", summary="Save a scene's prose")
    async def save_content(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        data: SceneContentUpdate,
    ) -> SaveResultOut:
        scene = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        result = await save_scene_content(
            db_session,
            scene,
            data.content,
            snapshot=data.snapshot,
            snapshot_label=data.snapshot_label,
        )
        return SaveResultOut.model_validate(result)

    # ------------------------------------------------------------ revisions

    @get("/revisions", summary="List prose snapshots, newest first")
    async def list_revisions(
        self, db_session: AsyncSession, scenes: SceneService, story_id: UUID, scene_id: UUID
    ) -> list[SceneRevisionOut]:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        rows = await db_session.execute(
            select(SceneRevision)
            .where(SceneRevision.scene_id == scene_id)
            .order_by(SceneRevision.created_at.desc())
        )
        return [SceneRevisionOut.model_validate(r) for r in rows.scalars().all()]

    @post("/revisions", status_code=201, summary="Snapshot the current prose explicitly")
    async def create_revision(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        label: str | None = None,
    ) -> SceneRevisionOut:
        scene = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        revision = SceneRevision(
            scene_id=scene.id,
            content=scene.content,
            word_count=count_words(scene.content),
            label=label,
        )
        db_session.add(revision)
        await db_session.flush()
        return SceneRevisionOut.model_validate(revision)

    @post(
        "/revisions/{revision_id:uuid}/restore",
        summary="Restore a snapshot",
        description=(
            "Snapshots the current prose first, so restoring is itself undoable -- an "
            "author recovering old text must never lose the version they are replacing."
        ),
    )
    async def restore_revision(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        revision_id: UUID,
    ) -> SaveResultOut:
        scene = await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        revision = (
            await db_session.execute(
                select(SceneRevision).where(
                    SceneRevision.id == revision_id, SceneRevision.scene_id == scene_id
                )
            )
        ).scalar_one_or_none()
        if revision is None:
            raise NotFoundException(detail=f"No revision {revision_id} for this scene")

        result = await save_scene_content(
            db_session,
            scene,
            revision.content,
            snapshot=True,
            snapshot_label="before restore",
        )
        return SaveResultOut.model_validate(result)

    # ---------------------------------------------------------- annotations

    @get("/annotations", summary="List annotations on this scene")
    async def list_annotations(
        self, db_session: AsyncSession, scenes: SceneService, story_id: UUID, scene_id: UUID
    ) -> list[AnnotationOut]:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        rows = await db_session.execute(
            select(Annotation)
            .where(Annotation.scene_id == scene_id)
            .order_by(Annotation.start_offset)
        )
        return [AnnotationOut.model_validate(r) for r in rows.scalars().all()]

    @post("/annotations", status_code=201, summary="Annotate a span of prose")
    async def create_annotation(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        data: AnnotationCreate,
    ) -> AnnotationOut:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        annotation = Annotation(scene_id=scene_id, **data.model_dump())
        db_session.add(annotation)
        await db_session.flush()
        return AnnotationOut.model_validate(annotation)

    @patch("/annotations/{annotation_id:uuid}", summary="Update or resolve an annotation")
    async def update_annotation(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        annotation_id: UUID,
        data: AnnotationUpdate,
    ) -> AnnotationOut:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        annotation = (
            await db_session.execute(
                select(Annotation).where(
                    Annotation.id == annotation_id, Annotation.scene_id == scene_id
                )
            )
        ).scalar_one_or_none()
        if annotation is None:
            raise NotFoundException(detail=f"No annotation {annotation_id} on this scene")
        apply_patch(annotation, data)
        await db_session.flush()
        return AnnotationOut.model_validate(annotation)

    @delete("/annotations/{annotation_id:uuid}", summary="Delete an annotation")
    async def delete_annotation(
        self,
        db_session: AsyncSession,
        scenes: SceneService,
        story_id: UUID,
        scene_id: UUID,
        annotation_id: UUID,
    ) -> None:
        await fetch_or_404(scenes, "scene", id=scene_id, story_id=story_id)
        annotation = (
            await db_session.execute(
                select(Annotation).where(
                    Annotation.id == annotation_id, Annotation.scene_id == scene_id
                )
            )
        ).scalar_one_or_none()
        if annotation is None:
            raise NotFoundException(detail=f"No annotation {annotation_id} on this scene")
        await db_session.delete(annotation)


class ManuscriptController(Controller):
    """Progress rollups and export."""

    path = "/api/stories/{story_id:uuid}"
    tags = ["manuscript"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/progress", summary="Word counts rolled up the structure")
    async def get_progress(self, db_session: AsyncSession, story_id: UUID) -> StoryProgressOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return StoryProgressOut.model_validate(story_progress(graph))

    @get(
        "/manuscript",
        summary="Compile the manuscript as Markdown",
        description=(
            "Chapters in order, scenes in order, separated by a scene break. Undrafted "
            "chapters are marked rather than silently skipped, so the export doubles as a "
            "to-do list. This tool augments a writer's process; the words must always be "
            "able to leave."
        ),
        media_type=MediaType.TEXT,
    )
    async def get_manuscript(
        self, db_session: AsyncSession, story_id: UUID, include_unplaced: bool = True
    ) -> Response[str]:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        markdown = compile_manuscript(graph, include_unplaced=include_unplaced)
        filename = (graph.story.title or "manuscript").replace(" ", "-").lower()
        return Response(
            content=markdown,
            media_type="text/markdown",
            headers={"content-disposition": f'attachment; filename="{filename}.md"'},
        )
