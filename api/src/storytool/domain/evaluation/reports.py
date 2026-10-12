"""Saved AI reviews: one row per run, so the history is kept.

A report is an AI's judgement, not derived state, which is why it is stored at all. It records
the editing fingerprint it judged; once the story changes the report is shown as stale rather
than silently describing a different draft.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from litestar.exceptions import ClientException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.evaluation.engine import Review
from storytool.domain.graph import StoryGraph

VERDICTS = ("works", "consider", "needs_change")
MAX_FIXES = 2


class EvaluationReport(StoryToolBase):
    __tablename__ = "evaluation_report"

    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    evaluator_id: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(20))
    """"mcp" (an external agent) or "assistant" (the author's connected key)."""
    model: Mapped[str | None] = mapped_column(String(200), default=None)
    base_fingerprint: Mapped[str] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(Text)
    verdicts: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)


class VerdictIn(BaseModel):
    entity_id: UUID
    verdict: Literal["works", "consider", "needs_change"]
    evidence: str = Field(min_length=1, max_length=2000)
    scene_ids: list[UUID] = Field(default_factory=list, max_length=20)
    fixes: list[str] = Field(default_factory=list, max_length=MAX_FIXES)

    @model_validator(mode="after")
    def needs_change_has_fixes(self) -> "VerdictIn":
        if self.verdict == "needs_change" and not any(fix.strip() for fix in self.fixes):
            raise ValueError("A needs_change verdict needs one or two fixes")
        return self


class ReportIn(BaseModel):
    base_fingerprint: str = Field(min_length=1, max_length=128)
    summary: str = Field(min_length=1, max_length=4000)
    verdicts: list[VerdictIn] = Field(min_length=1, max_length=100)


class ReportOut(BaseModel):
    id: UUID
    evaluator_id: str
    source: str
    model: str | None
    summary: str
    verdicts: list[dict[str, Any]]
    base_fingerprint: str
    created_at: datetime
    stale: bool


class PackageOut(BaseModel):
    story_id: UUID
    evaluator_id: str
    base_fingerprint: str
    subject: str
    instructions: str
    inputs: dict[str, Any]
    result_schema: dict[str, Any]


def result_schema(subject: str) -> dict[str, Any]:
    """What `submit_evaluation_report` expects, in JSON Schema, for agents and the runner."""
    return {
        "type": "object",
        "required": ["summary", "verdicts"],
        "properties": {
            "summary": {"type": "string", "description": "Two or three sentences overall."},
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["entity_id", "verdict", "evidence"],
                    "properties": {
                        "entity_id": {"type": "string", "description": f"The {subject} id."},
                        "verdict": {"type": "string", "enum": list(VERDICTS)},
                        "evidence": {"type": "string"},
                        "scene_ids": {"type": "array", "items": {"type": "string"}},
                        "fixes": {
                            "type": "array",
                            "items": {"type": "string"},
                            "maxItems": MAX_FIXES,
                            "description": "Required (1-2) when verdict is needs_change.",
                        },
                    },
                },
            },
        },
    }


def checked_verdicts(g: StoryGraph, review: Review, data: ReportIn) -> list[dict[str, Any]]:
    """Every subject and cited scene must belong to this story; one verdict per subject."""
    subjects = {
        "thread": {t.id for t in g.threads},
        "scene": {s.id for s in g.scenes},
        "character": {c.id for c in g.characters},
    }.get(review.subject, set())
    scenes = {s.id for s in g.scenes}
    seen: set[UUID] = set()
    out = []
    for item in data.verdicts:
        if item.entity_id not in subjects:
            raise ClientException(detail=f"Unknown {review.subject} {item.entity_id} in report")
        if item.entity_id in seen:
            raise ClientException(detail=f"Two verdicts for {review.subject} {item.entity_id}")
        seen.add(item.entity_id)
        unknown = [str(scene_id) for scene_id in item.scene_ids if scene_id not in scenes]
        if unknown:
            raise ClientException(detail=f"Unknown scene ids in report: {', '.join(unknown)}")
        out.append(
            {
                "entity_type": review.subject,
                "entity_id": str(item.entity_id),
                "verdict": item.verdict,
                "evidence": item.evidence.strip(),
                "scene_ids": [str(scene_id) for scene_id in item.scene_ids],
                "fixes": [fix.strip() for fix in item.fixes if fix.strip()],
            }
        )
    return out
