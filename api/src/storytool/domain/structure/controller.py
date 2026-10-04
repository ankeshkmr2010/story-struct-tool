"""CRUD for Levels 2, 4, 5, 6.

All routes nest under a story, and every lookup filters on `story_id` as well as the
entity id -- so addressing another story's row through your own story's path is a 404,
not a leak.

As throughout: creation never fails for structural reasons. A beat with no act, an act
with no turning points, a thread with no owner are all legal, merely incomplete.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

from litestar import Controller, delete, get, patch, post
from litestar.di import Provide
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.common import apply_patch, fetch_or_404
from storytool.domain.structure.models import Act, Beat, Event, Thread
from storytool.domain.structure.schemas import (
    ActCreate,
    ActOut,
    ActUpdate,
    BeatCreate,
    BeatOut,
    BeatUpdate,
    EventCreate,
    EventOut,
    EventUpdate,
    ThreadCreate,
    ThreadOut,
    ThreadUpdate,
)
from storytool.domain.structure.services import (
    ActService,
    BeatService,
    EventService,
    ThreadService,
)


async def provide_events(db_session: AsyncSession) -> AsyncGenerator[EventService, None]:
    yield EventService(session=db_session)


async def provide_acts(db_session: AsyncSession) -> AsyncGenerator[ActService, None]:
    yield ActService(session=db_session)


async def provide_beats(db_session: AsyncSession) -> AsyncGenerator[BeatService, None]:
    yield BeatService(session=db_session)


async def provide_threads(db_session: AsyncSession) -> AsyncGenerator[ThreadService, None]:
    yield ThreadService(session=db_session)


class EventController(Controller):
    """Level 2 -- the arc skeleton is Events with `is_turning_point` set."""

    path = "/api/stories/{story_id:uuid}/events"
    tags = ["events"]
    dependencies = {"events": Provide(provide_events)}
    signature_namespace = {"AsyncSession": AsyncSession, "EventService": EventService}

    @get(summary="List events in story-world order")
    async def list_events(self, events: EventService, story_id: UUID) -> list[EventOut]:
        records = await events.get_many(
            Event.story_id == story_id, order_by=Event.sort_ordinal.asc()
        )
        return [EventOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create an event")
    async def create_event(
        self, events: EventService, story_id: UUID, data: EventCreate
    ) -> EventOut:
        record = await events.create(Event(story_id=story_id, **data.model_dump()))
        return EventOut.model_validate(record)

    @get("/{event_id:uuid}", summary="Get an event")
    async def get_event(self, events: EventService, story_id: UUID, event_id: UUID) -> EventOut:
        record = await fetch_or_404(events, "event", id=event_id, story_id=story_id)
        return EventOut.model_validate(record)

    @patch("/{event_id:uuid}", summary="Update an event")
    async def update_event(
        self, events: EventService, story_id: UUID, event_id: UUID, data: EventUpdate
    ) -> EventOut:
        record = await fetch_or_404(events, "event", id=event_id, story_id=story_id)
        record = await events.update(apply_patch(record, data))
        return EventOut.model_validate(record)

    @delete("/{event_id:uuid}", summary="Delete an event")
    async def delete_event(self, events: EventService, story_id: UUID, event_id: UUID) -> None:
        await fetch_or_404(events, "event", id=event_id, story_id=story_id)
        await events.delete(event_id)


class ActController(Controller):
    """Level 4."""

    path = "/api/stories/{story_id:uuid}/acts"
    tags = ["acts"]
    dependencies = {"acts": Provide(provide_acts)}
    signature_namespace = {"AsyncSession": AsyncSession, "ActService": ActService}

    @get(summary="List acts in order")
    async def list_acts(self, acts: ActService, story_id: UUID) -> list[ActOut]:
        records = await acts.get_many(Act.story_id == story_id, order_by=Act.sort_key.asc())
        return [ActOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create an act")
    async def create_act(self, acts: ActService, story_id: UUID, data: ActCreate) -> ActOut:
        record = await acts.create(Act(story_id=story_id, **data.model_dump()))
        return ActOut.model_validate(record)

    @get("/{act_id:uuid}", summary="Get an act")
    async def get_act(self, acts: ActService, story_id: UUID, act_id: UUID) -> ActOut:
        record = await fetch_or_404(acts, "act", id=act_id, story_id=story_id)
        return ActOut.model_validate(record)

    @patch("/{act_id:uuid}", summary="Update an act")
    async def update_act(
        self, acts: ActService, story_id: UUID, act_id: UUID, data: ActUpdate
    ) -> ActOut:
        record = await fetch_or_404(acts, "act", id=act_id, story_id=story_id)
        record = await acts.update(apply_patch(record, data))
        return ActOut.model_validate(record)

    @delete("/{act_id:uuid}", summary="Delete an act")
    async def delete_act(self, acts: ActService, story_id: UUID, act_id: UUID) -> None:
        await fetch_or_404(acts, "act", id=act_id, story_id=story_id)
        await acts.delete(act_id)


class BeatController(Controller):
    """Level 5."""

    path = "/api/stories/{story_id:uuid}/beats"
    tags = ["beats"]
    dependencies = {"beats": Provide(provide_beats)}
    signature_namespace = {"AsyncSession": AsyncSession, "BeatService": BeatService}

    @get(summary="List beats in order")
    async def list_beats(self, beats: BeatService, story_id: UUID) -> list[BeatOut]:
        records = await beats.get_many(Beat.story_id == story_id, order_by=Beat.sort_key.asc())
        return [BeatOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create a beat")
    async def create_beat(self, beats: BeatService, story_id: UUID, data: BeatCreate) -> BeatOut:
        record = await beats.create(Beat(story_id=story_id, **data.model_dump()))
        return BeatOut.model_validate(record)

    @get("/{beat_id:uuid}", summary="Get a beat")
    async def get_beat(self, beats: BeatService, story_id: UUID, beat_id: UUID) -> BeatOut:
        record = await fetch_or_404(beats, "beat", id=beat_id, story_id=story_id)
        return BeatOut.model_validate(record)

    @patch("/{beat_id:uuid}", summary="Update a beat")
    async def update_beat(
        self, beats: BeatService, story_id: UUID, beat_id: UUID, data: BeatUpdate
    ) -> BeatOut:
        record = await fetch_or_404(beats, "beat", id=beat_id, story_id=story_id)
        record = await beats.update(apply_patch(record, data))
        return BeatOut.model_validate(record)

    @delete("/{beat_id:uuid}", summary="Delete a beat")
    async def delete_beat(self, beats: BeatService, story_id: UUID, beat_id: UUID) -> None:
        await fetch_or_404(beats, "beat", id=beat_id, story_id=story_id)
        await beats.delete(beat_id)


class ThreadController(Controller):
    """Level 6."""

    path = "/api/stories/{story_id:uuid}/threads"
    tags = ["threads"]
    dependencies = {"threads": Provide(provide_threads)}
    signature_namespace = {"AsyncSession": AsyncSession, "ThreadService": ThreadService}

    @get(summary="List threads in order")
    async def list_threads(self, threads: ThreadService, story_id: UUID) -> list[ThreadOut]:
        records = await threads.get_many(
            Thread.story_id == story_id, order_by=Thread.sort_key.asc()
        )
        return [ThreadOut.model_validate(r) for r in records]

    @post(status_code=201, summary="Create a thread")
    async def create_thread(
        self, threads: ThreadService, story_id: UUID, data: ThreadCreate
    ) -> ThreadOut:
        record = await threads.create(Thread(story_id=story_id, **data.model_dump()))
        return ThreadOut.model_validate(record)

    @get("/{thread_id:uuid}", summary="Get a thread")
    async def get_thread(
        self, threads: ThreadService, story_id: UUID, thread_id: UUID
    ) -> ThreadOut:
        record = await fetch_or_404(threads, "thread", id=thread_id, story_id=story_id)
        return ThreadOut.model_validate(record)

    @patch("/{thread_id:uuid}", summary="Update a thread")
    async def update_thread(
        self, threads: ThreadService, story_id: UUID, thread_id: UUID, data: ThreadUpdate
    ) -> ThreadOut:
        record = await fetch_or_404(threads, "thread", id=thread_id, story_id=story_id)
        record = await threads.update(apply_patch(record, data))
        return ThreadOut.model_validate(record)

    @delete("/{thread_id:uuid}", summary="Delete a thread")
    async def delete_thread(self, threads: ThreadService, story_id: UUID, thread_id: UUID) -> None:
        await fetch_or_404(threads, "thread", id=thread_id, story_id=story_id)
        await threads.delete(thread_id)
