"""Merge a duplicate character into another, after the author has seen what will move.

Noticing or an import can leave one person as two characters ("Mags" and "Maya"). Merging
moves everything that points at the duplicate onto the character being kept -- POV of scenes
and chapters, scene mentions, event participation, relationships, arcs, thread ownership,
suggestions and reference images -- folds the duplicate's name and aliases into the kept
character's aliases, then deletes the duplicate. It runs as one write, so the request's
story checkpoint covers it and it can be restored from History like any other edit.

Two things cannot simply move: a relationship *between* the two becomes meaningless and is
removed, and when both appear in the same scene or event the stronger record is kept (a
confirmed or manual mention over an inferred one, a kept one over a rejected one). The
preview reports both. Prose is untouched here; the page then offers the usual rename.
"""

from uuid import UUID

from litestar import Controller, get, post
from litestar.exceptions import ClientException, NotFoundException
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Arc, Character, Relationship
from storytool.domain.narrative.models import Chapter, Scene, SceneCharacterMention, Suggestion
from storytool.domain.story.image_models import StoryImage
from storytool.domain.structure.models import Thread, event_character

__all__ = ("CharacterMergeController", "MergePreview")

_SOURCE_RANK = {"inferred": 0, "manual": 1, "confirmed": 2}


class MergePreview(BaseModel):
    source_id: UUID
    target_id: UUID
    source_name: str
    target_name: str
    pov_scenes: int
    pov_chapters: int
    mentions: int
    events: int
    relationships: int
    relationships_removed: int
    arcs: int
    threads: int
    images: int
    aliases_added: list[str]


class MergeIn(BaseModel):
    into_id: UUID


async def _pair(db: AsyncSession, story_id: UUID, source_id: UUID, target_id: UUID):
    if source_id == target_id:
        raise ClientException(detail="Choose a different character to merge into")
    rows = (
        await db.scalars(
            select(Character).where(
                Character.story_id == story_id, Character.id.in_([source_id, target_id])
            )
        )
    ).all()
    found = {row.id: row for row in rows}
    if source_id not in found or target_id not in found:
        raise NotFoundException(detail="Both characters must belong to this story")
    return found[source_id], found[target_id]


def _new_aliases(source: Character, target: Character) -> list[str]:
    have = {target.name.casefold(), *(alias.casefold() for alias in target.aliases or ())}
    added: list[str] = []
    for name in (source.name, *(source.aliases or ())):
        if name.strip() and name.casefold() not in have:
            have.add(name.casefold())
            added.append(name)
    return added


def _images_with(images: list[StoryImage], source_id: UUID) -> list[StoryImage]:
    return [
        image
        for image in images
        if any(
            a.get("entity") == "character" and a.get("id") == str(source_id)
            for a in image.attachments or ()
        )
    ]


async def _count(db: AsyncSession, statement) -> int:
    return int(await db.scalar(statement) or 0)


async def preview(
    db: AsyncSession, story_id: UUID, source_id: UUID, target_id: UUID
) -> MergePreview:
    source, target = await _pair(db, story_id, source_id, target_id)
    between = or_(
        (Relationship.character_a_id == source_id) & (Relationship.character_b_id == target_id),
        (Relationship.character_a_id == target_id) & (Relationship.character_b_id == source_id),
    )
    involving = or_(
        Relationship.character_a_id == source_id, Relationship.character_b_id == source_id
    )
    images = (await db.scalars(select(StoryImage).where(StoryImage.story_id == story_id))).all()
    return MergePreview(
        source_id=source_id,
        target_id=target_id,
        source_name=source.name,
        target_name=target.name,
        pov_scenes=await _count(
            db, select(func.count()).where(Scene.pov_character_id == source_id)
        ),
        pov_chapters=await _count(
            db, select(func.count()).where(Chapter.pov_character_id == source_id)
        ),
        mentions=await _count(
            db, select(func.count()).where(SceneCharacterMention.character_id == source_id)
        ),
        events=await _count(
            db, select(func.count()).where(event_character.c.character_id == source_id)
        ),
        relationships=await _count(db, select(func.count()).where(involving, ~between)),
        relationships_removed=await _count(db, select(func.count()).where(between)),
        arcs=await _count(db, select(func.count()).where(Arc.character_id == source_id)),
        threads=await _count(
            db, select(func.count()).where(Thread.owner_character_id == source_id)
        ),
        images=len(_images_with(list(images), source_id)),
        aliases_added=_new_aliases(source, target),
    )


