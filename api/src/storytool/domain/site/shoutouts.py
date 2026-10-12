"""The /thanks page: public read, edits only by the accounts in STORYTOOL_ADMIN_EMAILS.

Reads sit on a public path (`/api/shoutouts`). Edits live under `/api/admin/`, which the
access middleware only lets through with a browser session -- agent tokens are confined to
story paths -- and each handler then checks the signed-in email against the setting.
"""

from uuid import UUID

from litestar import Controller, Request, delete, get, patch, post
from litestar.exceptions import NotFoundException, PermissionDeniedException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Float, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.config import get_settings
from storytool.db.base import StoryToolBase
from storytool.domain.auth.models import User

SORT_STEP = 100.0


class Shoutout(StoryToolBase):
    __tablename__ = "shoutout"

    name: Mapped[str] = mapped_column(String(120))
    thanks: Mapped[str] = mapped_column(Text)
    colour: Mapped[str] = mapped_column(String(20), default="rose")
    """A palette key the page maps to a gradient, not a CSS value."""
    mark: Mapped[str] = mapped_column(String(16), default="")
    sort_key: Mapped[float] = mapped_column(Float, default=0.0)


class ShoutoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    thanks: str
    colour: str
    mark: str
    sort_key: float


class ShoutoutCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    thanks: str = Field(min_length=1, max_length=2000)
    colour: str = Field(default="rose", max_length=20)
    mark: str = Field(default="", max_length=16)


class ShoutoutUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    thanks: str | None = Field(default=None, min_length=1, max_length=2000)
    colour: str | None = Field(default=None, max_length=20)
    mark: str | None = Field(default=None, max_length=16)
    sort_key: float | None = None


class AdminStatusOut(BaseModel):
    is_admin: bool


def admin_emails() -> set[str]:
    return {e.strip().lower() for e in get_settings().admin_emails.split(",") if e.strip()}


async def is_admin(request: Request, db_session: AsyncSession) -> bool:
    user = await db_session.get(User, request.scope["state"]["storytool_user_id"])
    return user is not None and user.email.lower() in admin_emails()


async def require_admin(request: Request, db_session: AsyncSession) -> None:
    if not await is_admin(request, db_session):
        raise PermissionDeniedException(detail="Only the site owner can edit this")


class PublicShoutoutController(Controller):
    path = "/api/shoutouts"
    tags = ["site"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get(summary="The thank-you list, in order")
    async def list_shoutouts(self, db_session: AsyncSession) -> list[ShoutoutOut]:
        rows = await db_session.scalars(select(Shoutout).order_by(Shoutout.sort_key, Shoutout.id))
        return [ShoutoutOut.model_validate(row) for row in rows]


class AdminShoutoutController(Controller):
    path = "/api/admin"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession, "Request": Request}  # noqa: RUF012

    @get("/status", summary="Whether the signed-in account may edit site content")
    async def status(self, request: Request, db_session: AsyncSession) -> AdminStatusOut:
        return AdminStatusOut(is_admin=await is_admin(request, db_session))

    @post("/shoutouts", summary="Add a shoutout at the end of the list")
    async def create_shoutout(
        self, request: Request, db_session: AsyncSession, data: ShoutoutCreate
    ) -> ShoutoutOut:
        await require_admin(request, db_session)
        last = await db_session.scalar(select(func.max(Shoutout.sort_key)))
        row = Shoutout(**data.model_dump(), sort_key=(last or 0.0) + SORT_STEP)
        db_session.add(row)
        await db_session.flush()
        return ShoutoutOut.model_validate(row)

    @patch("/shoutouts/{shoutout_id:uuid}", summary="Edit or move a shoutout")
    async def update_shoutout(
        self, request: Request, db_session: AsyncSession, shoutout_id: UUID, data: ShoutoutUpdate
    ) -> ShoutoutOut:
        await require_admin(request, db_session)
        row = await db_session.get(Shoutout, shoutout_id)
        if row is None:
            raise NotFoundException(detail="No such shoutout")
        for field, value in data.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(row, field, value)
        await db_session.flush()
        return ShoutoutOut.model_validate(row)

    @delete("/shoutouts/{shoutout_id:uuid}", summary="Remove a shoutout")
    async def delete_shoutout(
        self, request: Request, db_session: AsyncSession, shoutout_id: UUID
    ) -> None:
        await require_admin(request, db_session)
        row = await db_session.get(Shoutout, shoutout_id)
        if row is None:
            raise NotFoundException(detail="No such shoutout")
        await db_session.delete(row)
