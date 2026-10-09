"""Story HTTP routes.

Note what is *absent*: no structural validation refuses a write. A story may be created
with nothing but a title and sit incomplete forever. Completeness is reported, never
enforced -- DESIGN.md principle 1.
"""

from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.di import Provide
from litestar.exceptions import ClientException, NotFoundException
from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryCreate, StoryOut, StoryPurge, StoryUpdate
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
    async def list_stories(
        self,
        stories: StoryService,
        request: Request,
        trashed: bool = False,
    ) -> list[StoryOut]:
        user_id = request.scope["state"]["storytool_user_id"]
        records = await stories.get_many(
            Story.user_id == user_id,
            Story.deleted_at.is_not(None) if trashed else Story.deleted_at.is_(None),
        )
        return [StoryOut.model_validate(record) for record in records]

    @post(status_code=201, summary="Create a story")
    async def create_story(
        self,
        stories: StoryService,
        request: Request,
        data: StoryCreate,
        db_session: AsyncSession,
    ) -> StoryOut:
        user_id = request.scope["state"]["storytool_user_id"]
        record = await stories.create(Story(user_id=user_id, **data.model_dump()))
        from storytool.domain.versioning.service import checkpoint

        await checkpoint(db_session, record.id, user_id, "Story created", "initial")
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

    @delete("/{story_id:uuid}", summary="Move a story to Trash; preserve content and versions")
    async def delete_story(
        self,
        stories: StoryService,
        story_id: UUID,
        request: Request,
        db_session: AsyncSession,
    ) -> None:
        record = await stories.get_one_or_none(id=story_id)
        if record is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        if record.deleted_at is None:
            from storytool.domain.versioning.service import checkpoint

            await checkpoint(
                db_session,
                story_id,
                request.scope["state"]["storytool_user_id"],
                "Before moving to Trash",
                "recovery",
            )
            record.deleted_at = datetime.now(UTC)
            await stories.update(record)

    @post("/{story_id:uuid}/restore", summary="Restore a story from Trash")
    async def restore_story(self, stories: StoryService, story_id: UUID) -> StoryOut:
        record = await stories.get_one_or_none(id=story_id)
        if record is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        if record.deleted_at is not None:
            record.deleted_at = None
            record = await stories.update(record)
        return StoryOut.model_validate(record)

    @post(
        "/{story_id:uuid}/purge",
        status_code=204,
        summary="Permanently delete a trashed story and its linked database data",
    )
    async def purge_story(
        self,
        stories: StoryService,
        story_id: UUID,
        request: Request,
        db_session: AsyncSession,
        data: StoryPurge,
    ) -> None:
        record = await stories.get_one_or_none(id=story_id)
        if record is None:
            raise NotFoundException(detail="Story not found")
        if record.deleted_at is None:
            raise ClientException(
                status_code=409, detail="Move the story to Trash before permanently deleting it"
            )
        if record.title != data.expected_title:
            raise ClientException(
                status_code=409, detail="The story title changed; reopen the confirmation"
            )
        await db_session.execute(
            sql_delete(Story).where(
                Story.id == story_id,
                Story.user_id == request.scope["state"]["storytool_user_id"],
                Story.deleted_at.is_not(None),
            )
        )
