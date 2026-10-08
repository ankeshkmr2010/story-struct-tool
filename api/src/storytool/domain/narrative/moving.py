"""Moving scenes between and within chapters, and chapters within a story.

The position is expressed as a neighbour (`after` or `before`) rather than an index, because
an index is only meaningful against a list the client fetched a moment ago. A neighbour id
still means the same thing if someone else inserted a scene in between.

The server computes `sort_key`, never the client: midpoint arithmetic plus the rebalance case
is exactly the kind of thing that goes subtly wrong in two places at once.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.narrative.models import Chapter, Scene
from storytool.domain.ordering import place_between


class MoveError(ValueError):
    """The requested position does not exist or is not in the target container."""


@dataclass(frozen=True, slots=True)
class MoveResult:
    sort_key: float
    rebalanced: bool
    chapter_id: UUID | None = None


def _target_index(ordered_ids: list[UUID], after_id: UUID | None, before_id: UUID | None) -> int:
    """Where the moved item lands among its siblings, the item itself already removed."""
    if after_id is not None:
        if after_id not in ordered_ids:
            raise MoveError("The scene to move after is not in the target chapter.")
        return ordered_ids.index(after_id) + 1
    if before_id is not None:
        if before_id not in ordered_ids:
            raise MoveError("The scene to move before is not in the target chapter.")
        return ordered_ids.index(before_id)
    # No neighbour given: append.
    return len(ordered_ids)


async def move_scene(
    session: AsyncSession,
    scene: Scene,
    *,
    chapter_id: UUID | None = None,
    keep_chapter: bool = True,
    after_scene_id: UUID | None = None,
    before_scene_id: UUID | None = None,
) -> MoveResult:
    """Reposition a scene, optionally into a different chapter.

    `keep_chapter` distinguishes "no chapter_id supplied" from "chapter_id supplied as null",
    which means unplacing the scene -- a legal state, since a scene may exist before it
    belongs anywhere.
    """
    if after_scene_id is not None and before_scene_id is not None:
        raise MoveError("Give either after_scene_id or before_scene_id, not both.")
    if after_scene_id == scene.id or before_scene_id == scene.id:
        raise MoveError("A scene cannot be positioned relative to itself.")

    target_chapter = scene.chapter_id if keep_chapter else chapter_id

    siblings = (
        (
            await session.execute(
                select(Scene)
                .where(Scene.story_id == scene.story_id, Scene.chapter_id == target_chapter)
                .order_by(Scene.sort_key.asc(), Scene.id.asc())
            )
        )
        .scalars()
        .all()
    )
    # The moved scene is not its own neighbour.
    others = [s for s in siblings if s.id != scene.id]

    index = _target_index([s.id for s in others], after_scene_id, before_scene_id)
    sort_key, fresh = place_between([s.sort_key for s in others], index)

    if fresh is not None:
        for sibling, key in zip(others, fresh, strict=True):
            sibling.sort_key = key

    scene.chapter_id = target_chapter
    scene.sort_key = sort_key
    await session.flush()
    return MoveResult(sort_key=sort_key, rebalanced=fresh is not None, chapter_id=target_chapter)


async def move_chapter(
    session: AsyncSession,
    chapter: Chapter,
    *,
    after_chapter_id: UUID | None = None,
    before_chapter_id: UUID | None = None,
) -> MoveResult:
    """Reposition a chapter within its story.

    Note `number` is left alone: it is the author's label, not the ordering. Renumbering on
    every move would fight an author who deliberately has a "Chapter 0" or an interlude.
    """
    if after_chapter_id is not None and before_chapter_id is not None:
        raise MoveError("Give either after_chapter_id or before_chapter_id, not both.")
    if after_chapter_id == chapter.id or before_chapter_id == chapter.id:
        raise MoveError("A chapter cannot be positioned relative to itself.")

    siblings = (
        (
            await session.execute(
                select(Chapter)
                .where(Chapter.story_id == chapter.story_id)
                .order_by(Chapter.sort_key.asc(), Chapter.id.asc())
            )
        )
        .scalars()
        .all()
    )
    others = [c for c in siblings if c.id != chapter.id]

    try:
        index = _target_index([c.id for c in others], after_chapter_id, before_chapter_id)
    except MoveError as exc:
        raise MoveError(
            str(exc).replace("scene", "chapter").replace("chapter chapter", "chapter")
        ) from exc

    sort_key, fresh = place_between([c.sort_key for c in others], index)
    if fresh is not None:
        for sibling, key in zip(others, fresh, strict=True):
            sibling.sort_key = key

    chapter.sort_key = sort_key
    await session.flush()
    return MoveResult(sort_key=sort_key, rebalanced=fresh is not None)
