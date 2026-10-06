"""Litestar application factory."""

from litestar import Litestar, get
from litestar.openapi import OpenAPIConfig

from storytool.config import get_settings
from storytool.db.plugin import build_db_plugin
from storytool.domain.cast.controller import (
    ArcController,
    ArcStageController,
    CharacterController,
    RelationshipController,
)
from storytool.domain.narrative.controller import ChapterController, SceneController
from storytool.domain.narrative.prose_controller import (
    ManuscriptController,
    SceneProseController,
)
from storytool.domain.noticing.controller import NoticingController
from storytool.domain.story.analysis_controller import StoryAnalysisController
from storytool.domain.story.controller import StoryController
from storytool.domain.structure.controller import (
    ActController,
    BeatController,
    EventController,
    ThreadController,
)
from storytool.domain.world.controller import ContinuityController, LocationController


@get("/api/health", tags=["meta"], summary="Liveness probe", sync_to_thread=False)
def health() -> dict[str, str]:
    return {"status": "ok"}


def create_app() -> Litestar:
    settings = get_settings()
    return Litestar(
        route_handlers=[
            health,
            StoryController,
            StoryAnalysisController,
            EventController,
            ActController,
            BeatController,
            ThreadController,
            CharacterController,
            RelationshipController,
            ArcController,
            ArcStageController,
            ChapterController,
            SceneController,
            SceneProseController,
            ManuscriptController,
            NoticingController,
            LocationController,
            ContinuityController,
        ],
        plugins=[build_db_plugin()],
        debug=settings.debug,
        openapi_config=OpenAPIConfig(
            title="StoryTool API",
            version="0.1.0",
            description="Structural planning and writing tool for fiction.",
            path="/api/schema",
        ),
    )


app = create_app()
