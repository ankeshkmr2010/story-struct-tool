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
    # Titles are encrypted at rest, so they are compared after reading.
    candidates = (
        await session.execute(
            select(Story.id, Story.title).where(
                Story.user_id == user_id, Story.deleted_at.is_(None), ~edited
            )
        )
    ).all()
    retired = [story_id for story_id, title in candidates if title in RETIRED_TITLES]
    if retired:
        # "fetch": evaluating in memory would refresh expired objects, which async cannot do.
        await session.execute(
            update(Story)
            .where(Story.id.in_(retired))
            .values(deleted_at=datetime.now(UTC))
            .execution_options(synchronize_session="fetch")
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


async def fill_demo_speakers(session: AsyncSession, user_id: UUID) -> None:
    """Give demo copies seeded before speakers existed the fixture's speakers. A line is matched
    by scene title, quote text and occurrence; only lines without a speaker are filled, so an
    edited copy keeps its own choices and changed lines stay empty."""
    from storytool.domain.analysis import load_graph_by_id
    from storytool.domain.evaluation.dialogue_voice import extract
    from storytool.domain.narrative.models import DialogueSpeaker

    state = json.loads(FIXTURE.read_text(encoding="utf-8"))["state"]
    title = state["story"][0]["title"]
    scene_titles = {row["id"]: row["title"] for row in state["scene"]}
    names = {row["id"]: row["name"] for row in state["character"]}
    known = {
        (scene_titles[row["scene_id"]], row["quote_text"], row["occurrence"]): (
            names[row["character_id"]],
            row["source"],
        )
        for row in state.get("dialogue_speaker", [])
    }
    candidates = (
        await session.execute(
            select(Story.id, Story.title).where(
                Story.user_id == user_id, Story.deleted_at.is_(None)
            )
        )
    ).all()
    for story_id, story_title in candidates:
        if story_title != title:
            continue
        graph = await load_graph_by_id(session, story_id)
        if graph is None:
            continue
        titles = {scene.id: scene.title for scene in graph.scenes}
        cast = {character.name: character.id for character in graph.characters}
        for line in extract(graph):
            match = known.get((titles.get(line.scene_id), line.text, line.occurrence))
            if line.source is not None or match is None or match[0] not in cast:
                continue
            session.add(
                DialogueSpeaker(
                    scene_id=line.scene_id,
                    quote_text=line.text,
                    occurrence=line.occurrence,
                    character_id=cast[match[0]],
                    source=match[1],
                )
            )
