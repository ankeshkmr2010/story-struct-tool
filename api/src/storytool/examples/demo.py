"""Seed the full Red-Headed League demo: a curated story exported as a backup fixture."""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.story.authorship import FieldAuthorship, record_changes
from storytool.domain.story.backup import rehome, validated_state
from storytool.domain.story.models import Story
from storytool.domain.versioning.service import checkpoint, full_state, restore_state

FIXTURE = Path(__file__).with_name("red_headed_league.json")
# Earlier starter outlines, replaced by the demo. Only copies nobody edited are retired.
RETIRED_TITLES = ("The Blue Carbuncle", "The Red-Headed League")


async def retire_old_examples(session: AsyncSession, user_id: UUID) -> None:
    edited = (
        select(FieldAuthorship.id)
        .where(FieldAuthorship.story_id == Story.id, FieldAuthorship.origin != "system")
        .exists()
    )
    await session.execute(
        update(Story)
        .where(
            Story.user_id == user_id,
            Story.title.in_(RETIRED_TITLES),
            Story.deleted_at.is_(None),
            ~edited,
        )
        .values(deleted_at=datetime.now(UTC))
    )


async def seed_demo(session: AsyncSession, user_id: UUID) -> Story:
    state = validated_state(json.loads(FIXTURE.read_text(encoding="utf-8")))
    story = Story(title=state["story"][0]["title"], user_id=user_id)
    session.add(story)
    await session.flush()
    await restore_state(session, story.id, rehome(state, story.id, strict=True))
    await session.refresh(story)
    await record_changes(
        session, story.id, user_id, {}, await full_state(session, story.id), "system", "Demo story"
    )
    await checkpoint(session, story.id, user_id, "Demo story", "initial")
    return story
