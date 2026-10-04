"""Repositories and services for Level 3."""

from advanced_alchemy.repository import SQLAlchemyAsyncRepository
from advanced_alchemy.service import SQLAlchemyAsyncRepositoryService

from storytool.domain.cast.models import Arc, ArcStage, Character, Relationship


class CharacterRepository(SQLAlchemyAsyncRepository[Character]):
    model_type = Character


class CharacterService(SQLAlchemyAsyncRepositoryService[Character, CharacterRepository]):
    repository_type = CharacterRepository


class RelationshipRepository(SQLAlchemyAsyncRepository[Relationship]):
    model_type = Relationship


class RelationshipService(SQLAlchemyAsyncRepositoryService[Relationship, RelationshipRepository]):
    repository_type = RelationshipRepository


class ArcRepository(SQLAlchemyAsyncRepository[Arc]):
    model_type = Arc


class ArcService(SQLAlchemyAsyncRepositoryService[Arc, ArcRepository]):
    repository_type = ArcRepository


class ArcStageRepository(SQLAlchemyAsyncRepository[ArcStage]):
    model_type = ArcStage


class ArcStageService(SQLAlchemyAsyncRepositoryService[ArcStage, ArcStageRepository]):
    repository_type = ArcStageRepository
