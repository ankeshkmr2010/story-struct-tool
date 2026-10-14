"""Owner-requested triage of submitted reader comments, never private drafts."""

import asyncio
from collections import defaultdict
from uuid import UUID

from litestar import Controller, Request, post
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.config import get_settings
from storytool.domain.decisions.providers import shared_provider
from storytool.domain.decisions.service import Actor, DecisionService, DecisionUnavailable
from storytool.domain.decisions.types import Choice, Score
from storytool.domain.story.beta import BetaMessage, BetaThread, owner_round
from storytool.domain.story.sharing import actor

CATEGORIES = {
    "confusion": "The reader could not follow an event, reference or explanation.",
    "pacing": "The reader comments on speed, repetition or the distribution of attention.",
    "character": "The reader comments on motivation, voice, relationships or credibility.",
    "typo": "The reader identifies a spelling, grammar or small wording issue.",
    "praise": "The reader describes something that worked well.",
}
SEVERITY = [
    "Small or optional observation.",
    "A local issue worth checking.",
    "An issue affecting this scene or chapter.",
    "A major issue affecting understanding or engagement.",
]


class CommentTriage(BaseModel):
    message_id: UUID
    thread_id: UUID
    category: str
    severity: float
    confidence: float
    uncertain: bool


class ChapterFeedback(BaseModel):
    chapter_id: UUID | None
    category: str
    readers: int
    comments: int


class BetaTriageOut(BaseModel):
    items: list[CommentTriage] = Field(default_factory=list)
    chapters: list[ChapterFeedback] = Field(default_factory=list)
    unavailable_count: int = 0
    notice: str | None = None


class BetaTriageController(Controller):
    path = "/api/beta/manage/{story_id:uuid}/rounds/{round_id:uuid}/triage"
    tags = ["beta"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(summary="Classify submitted reader feedback for this owned beta round")
    async def read(
        self, request: Request, db_session: AsyncSession, story_id: UUID, round_id: UUID
    ) -> BetaTriageOut:
        await owner_round(db_session, request, story_id, round_id)
        statement = (
            select(
                BetaMessage.id,
                BetaMessage.body,
                BetaThread.id,
                BetaThread.chapter_id,
                BetaThread.reader_id,
            )
            .join(BetaThread, BetaThread.id == BetaMessage.thread_id)
            .where(
                BetaThread.round_id == round_id,
                BetaThread.submitted.is_(True),
                BetaMessage.submitted.is_(True),
                BetaMessage.deleted.is_(False),
                BetaMessage.user_id == BetaThread.reader_id,
            )
            .order_by(BetaMessage.created_at, BetaMessage.id)
        )
        rows = (await db_session.execute(statement)).all()
        result = BetaTriageOut()
        if not get_settings().shared_reader_available:
            result.unavailable_count = len(rows)
            result.notice = "The shared reader is not configured yet."
            return result
        provider, model = shared_provider()
        service = DecisionService(db_session, Actor.user(actor(request)), provider)
        await db_session.commit()
        gate = asyncio.Semaphore(8)
        questions = {
            "category": Choice(
                instructions=(
                    "Choose the primary purpose of this reader comment. Classify the "
                    "feedback, not the reader. Mixed feedback may be uncertain."
                ),
                criteria=CATEGORIES,
            ),
            "severity": Score(
                instructions=(
                    "How much does the reported issue affect the reading experience? "
                    "Praise and optional preference are level zero. Do not infer "
                    "problems absent from the comment."
                ),
                criteria=SEVERITY,
            ),
        }

        async def classify(row):
            async with gate:
                try:
                    reading = await service.evaluate(
                        model=model, state={"comment": row.body}, questions=questions
                    )
                except DecisionUnavailable:
                    return None
                category, severity = reading.answers["category"], reading.answers["severity"]
                confidence = min(category.confidence or 0, severity.confidence or 0)
                return CommentTriage(
                    message_id=row[0],
                    thread_id=row[2],
                    category=category.choice,
                    severity=severity.score,
                    confidence=confidence,
                    uncertain=confidence
                    < get_settings().decision_threshold(
                        "beta.triage", reading.model, service.provider.identity, "beta-v1", 0.75
                    ),
                )

        readings = await asyncio.gather(*(classify(row) for row in rows))
        if rows != (await db_session.execute(statement)).all():
            return BetaTriageOut(
                notice="Feedback changed during the reading. Summarise again for current results."
            )
        groups = defaultdict(lambda: {"readers": set(), "comments": 0})
        for row, reading in zip(rows, readings, strict=True):
            if reading is None:
                result.unavailable_count += 1
                continue
            result.items.append(reading)
            if not reading.uncertain:
                group = groups[(row[3], reading.category)]
                group["readers"].add(row[4])
                group["comments"] += 1
        result.chapters = [
            ChapterFeedback(
                chapter_id=chapter,
                category=category,
                readers=len(group["readers"]),
                comments=group["comments"],
            )
            for (chapter, category), group in groups.items()
        ]
        return result
