"""Repository + service for Story, via advanced-alchemy."""

from advanced_alchemy.repository import SQLAlchemyAsyncRepository
from advanced_alchemy.service import SQLAlchemyAsyncRepositoryService

from storytool.domain.story.models import Story


class StoryRepository(SQLAlchemyAsyncRepository[Story]):
    model_type = Story


class StoryService(SQLAlchemyAsyncRepositoryService[Story, StoryRepository]):
    repository_type = StoryRepository
