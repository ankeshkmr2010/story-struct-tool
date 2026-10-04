"""CRUD for Level 3: Characters, Relationships, Arcs, ArcStages.

ArcStages nest under their arc rather than under the story, since an arc is their only
meaningful parent.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

from litestar import Controller, delete, get, patch, post
from litestar.di import Provide
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship
from storytool.domain.cast.schemas import (
    ArcCreate,
    ArcOut,
    ArcStageCreate,
    ArcStageOut,
    ArcStageUpdate,
    ArcUpdate,
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
    RelationshipCreate,
    RelationshipOut,
    RelationshipUpdate,
)
from storytool.domain.cast.services import (
    ArcService,
    ArcStageService,
    CharacterService,
    RelationshipService,
)
from storytool.domain.common import apply_patch, fetch_or_404


async def provide_characters(db_session: AsyncSession) -> AsyncGenerator[CharacterService, None]:
    yield CharacterService(session=db_session)


async def provide_relationships(
    db_session: AsyncSession,
) -> AsyncGenerator[RelationshipService, None]:
    yield RelationshipService(session=db_session)


async def provide_arcs(db_session: AsyncSession) -> AsyncGenerator[ArcService, None]:
    yield ArcService(session=db_session)


async def provide_arc_stages(db_session: AsyncSession) -> AsyncGenerator[ArcStageService, None]:
    yield ArcStageService(session=db_session)


class CharacterController(Controller):
    """Level 3. A character with only a name is a legal placeholder."""

    path = "/api/stories/{story_id:uuid}/characters"
    tags = ["characters"]
    dependencies = {"characters": Provide(provide_characters)}
    signature_namespace = {"AsyncSession": AsyncSession, "CharacterService": CharacterService}

    @get(summary="List characters")
    async def list_characters(
        self, characters: CharacterService, story_id: UUID
    ) -> list[CharacterOut]:
        records = await characters.get_many(
            Character.story_id == story_id, order_by=Character.name.asc()
        )
        return [CharacterOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create a character")
    async def create_character(
        self, characters: CharacterService, story_id: UUID, data: CharacterCreate
    ) -> CharacterOut:
        record = await characters.create(Character(story_id=story_id, **data.model_dump()))
        return CharacterOut.model_validate(record)

    @get("/{character_id:uuid}", summary="Get a character")
    async def get_character(
        self, characters: CharacterService, story_id: UUID, character_id: UUID
    ) -> CharacterOut:
        record = await fetch_or_404(characters, "character", id=character_id, story_id=story_id)
        return CharacterOut.model_validate(record)

    @patch("/{character_id:uuid}", summary="Update a character")
    async def update_character(
        self,
        characters: CharacterService,
        story_id: UUID,
        character_id: UUID,
        data: CharacterUpdate,
    ) -> CharacterOut:
        record = await fetch_or_404(characters, "character", id=character_id, story_id=story_id)
        record = await characters.update(apply_patch(record, data))
        return CharacterOut.model_validate(record)

    @delete("/{character_id:uuid}", summary="Delete a character")
    async def delete_character(
        self, characters: CharacterService, story_id: UUID, character_id: UUID
    ) -> None:
        await fetch_or_404(characters, "character", id=character_id, story_id=story_id)
        await characters.delete(character_id)


class RelationshipController(Controller):
    path = "/api/stories/{story_id:uuid}/relationships"
    tags = ["relationships"]
    dependencies = {"relationships": Provide(provide_relationships)}
    signature_namespace = {
        "AsyncSession": AsyncSession,
        "RelationshipService": RelationshipService,
    }

    @get(summary="List relationships")
    async def list_relationships(
        self, relationships: RelationshipService, story_id: UUID
    ) -> list[RelationshipOut]:
        records = await relationships.get_many(Relationship.story_id == story_id)
        return [RelationshipOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create a relationship")
    async def create_relationship(
        self, relationships: RelationshipService, story_id: UUID, data: RelationshipCreate
    ) -> RelationshipOut:
        record = await relationships.create(Relationship(story_id=story_id, **data.model_dump()))
        return RelationshipOut.model_validate(record)

    @get("/{relationship_id:uuid}", summary="Get a relationship")
    async def get_relationship(
        self, relationships: RelationshipService, story_id: UUID, relationship_id: UUID
    ) -> RelationshipOut:
        record = await fetch_or_404(
            relationships, "relationship", id=relationship_id, story_id=story_id
        )
        return RelationshipOut.model_validate(record)

    @patch("/{relationship_id:uuid}", summary="Update a relationship")
    async def update_relationship(
        self,
        relationships: RelationshipService,
        story_id: UUID,
        relationship_id: UUID,
        data: RelationshipUpdate,
    ) -> RelationshipOut:
        record = await fetch_or_404(
            relationships, "relationship", id=relationship_id, story_id=story_id
        )
        record = await relationships.update(apply_patch(record, data))
        return RelationshipOut.model_validate(record)

    @delete("/{relationship_id:uuid}", summary="Delete a relationship")
    async def delete_relationship(
        self, relationships: RelationshipService, story_id: UUID, relationship_id: UUID
    ) -> None:
        await fetch_or_404(relationships, "relationship", id=relationship_id, story_id=story_id)
        await relationships.delete(relationship_id)


class ArcController(Controller):
    path = "/api/stories/{story_id:uuid}/arcs"
    tags = ["arcs"]
    dependencies = {"arcs": Provide(provide_arcs)}
    signature_namespace = {"AsyncSession": AsyncSession, "ArcService": ArcService}

    @get(summary="List arcs")
    async def list_arcs(self, arcs: ArcService, story_id: UUID) -> list[ArcOut]:
        records = await arcs.get_many(Arc.story_id == story_id)
        return [ArcOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create an arc")
    async def create_arc(self, arcs: ArcService, story_id: UUID, data: ArcCreate) -> ArcOut:
        record = await arcs.create(Arc(story_id=story_id, **data.model_dump()))
        return ArcOut.model_validate(record)

    @get("/{arc_id:uuid}", summary="Get an arc")
    async def get_arc(self, arcs: ArcService, story_id: UUID, arc_id: UUID) -> ArcOut:
        record = await fetch_or_404(arcs, "arc", id=arc_id, story_id=story_id)
        return ArcOut.model_validate(record)

    @patch("/{arc_id:uuid}", summary="Update an arc")
    async def update_arc(
        self, arcs: ArcService, story_id: UUID, arc_id: UUID, data: ArcUpdate
    ) -> ArcOut:
        record = await fetch_or_404(arcs, "arc", id=arc_id, story_id=story_id)
        record = await arcs.update(apply_patch(record, data))
        return ArcOut.model_validate(record)

    @delete("/{arc_id:uuid}", summary="Delete an arc")
    async def delete_arc(self, arcs: ArcService, story_id: UUID, arc_id: UUID) -> None:
        await fetch_or_404(arcs, "arc", id=arc_id, story_id=story_id)
        await arcs.delete(arc_id)


class ArcStageController(Controller):
    """Ordered stages of one arc -- what scenes will eventually point at."""

    path = "/api/arcs/{arc_id:uuid}/stages"
    tags = ["arcs"]
    dependencies = {"stages": Provide(provide_arc_stages)}
    signature_namespace = {"AsyncSession": AsyncSession, "ArcStageService": ArcStageService}

    @get(summary="List stages in order")
    async def list_stages(self, stages: ArcStageService, arc_id: UUID) -> list[ArcStageOut]:
        records = await stages.get_many(ArcStage.arc_id == arc_id, order_by=ArcStage.sort_key.asc())
        return [ArcStageOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Add a stage")
    async def create_stage(
        self, stages: ArcStageService, arc_id: UUID, data: ArcStageCreate
    ) -> ArcStageOut:
        record = await stages.create(ArcStage(arc_id=arc_id, **data.model_dump()))
        return ArcStageOut.model_validate(record)

    @patch("/{stage_id:uuid}", summary="Update a stage")
    async def update_stage(
        self, stages: ArcStageService, arc_id: UUID, stage_id: UUID, data: ArcStageUpdate
    ) -> ArcStageOut:
        record = await fetch_or_404(stages, "arc stage", id=stage_id, arc_id=arc_id)
        record = await stages.update(apply_patch(record, data))
        return ArcStageOut.model_validate(record)

    @delete("/{stage_id:uuid}", summary="Delete a stage")
    async def delete_stage(self, stages: ArcStageService, arc_id: UUID, stage_id: UUID) -> None:
        await fetch_or_404(stages, "arc stage", id=stage_id, arc_id=arc_id)
        await stages.delete(stage_id)