async def merge(db: AsyncSession, story_id: UUID, source_id: UUID, target_id: UUID) -> MergePreview:
    summary = await preview(db, story_id, source_id, target_id)
    source, target = await _pair(db, story_id, source_id, target_id)

    for column in (
        Scene.pov_character_id,
        Chapter.pov_character_id,
        Arc.character_id,
        Thread.owner_character_id,
        Suggestion.character_id,
    ):
        await db.execute(
            update(column.class_).where(column == source_id).values({column.key: target_id})
        )

    # A relationship between the two has no meaning once they are one person.
    await db.execute(
        delete(Relationship).where(
            or_(
                (Relationship.character_a_id == source_id)
                & (Relationship.character_b_id == target_id),
                (Relationship.character_a_id == target_id)
                & (Relationship.character_b_id == source_id),
            )
        )
    )
    await db.execute(
        update(Relationship)
        .where(Relationship.character_a_id == source_id)
        .values(character_a_id=target_id)
    )
    await db.execute(
        update(Relationship)
        .where(Relationship.character_b_id == source_id)
        .values(character_b_id=target_id)
    )

    # Scene mentions: one per scene and character, so keep the stronger of the two.
    kept = {
        row.scene_id: row
        for row in (
            await db.scalars(
                select(SceneCharacterMention).where(SceneCharacterMention.character_id == target_id)
            )
        ).all()
    }
    for row in (
        await db.scalars(
            select(SceneCharacterMention).where(SceneCharacterMention.character_id == source_id)
        )
    ).all():
        mine = kept.get(row.scene_id)
        if mine is None:
            row.character_id = target_id
            continue
        if (not row.is_rejected, _SOURCE_RANK.get(row.source, 0)) > (
            not mine.is_rejected,
            _SOURCE_RANK.get(mine.source, 0),
        ):
            mine.is_rejected, mine.source = row.is_rejected, row.source
        await db.delete(row)

    already = set(
        (
            await db.scalars(
                select(event_character.c.event_id).where(
                    event_character.c.character_id == target_id
                )
            )
        ).all()
    )
    await db.execute(
        delete(event_character).where(
            event_character.c.character_id == source_id, event_character.c.event_id.in_(already)
        )
    )
    await db.execute(
        update(event_character)
        .where(event_character.c.character_id == source_id)
        .values(character_id=target_id)
    )

    for image in _images_with(
        list((await db.scalars(select(StoryImage).where(StoryImage.story_id == story_id))).all()),
        source_id,
    ):
        attachments, seen = [], set()
        for attachment in image.attachments or ():
            item = dict(attachment)
            if item.get("entity") == "character" and item.get("id") == str(source_id):
                item["id"] = str(target_id)
            key = (item.get("entity"), item.get("id"))
            if key not in seen:
                seen.add(key)
                attachments.append(item)
        image.attachments = attachments

    target.aliases = [*(target.aliases or ()), *summary.aliases_added]
    await db.flush()
    await db.delete(source)
    await db.flush()
    return summary


class CharacterMergeController(Controller):
    path = "/api/stories/{story_id:uuid}/characters/{character_id:uuid}"
    tags = ["cast"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/merge-preview", summary="What merging this character into another would move")
    async def merge_preview(
        self, db_session: AsyncSession, story_id: UUID, character_id: UUID, into_id: UUID
    ) -> MergePreview:
        return await preview(db_session, story_id, character_id, into_id)

    @post("/merge", status_code=200, summary="Merge this character into another, then delete it")
    async def merge_character(
        self, db_session: AsyncSession, story_id: UUID, character_id: UUID, data: MergeIn
    ) -> MergePreview:
        return await merge(db_session, story_id, character_id, data.into_id)
