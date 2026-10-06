"""Repository and service for locations."""

from advanced_alchemy.repository import SQLAlchemyAsyncRepository
from advanced_alchemy.service import SQLAlchemyAsyncRepositoryService

from storytool.domain.world.models import Location


class LocationRepository(SQLAlchemyAsyncRepository[Location]):
    model_type = Location


class LocationService(SQLAlchemyAsyncRepositoryService[Location, LocationRepository]):
    repository_type = LocationRepository
