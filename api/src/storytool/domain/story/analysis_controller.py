"""Endpoints that expose the computed layer: ladder, health, scaffold.

None of these store anything derived. Every response is recomputed from the graph on
request, which is why `completeness`, `readiness` and `is_fulfilled` can never drift out
of sync with the data they describe.
"""

from uuid import UUID

from litestar import Controller, get, post
from litestar.exceptions import NotFoundException
from litestar.params import Parameter
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id, snapshot_from_graph
from storytool.domain.enums import Level
from storytool.domain.health import Severity, run_health
from storytool.domain.readiness import furthest_ready_level, ladder
from storytool.domain.scaffolding import scaffold_story
from storytool.domain.story.schemas import (
    FindingOut,
    HealthOut,
    LadderOut,
    ReadinessOut,
    ScaffoldOut,
    SnapshotOut,
)


class StoryAnalysisController(Controller):
    path = "/api/stories/{story_id:uuid}"
    tags = ["analysis"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/ladder", summary="Level readiness for a story")
    async def get_ladder(self, db_session: AsyncSession, story_id: UUID) -> LadderOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        snapshot = snapshot_from_graph(graph)
        return LadderOut(
            story_id=story_id,
            furthest_ready_level=int(furthest_ready_level(snapshot)),
            levels=[
                ReadinessOut(
                    level=int(rung.level),
                    label=rung.label,
                    is_ready=rung.is_ready,
                    blocked_by=rung.blocked_by,
                )
                for rung in ladder(snapshot)
            ],
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
