"""Running a noticing pass and persisting what it found.

Two invariants, both about respecting the author's decisions:

* A mention the author **rejected** is never resurrected, and a mention they **confirmed**
  is never downgraded back to "inferred". Inserts are `ON CONFLICT DO NOTHING`, so a pass
  only ever adds rows it has not seen before.
* A suggestion the author **dismissed** stays dismissed. Same mechanism -- the unique
  constraint on (story, code, subject) means re-proposing it is a no-op.

Without those two, running the pass again would undo the author's curation every time,
which is exactly what would make this feature annoying rather than useful.
"""

from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.graph import StoryGraph
from storytool.domain.narrative.models import SceneCharacterMention, Suggestion
from storytool.domain.noticing.jev import ELEMENT_ABSENT_BELOW
from storytool.domain.noticing.suggestions import NoticingState, propose_suggestions
from storytool.domain.noticing.types import KnownBeat, KnownCharacter


@dataclass(frozen=True, slots=True)
class PassResult:
    noticed_by: str
    scenes_read: int
    mentions_added: int
    unknown_names_found: int
    turning_points_flagged: int
    suggestions_added: int


async def run_noticing_pass(
    session: AsyncSession, graph: StoryGraph, noticer: object
) -> PassResult:
    known_characters = tuple(KnownCharacter(id=c.id, name=c.name) for c in graph.characters)
    known_beats = tuple(
        KnownBeat(id=b.id, label=b.label, description=b.description) for b in graph.beats
    )

    scenes_by_character: dict[UUID, int] = {}
    unknown_counts: dict[str, int] = {}
    turning_points: set[UUID] = set()
    element_gaps: dict[UUID, tuple[str, ...]] = {}
    pending_mentions: list[tuple[UUID, UUID]] = []
    scenes_read = 0
    noticed_by = getattr(noticer, "name", "deterministic")

    # Rows the author has already ruled on, so counts reflect their decisions rather than
    # the raw inference.
    existing = (
        await session.execute(
            select(
                SceneCharacterMention.scene_id,
                SceneCharacterMention.character_id,
                SceneCharacterMention.is_rejected,
            )
        )
    ).all()
    rejected = {(r.scene_id, r.character_id) for r in existing if r.is_rejected}
    already = {(r.scene_id, r.character_id) for r in existing if not r.is_rejected}

    for scene in graph.scenes:
        prose = scene.content or ""
        if not prose.strip():
            continue
        scenes_read += 1

        notices = await noticer.notice_scene(prose, known_characters, known_beats)  # type: ignore[attr-defined]

        for notice in notices.characters:
            pair = (scene.id, notice.character_id)
            if pair in rejected:
                continue  # The author said no. Do not ask again.
            scenes_by_character[notice.character_id] = (
                scenes_by_character.get(notice.character_id, 0) + 1
            )
            if pair not in already:
                pending_mentions.append(pair)

        for unknown in notices.unknown_names:
            unknown_counts[unknown.name] = unknown_counts.get(unknown.name, 0) + 1

        if notices.structure and notices.structure.reads_like_turning_point:
            turning_points.add(scene.id)

        if notices.structure and notices.structure.elements:
            missing = notices.structure.elements.missing(ELEMENT_ABSENT_BELOW)
            if missing:
                element_gaps[scene.id] = missing

    mentions_added = 0
    if pending_mentions:
        result = await session.execute(
            insert(SceneCharacterMention)
            .values(
                [
                    {"scene_id": scene_id, "character_id": character_id, "source": "inferred"}
                    for scene_id, character_id in pending_mentions
                ]
            )
            .on_conflict_do_nothing(constraint="one_per_pair")
        )
        mentions_added = cast("CursorResult[Any]", result).rowcount or 0

    state = NoticingState(
        scenes_by_character=scenes_by_character,
        unknown_name_scene_counts=unknown_counts,
        turning_point_scene_ids=frozenset(turning_points),
        prose_element_gaps=element_gaps,
    )
    proposed = propose_suggestions(graph, state)

    suggestions_added = 0
    if proposed:
        result = await session.execute(
            insert(Suggestion)
            .values(
                [
                    {
                        "story_id": graph.story.id,
                        "code": s.code,
                        "message": s.message,
                        "character_id": s.character_id,
                        "scene_id": s.scene_id,
                        "thread_id": s.thread_id,
                        "subject_key": s.subject_key,
                        "noticed_by": noticed_by,
                    }
                    for s in proposed
                ]
            )
            # Dismissed suggestions stay dismissed; re-proposing is a no-op.
            .on_conflict_do_nothing(constraint="one_per_subject")
        )
        suggestions_added = cast("CursorResult[Any]", result).rowcount or 0

    await session.flush()
    return PassResult(
        noticed_by=noticed_by,
        scenes_read=scenes_read,
        mentions_added=mentions_added,
        unknown_names_found=len(unknown_counts),
        turning_points_flagged=len(turning_points),
        suggestions_added=suggestions_added,
    )


async def characters_present(session: AsyncSession, scene_id: UUID) -> list[UUID]:
    """`Scene.characters_present` from the original brief, as a view over mentions."""
    rows = await session.execute(
        select(SceneCharacterMention.character_id).where(
            SceneCharacterMention.scene_id == scene_id,
            SceneCharacterMention.is_rejected.is_(False),
        )
    )
    return [row.character_id for row in rows]
