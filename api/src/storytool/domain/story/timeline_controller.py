"""Read the global story timeline without storing a second copy of its structure."""

from uuid import UUID

from litestar import Controller, get, put
from litestar.exceptions import NotFoundException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.analysis import load_graph_by_id
from storytool.domain.cast.models import Character
from storytool.domain.narrative.models import Scene, SceneCharacterMention
from storytool.domain.noticing.schemas import MentionOut
from storytool.domain.structure.models import Event, event_character
from storytool.domain.timeline import TimelineOut, build_timeline


class CharacterPresenceUpdate(BaseModel):
    is_present: bool


class TimelineController(Controller):
    path = "/api/stories/{story_id:uuid}"
    tags = ["timeline"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get("/timeline", summary="Global world-time timeline with character appearances")
    async def timeline(self, db_session: AsyncSession, story_id: UUID) -> TimelineOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail="Story not found")
        mentions = await db_session.execute(
            select(SceneCharacterMention)
            .join(Scene, Scene.id == SceneCharacterMention.scene_id)
            .where(Scene.story_id == story_id, SceneCharacterMention.is_rejected.is_(False))
        )
        event_people = await db_session.execute(
            select(event_character.c.event_id, event_character.c.character_id)
            .join(Event, Event.id == event_character.c.event_id)
            .where(Event.story_id == story_id)
        )
        return build_timeline(
            graph,
            {(row.scene_id, row.character_id): row.source for row in mentions.scalars()},
            [(row.event_id, row.character_id) for row in event_people],
        )

    @put(
        "/events/{event_id:uuid}/presence/{character_id:uuid}",
        summary="Record or remove a character's involvement in a story event",
    )
    async def set_event_presence(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        event_id: UUID,
        character_id: UUID,
        data: CharacterPresenceUpdate,
    ) -> dict[str, bool]:
        event = await db_session.scalar(
            select(Event.id).where(Event.id == event_id, Event.story_id == story_id)
        )
        character = await db_session.scalar(
            select(Character.id).where(Character.id == character_id, Character.story_id == story_id)
        )
        if event is None or character is None:
            raise NotFoundException(detail="Event or character not found")
        if data.is_present:
            await db_session.execute(
                insert(event_character)
                .values(event_id=event_id, character_id=character_id)
                .on_conflict_do_nothing()
            )
        else:
            await db_session.execute(
                delete(event_character).where(
                    event_character.c.event_id == event_id,
                    event_character.c.character_id == character_id,
                )
            )
        return {"is_present": data.is_present}

    @put(
        "/scenes/{scene_id:uuid}/presence/{character_id:uuid}",
        summary="Record or remove a character's presence in a scene",
    )
    async def set_presence(
        self,
        db_session: AsyncSession,
        story_id: UUID,
        scene_id: UUID,
        character_id: UUID,
        data: CharacterPresenceUpdate,
    ) -> MentionOut:
        scene = await db_session.scalar(
            select(Scene.id).where(Scene.id == scene_id, Scene.story_id == story_id)
        )
        character = await db_session.scalar(
            select(Character.id).where(Character.id == character_id, Character.story_id == story_id)
        )
        if scene is None or character is None:
            raise NotFoundException(detail="Scene or character not found")
        # Preserve a rejected row so a later noticing pass cannot resurrect this person.
        stmt = (
            insert(SceneCharacterMention)
            .values(
                scene_id=scene_id,
                character_id=character_id,
                source="manual",
                is_rejected=not data.is_present,
            )
            .on_conflict_do_update(
                constraint="one_per_pair",
                set_={"source": "manual", "is_rejected": not data.is_present},
            )
            .returning(SceneCharacterMention)
        )
        mention = (await db_session.execute(stmt)).scalar_one()
        return MentionOut.model_validate(mention)
