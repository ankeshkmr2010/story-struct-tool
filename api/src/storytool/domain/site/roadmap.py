"""Public roadmap with admin-only editing."""

from datetime import UTC, date, datetime
from uuid import UUID

from litestar import Controller, Request, get, patch, post
from litestar.exceptions import NotFoundException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, CheckConstraint, Date, Float, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.enums import RoadmapStatus
from storytool.domain.site.shoutouts import require_admin


class RoadmapItem(StoryToolBase):
    __tablename__ = "roadmap_item"
    __table_args__ = (
        CheckConstraint(
            "status IN ('exploring', 'planned', 'in_progress', 'delivered')", name="roadmap_status"
        ),
    )

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default=RoadmapStatus.PLANNED)
    hero: Mapped[bool] = mapped_column(Boolean, default=False)
    delivered_on: Mapped[date | None] = mapped_column(Date, default=None)
    sort_key: Mapped[float] = mapped_column(Float, default=0)


class RoadmapInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=3000)
    status: RoadmapStatus = RoadmapStatus.PLANNED
    hero: bool = False
    delivered_on: date | None = None


class RoadmapOut(RoadmapInput):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    sort_key: float


def values(data: RoadmapInput) -> dict:
    result = data.model_dump()
    result["delivered_on"] = (
        (data.delivered_on or datetime.now(UTC).date())
        if data.status == RoadmapStatus.DELIVERED
        else None
    )
    return result


class PublicRoadmapController(Controller):
    path = "/api/roadmap"

    @get()
    async def list_roadmap(self, db_session: AsyncSession) -> list[RoadmapOut]:
        rows = await db_session.scalars(
            select(RoadmapItem).order_by(RoadmapItem.sort_key, RoadmapItem.id)
        )
        return [RoadmapOut.model_validate(row) for row in rows]


class AdminRoadmapController(Controller):
    path = "/api/admin/roadmap"

    @post()
    async def create_item(
        self, request: Request, db_session: AsyncSession, data: RoadmapInput
    ) -> RoadmapOut:
        await require_admin(request, db_session)
        last = await db_session.scalar(select(func.max(RoadmapItem.sort_key)))
        row = RoadmapItem(**values(data), sort_key=(last or 0) + 100)
        db_session.add(row)
        await db_session.flush()
        return RoadmapOut.model_validate(row)

    @patch("/{item_id:uuid}")
    async def update_item(
        self, request: Request, db_session: AsyncSession, item_id: UUID, data: RoadmapInput
    ) -> RoadmapOut:
        await require_admin(request, db_session)
        row = await db_session.get(RoadmapItem, item_id)
        if row is None:
            raise NotFoundException(detail="Roadmap item not found")
        for field, value in values(data).items():
            setattr(row, field, value)
        await db_session.flush()
        return RoadmapOut.model_validate(row)
