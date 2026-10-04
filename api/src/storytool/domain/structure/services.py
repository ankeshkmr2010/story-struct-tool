"""Repositories and services for Levels 2, 4, 5, 6."""

from advanced_alchemy.repository import SQLAlchemyAsyncRepository
from advanced_alchemy.service import SQLAlchemyAsyncRepositoryService

from storytool.domain.structure.models import Act, Beat, Event, Thread


class EventRepository(SQLAlchemyAsyncRepository[Event]):
    model_type = Event


class EventService(SQLAlchemyAsyncRepositoryService[Event, EventRepository]):
    repository_type = EventRepository


class ActRepository(SQLAlchemyAsyncRepository[Act]):
    model_type = Act


class ActService(SQLAlchemyAsyncRepositoryService[Act, ActRepository]):
    repository_type = ActRepository


class BeatRepository(SQLAlchemyAsyncRepository[Beat]):
    model_type = Beat


class BeatService(SQLAlchemyAsyncRepositoryService[Beat, BeatRepository]):
    repository_type = BeatRepository


class ThreadRepository(SQLAlchemyAsyncRepository[Thread]):
    model_type = Thread


class ThreadService(SQLAlchemyAsyncRepositoryService[Thread, ThreadRepository]):
    repository_type = ThreadRepository
