"""Private navigation state, outside manuscript versioning and delegated tools."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from litestar import Controller, Request, get, put
from litestar.exceptions import NotFoundException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey, UniqueConstraint, select
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.story.models import Story


class WorkspacePosition(StoryToolBase):
    __tablename__ = "workspace_position"
    __table_args__ = (UniqueConstraint("user_id", "story_id"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"))
    position: Mapped[dict] = mapped_column(JSONB)


class ReadingPlace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    anchor: str = Field(min_length=1, max_length=150)
    fragment: int = Field(default=0, ge=0, le=10000)
    within: float = Field(default=0, ge=0, le=1)


class WorkspacePlace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["write", "read", "design"] = "design"
    level: Literal[
        1, 2, 3, 4, 5, 6, 7, 8, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114
    ] = 1
    chapter_id: UUID | None = None
    scene_id: UUID | None = None
    write_chapter_id: UUID | Literal["unfiled"] | None = None
    write_scene_id: UUID | None = None
    write_within: float = Field(default=0, ge=0, le=1)
    scroll_fraction: float = Field(default=0, ge=0, le=1)
    reading: ReadingPlace | None = None


class LatestPlace(BaseModel):
    story_id: UUID
    title: str
    position: WorkspacePlace
    updated_at: datetime


@get("/api/workspace-position/latest")
async def latest_position(request: Request, db_session: AsyncSession) -> LatestPlace | None:
    """The author's most recently left story, for the library's resume prompt."""
    user_id = request.scope["state"]["storytool_user_id"]
    row = (
        await db_session.execute(
            select(
                WorkspacePosition.story_id,
                Story.title,
                WorkspacePosition.position,
                WorkspacePosition.updated_at,
            )
            .join(Story, Story.id == WorkspacePosition.story_id)
            .where(
                WorkspacePosition.user_id == user_id,
                Story.user_id == user_id,
                Story.deleted_at.is_(None),
            )
            .order_by(WorkspacePosition.updated_at.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    return LatestPlace(
        story_id=row.story_id,
        title=row.title,
        position=WorkspacePlace.model_validate(row.position),
        updated_at=row.updated_at,
    )


class WorkspaceController(Controller):
    path = "/api/workspace-position/{story_id:uuid}"

    async def owned(self, request: Request, db_session: AsyncSession, story_id: UUID) -> UUID:
        user_id = request.scope["state"]["storytool_user_id"]
        if not await db_session.scalar(
            select(Story.id).where(
                Story.id == story_id, Story.user_id == user_id, Story.deleted_at.is_(None)
            )
        ):
            raise NotFoundException(detail="Story not found")
        return user_id

    @get()
    async def get_position(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> WorkspacePlace | None:
        user_id = await self.owned(request, db_session, story_id)
        position = await db_session.scalar(
            select(WorkspacePosition.position).where(
                WorkspacePosition.user_id == user_id, WorkspacePosition.story_id == story_id
            )
        )
        return WorkspacePlace.model_validate(position) if position else None

    @put(status_code=200)
    async def save_position(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: WorkspacePlace
    ) -> WorkspacePlace:
        user_id = await self.owned(request, db_session, story_id)
        position = data.model_dump(mode="json")
        statement = (
            insert(WorkspacePosition)
            .values(user_id=user_id, story_id=story_id, position=position)
            .on_conflict_do_update(
                index_elements=[WorkspacePosition.user_id, WorkspacePosition.story_id],
                set_={"position": position, "updated_at": datetime.now(UTC)},
            )
        )
        await db_session.execute(statement)
        await db_session.commit()
        return data
