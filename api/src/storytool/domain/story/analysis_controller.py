"""Endpoints that expose the computed layer: ladder, health, scaffold.

None of these store anything derived. Every response is recomputed from the graph on
request, which is why `completeness`, `readiness` and `is_fulfilled` can never drift out
of sync with the data they describe.
"""

from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import NotFoundException
from litestar.params import Parameter
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.analysis import load_graph_by_id, snapshot_from_graph
from storytool.domain.decisions.nudges import read_nudges
from storytool.domain.decisions.providers import shared_provider
from storytool.domain.decisions.service import Actor, DecisionService
from storytool.domain.enums import Level
from storytool.domain.health import Severity, run_health
from storytool.domain.scaffolding import scaffold_story
from storytool.domain.story.schemas import (
    FindingOut,
    HealthOut,
    LadderOut,
    ScaffoldOut,
    SnapshotOut,
)


class StoryAnalysisController(Controller):
    path = "/api/stories/{story_id:uuid}"
    tags = ["analysis"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/ladder", summary="Level readiness for a story")
    async def get_ladder(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> LadderOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        snapshot = snapshot_from_graph(graph)
        state = {
            "mode": graph.story.authoring_mode,
            "premise": graph.story.premise,
            "genre": graph.story.genre,
            "characters": [
                {"name": c.name, "role": c.role, "want": c.want, "need": c.need}
                for c in graph.characters
            ],
            "turning_points": [
                {"label": e.label, "description": e.description}
                for e in graph.events
                if e.is_turning_point
            ],
            "acts": [
                {
                    "title": a.title,
                    "summary": a.summary,
                    "from": a.emotional_shift_from,
                    "to": a.emotional_shift_to,
                }
                for a in graph.acts
            ],
            "beats": [{"label": b.label, "description": b.description} for b in graph.beats],
            "threads": [{"title": t.title, "type": t.type, "mice": t.mice} for t in graph.threads],
            "chapters": [{"title": c.title, "summary": c.summary} for c in graph.chapters],
            "scenes": [{"title": s.title, "summary": s.summary} for s in graph.scenes],
        }
        service, model = None, ""
        if get_settings().shared_reader_available and graph.story.authoring_mode != "pantser":
            provider, model = shared_provider()
            service = DecisionService(
                db_session, Actor.user(request.scope["state"]["storytool_user_id"]), provider
            )
        await db_session.commit()
        levels = await read_nudges(service, model, state)
        furthest = next((max(1, rung.level - 1) for rung in levels if not rung.is_ready), 8)
        return LadderOut(
            story_id=story_id,
            furthest_ready_level=furthest,
            levels=levels,
            snapshot=SnapshotOut.model_validate(snapshot),
        )

    @get("/health", summary="Structural health findings")
    async def get_health(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        max_level: int = Parameter(
            default=int(Level.SCENES),
            ge=1,
            le=8,
            description="Only run rules at or below this level.",
        ),
    ) -> HealthOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        findings = run_health(graph, max_level=Level(max_level))
        return HealthOut(
            story_id=story_id,
            max_level=max_level,
            warning_count=sum(1 for f in findings if f.severity is Severity.WARNING),
            info_count=sum(1 for f in findings if f.severity is Severity.INFO),
            findings=[
                FindingOut(
                    code=f.code,
                    level=int(f.level),
                    severity=f.severity.value,
                    message=f.message,
                    entity_type=f.entity_type,
                    entity_id=f.entity_id,
                )
                for f in findings
            ],
        )

    @post("/scaffold", summary="Seed acts and beats from the story's framework")
    async def scaffold(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        framework: str | None = Parameter(
            default=None, description="Override the story's framework; additive, never destructive."
        ),
    ) -> ScaffoldOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        result = await scaffold_story(db_session, graph.story, graph, framework_key=framework)
        return ScaffoldOut(
            story_id=story_id,
            framework=result.framework,
            acts_created=result.acts_created,
            beats_created=result.beats_created,
            changed=result.changed,
        )
