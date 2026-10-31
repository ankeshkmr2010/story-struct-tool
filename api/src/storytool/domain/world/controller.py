"""Locations, location usage, and the continuity report."""

from collections.abc import AsyncGenerator
from uuid import UUID

from litestar import Controller, delete, get, patch, post
from litestar.di import Provide
from litestar.exceptions import ClientException, NotFoundException
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.db.encryption import text_order
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.common import apply_patch, fetch_or_404
from storytool.domain.continuity import AnomalyKind, run_continuity
from storytool.domain.world.models import Location
from storytool.domain.world.schemas import (
    AnomalyOut,
    ContinuityOut,
    LocationCreate,
    LocationOut,
    LocationUpdate,
    LocationUsageOut,
)
from storytool.domain.world.services import LocationService
from storytool.domain.world.usage import location_usage


async def provide_locations(db_session: AsyncSession) -> AsyncGenerator[LocationService, None]:
    yield LocationService(session=db_session)


async def refuse_duplicate_name(
    locations: LocationService, story_id: UUID, name: str, keep: UUID | None = None
) -> None:
    existing = await locations.get_many(Location.story_id == story_id)
    if any(place.name == name and place.id != keep for place in existing):
        raise ClientException(
            status_code=409, detail=f'This story already has a location named "{name}".'
        )


class LocationController(Controller):
    """Reference data, outside the ladder -- locations never gate a level."""

    path = "/api/stories/{story_id:uuid}/locations"
    tags = ["locations"]
    dependencies = {"locations": Provide(provide_locations)}
    signature_namespace = {"AsyncSession": AsyncSession, "LocationService": LocationService}

    @get(summary="List locations")
    async def list_locations(self, locations: LocationService, story_id: UUID) -> list[LocationOut]:
        records = await locations.get_many(Location.story_id == story_id)
        records.sort(key=lambda r: text_order(r.name))
        return [LocationOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create a location")
    async def create_location(
        self, locations: LocationService, story_id: UUID, data: LocationCreate
    ) -> LocationOut:
        # Duplicate names break every continuity check that compares locations. Names are
        # encrypted at rest, so this is checked here rather than by a database constraint.
        await refuse_duplicate_name(locations, story_id, data.name)
        record = await locations.create(Location(story_id=story_id, **data.model_dump()))
        return LocationOut.model_validate(record)

    @get("/usage", summary="Where each location is used")
    async def get_usage(self, db_session: AsyncSession, story_id: UUID) -> list[LocationUsageOut]:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return location_usage(graph)

    @get("/{location_id:uuid}", summary="Get a location")
    async def get_location(
        self, locations: LocationService, story_id: UUID, location_id: UUID
    ) -> LocationOut:
        record = await fetch_or_404(locations, "location", id=location_id, story_id=story_id)
        return LocationOut.model_validate(record)

    @patch("/{location_id:uuid}", summary="Update a location")
    async def update_location(
        self,
        locations: LocationService,
        story_id: UUID,
        location_id: UUID,
        data: LocationUpdate,
    ) -> LocationOut:
        record = await fetch_or_404(locations, "location", id=location_id, story_id=story_id)
        if data.name is not None and data.name != record.name:
            await refuse_duplicate_name(locations, story_id, data.name, location_id)
        record = await locations.update(apply_patch(record, data))
        return LocationOut.model_validate(record)

    @delete("/{location_id:uuid}", summary="Delete a location")
    async def delete_location(
        self, locations: LocationService, story_id: UUID, location_id: UUID
    ) -> None:
        await fetch_or_404(locations, "location", id=location_id, story_id=story_id)
        await locations.delete(location_id)


class ContinuityController(Controller):
    path = "/api/stories/{story_id:uuid}"
    tags = ["continuity"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get(
        "/continuity",
        summary="Contradictions and possible anomalies",
        description=(
            "Contradictions are provable from the story graph and are stated as fact. "
            "Possible anomalies come from a model's reading, are confidence-gated, and are "
            "phrased as questions. Reports what it finds; never proposes the fix."
        ),
    )
    async def get_continuity(self, db_session: AsyncSession, story_id: UUID) -> ContinuityOut:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")

        anomalies = run_continuity(graph)
        return ContinuityOut(
            story_id=story_id,
            contradiction_count=sum(1 for a in anomalies if a.kind is AnomalyKind.CONTRADICTION),
            possible_count=sum(1 for a in anomalies if a.kind is AnomalyKind.POSSIBLE),
            anomalies=[
                AnomalyOut(
                    code=a.code,
                    kind=a.kind.value,
                    message=a.message,
                    scene_ids=list(a.scene_ids),
                    character_id=a.character_id,
                    location_id=a.location_id,
                    event_id=a.event_id,
                    confidence=a.confidence,
                )
                for a in anomalies
            ],
        )
