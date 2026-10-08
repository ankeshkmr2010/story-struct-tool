"""Litestar application factory."""

from typing import cast

from advanced_alchemy.extensions.litestar import SQLAlchemyAsyncConfig, SQLAlchemyPlugin
from litestar import Litestar, get
from litestar.middleware import DefineMiddleware
from litestar.openapi import OpenAPIConfig

from storytool.config import get_settings
from storytool.db.plugin import build_db_plugin
from storytool.domain.ai.controller import AIController
from storytool.domain.auth.access import StoryAccessMiddleware
from storytool.domain.auth.controller import AuthController
from storytool.domain.auth.oauth_controller import OAuthConsentController
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
from storytool.domain.story.timeline_controller import TimelineController
from storytool.domain.structure.controller import (
    ActController,
    BeatController,
    EventController,
    ThreadController,
)
from storytool.domain.versioning.controller import StoryVersionController
from storytool.domain.world.controller import ContinuityController, LocationController
from storytool.frontend import frontend_router
from storytool.mcp_server import build_mcp
from storytool.oauth_routes import oauth_routes


@get("/api/health", tags=["meta"], summary="Liveness probe", sync_to_thread=False)
def health() -> dict[str, str]:
    return {"status": "ok"}


def create_app(db_plugin: SQLAlchemyPlugin | None = None) -> Litestar:
    """Build the application.

    `db_plugin` exists for tests: each call otherwise builds a fresh engine with its own
    connection pool, and a suite that creates one app per test exhausts Postgres's
    connection limit partway through. Production calls this once.
    """
    settings = get_settings()
    plugin = db_plugin or build_db_plugin()
    frontend = [frontend_router(settings.frontend_dir)] if settings.frontend_dir else []
    config = cast(SQLAlchemyAsyncConfig, plugin.config[0])
    mcp_endpoint, mcp_lifespan = build_mcp(config, lambda: application)
    application = Litestar(
        route_handlers=[
            health,
            mcp_endpoint,
            *oauth_routes(config),
            OAuthConsentController,
            AuthController,
            AIController,
            StoryVersionController,
            StoryController,
            TimelineController,
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
            *frontend,
        ],
        plugins=[plugin],
        lifespan=[mcp_lifespan],
        middleware=[
            DefineMiddleware(
                StoryAccessMiddleware,
                db_config=cast(SQLAlchemyAsyncConfig, plugin.config[0]),
            )
        ],
        debug=settings.debug,
        openapi_config=OpenAPIConfig(
            title="StoryTool API",
            version="0.1.0",
            description="Structural planning and writing tool for fiction.",
            path="/api/schema",
        ),
    )
    return application


app = create_app()
