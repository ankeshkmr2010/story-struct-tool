"""Repositories and services for Levels 7 and 8."""

from advanced_alchemy.repository import SQLAlchemyAsyncRepository
from advanced_alchemy.service import SQLAlchemyAsyncRepositoryService

from storytool.domain.narrative.models import Chapter, Scene


class ChapterRepository(SQLAlchemyAsyncRepository[Chapter]):
    model_type = Chapter


class ChapterService(SQLAlchemyAsyncRepositoryService[Chapter, ChapterRepository]):
    repository_type = ChapterRepository


class SceneRepository(SQLAlchemyAsyncRepository[Scene]):
    model_type = Scene


class SceneService(SQLAlchemyAsyncRepositoryService[Scene, SceneRepository]):
    repository_type = SceneRepository
