"""On-demand story evaluation endpoints.

Both are GETs: a deterministic evaluation is a pure read of the graph, so it needs no write
lock and works for read-only agent tokens too. Nothing is stored.
"""

from typing import Any
from uuid import UUID

from litestar import Controller, get
from litestar.exceptions import NotFoundException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.evaluation import all_evaluators, get_evaluator
from storytool.domain.graph import StoryGraph


class EvaluatorOut(BaseModel):
    id: str
    name: str
    description: str
    kind: str
    inputs: list[str]
    ready: bool
    missing: list[str]


class EvaluationFindingOut(BaseModel):
    code: str
    severity: str
    message: str
    entity_type: str | None
    entity_id: UUID | None


class EvaluationOut(BaseModel):
    story_id: UUID
    evaluator_id: str
    ready: bool
    missing: list[str]
    findings: list[EvaluationFindingOut]
    visual: dict[str, Any]


class EvaluationController(Controller):
    path = "/api/stories/{story_id:uuid}/evaluations"
    tags = ["evaluation"]
    signature_namespace = {"AsyncSession": AsyncSession}

    async def _graph(self, db_session: AsyncSession, story_id: UUID) -> StoryGraph:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return graph

    @get(summary="List evaluators and whether each can run on this story")
    async def list_evaluators(self, db_session: AsyncSession, story_id: UUID) -> list[EvaluatorOut]:
        graph = await self._graph(db_session, story_id)
        out = []
        for evaluator in all_evaluators():
            missing = evaluator.missing(graph)
            out.append(
                EvaluatorOut(
                    id=evaluator.id,
                    name=evaluator.name,
                    description=evaluator.description,
                    kind=evaluator.kind,
                    inputs=list(evaluator.inputs),
                    ready=not missing,
                    missing=missing,
                )
            )
        return out

    @get("/{evaluator_id:str}", summary="Run one evaluator")
    async def run_evaluator(
        self, db_session: AsyncSession, story_id: UUID, evaluator_id: str
    ) -> EvaluationOut:
        evaluator = get_evaluator(evaluator_id)
        if evaluator is None:
            raise NotFoundException(detail=f"No evaluator {evaluator_id!r}")
        graph = await self._graph(db_session, story_id)

        missing = evaluator.missing(graph)
        if missing:
            return EvaluationOut(
                story_id=story_id,
                evaluator_id=evaluator.id,
                ready=False,
                missing=missing,
                findings=[],
                visual={},
            )
        result = evaluator.run(graph)
        return EvaluationOut(
            story_id=story_id,
            evaluator_id=evaluator.id,
            ready=True,
            missing=[],
            findings=[
                EvaluationFindingOut(
                    code=f.code,
                    severity=f.severity.value,
                    message=f.message,
                    entity_type=f.entity_type,
                    entity_id=f.entity_id,
                )
                for f in result.findings
            ],
            visual=result.visual,
        )
