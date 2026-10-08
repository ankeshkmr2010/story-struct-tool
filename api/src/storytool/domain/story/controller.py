"""Story HTTP routes.

Note what is *absent*: no structural validation refuses a write. A story may be created
with nothing but a title and sit incomplete forever. Completeness is reported, never
enforced -- DESIGN.md principle 1.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.di import Provide
from litestar.exceptions import NotFoundException
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryCreate, StoryOut, StoryUpdate
from storytool.domain.story.services import StoryService


async def provide_stories(db_session: AsyncSession) -> AsyncGenerator[StoryService, None]:
    yield StoryService(session=db_session)


class StoryController(Controller):
    path = "/api/stories"
    tags = ["stories"]
    dependencies = {"stories": Provide(provide_stories)}
    signature_namespace = {
        "AsyncSession": AsyncSession,
        "StoryService": StoryService,
    }

    @get(summary="List stories")
    async def list_stories(self, stories: StoryService, request: Request) -> list[StoryOut]:
        user_id = request.scope["state"]["storytool_user_id"]
        records = await stories.get_many(Story.user_id == user_id)
        return [StoryOut.model_validate(record) for record in records]

    @post(status_code=201, summary="Create a story")
    async def create_story(
        self, stories: StoryService, request: Request, data: StoryCreate
    ) -> StoryOut:
        user_id = request.scope["state"]["storytool_user_id"]
        record = await stories.create(Story(user_id=user_id, **data.model_dump()))
        return StoryOut.model_validate(record)

    @get("/{story_id:uuid}", summary="Get one story")
    async def get_story(self, stories: StoryService, story_id: UUID) -> StoryOut:
        record = await stories.get_one_or_none(id=story_id)
        if record is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return StoryOut.model_validate(record)

    @patch("/{story_id:uuid}", summary="Update a story")
    async def update_story(
        self, stories: StoryService, story_id: UUID, data: StoryUpdate
    ) -> StoryOut:
        record = await stories.get_one_or_none(id=story_id)
        if record is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        # exclude_unset so an absent field means "leave alone", not "set to null".
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(record, field, value)
        record = await stories.update(record)
        return StoryOut.model_validate(record)

    @delete("/{story_id:uuid}", summary="Delete a story")
    async def delete_story(self, stories: StoryService, story_id: UUID) -> None:
        record = await stories.get_one_or_none(id=story_id)
        if record is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        await stories.delete(story_id)
