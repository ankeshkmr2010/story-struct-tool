"""Noticing endpoints: run a pass, review what it found, dismiss what you disagree with.

Everything here is advisory. A pass writes inferred mentions and suggestions; it never
changes a story's structure, never edits prose, and never creates an entity. Acting on an
observation is always the author's explicit next step.
"""

from uuid import UUID

from litestar import Controller, Request, get, patch, post
from litestar.exceptions import NotFoundException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.noticer import user_noticer
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.common import apply_patch
from storytool.domain.narrative.models import SceneCharacterMention, Suggestion
from storytool.domain.noticing.schemas import (
    MentionOut,
    MentionUpdate,
    NoticerInfoOut,
    PassResultOut,
    SuggestionOut,
    SuggestionUpdate,
)
from storytool.domain.noticing.service import run_noticing_pass


class NoticingController(Controller):
    path = "/api"
    tags = ["noticing"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/noticing", summary="Which noticer is active")
    async def noticer_info(self, request: Request, db_session: AsyncSession) -> NoticerInfoOut:
        _, info = await user_noticer(db_session, request.scope["state"]["storytool_user_id"])
        return NoticerInfoOut(**info)  # type: ignore[arg-type]

    @post(
        "/stories/{story_id:uuid}/notice",
        summary="Run a noticing pass over the story's prose",
        description=(
            "Reads each scene with prose and records which known characters appear, which "
            "names match nobody, and which scenes read like turning points. Writes inferred "
            "mentions and suggestions only -- it never alters structure or prose. Rejected "
            "mentions and dismissed suggestions are never resurrected."
        ),
    )
    async def notice(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> PassResultOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        noticer, _ = await user_noticer(db_session, request.scope["state"]["storytool_user_id"])
        result = await run_noticing_pass(db_session, graph, noticer)
        return PassResultOut.model_validate(result)

    # ----------------------------------------------------------- suggestions

    @get("/stories/{story_id:uuid}/suggestions", summary="List suggestions")
    async def list_suggestions(
        self, db_session: AsyncSession, story_id: UUID, include_dismissed: bool = False
    ) -> list[SuggestionOut]:
        stmt = select(Suggestion).where(Suggestion.story_id == story_id)
        if not include_dismissed:
            stmt = stmt.where(Suggestion.is_dismissed.is_(False))
        rows = await db_session.execute(stmt.order_by(Suggestion.created_at.desc()))
        return [SuggestionOut.model_validate(r) for r in rows.scalars().all()]

    @patch(
        "/stories/{story_id:uuid}/suggestions/{suggestion_id:uuid}",
        summary="Dismiss or restore a suggestion",
    )
    async def update_suggestion(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        suggestion_id: UUID,
        data: SuggestionUpdate,
    ) -> SuggestionOut:
        suggestion = (
            await db_session.execute(
                select(Suggestion).where(
                    Suggestion.id == suggestion_id, Suggestion.story_id == story_id
                )
            )
        ).scalar_one_or_none()
        if suggestion is None:
            raise NotFoundException(detail=f"No suggestion {suggestion_id} in this story")
        apply_patch(suggestion, data)
        await db_session.flush()
        return SuggestionOut.model_validate(suggestion)

    # -------------------------------------------------------------- mentions

    @get("/stories/{story_id:uuid}/scenes/{scene_id:uuid}/mentions", summary="Who is in a scene")
    async def list_mentions(
        self, db_session: AsyncSession, story_id: UUID, scene_id: UUID
    ) -> list[MentionOut]:
        rows = await db_session.execute(
            select(SceneCharacterMention).where(SceneCharacterMention.scene_id == scene_id)
        )
        return [MentionOut.model_validate(r) for r in rows.scalars().all()]

    @patch(
        "/stories/{story_id:uuid}/scenes/{scene_id:uuid}/mentions/{character_id:uuid}",
        summary="Confirm or reject an inferred mention",
    )
    async def update_mention(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        scene_id: UUID,
        character_id: UUID,
        data: MentionUpdate,
    ) -> MentionOut:
        mention = (
            await db_session.execute(
                select(SceneCharacterMention).where(
                    SceneCharacterMention.scene_id == scene_id,
                    SceneCharacterMention.character_id == character_id,
                )
            )
        ).scalar_one_or_none()
        if mention is None:
            raise NotFoundException(detail="No such mention on this scene")
        apply_patch(mention, data)
        await db_session.flush()
        return MentionOut.model_validate(mention)
