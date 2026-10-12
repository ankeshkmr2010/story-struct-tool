"""Private product feedback, separate from comments on a manuscript."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from litestar import Controller, Request, get, post
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import ForeignKey, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.site.shoutouts import require_admin


class ProductFeedback(StoryToolBase):
    __tablename__ = "product_feedback"

    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    category: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)


class ProductFeedbackIn(BaseModel):
    category: Literal["bug", "suggestion", "other"] = "other"
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Write your feedback before sending it")
        return value


class ProductFeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: str
    message: str
    created_at: datetime


class ProductFeedbackController(Controller):
    path = "/api/product-feedback"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(summary="Send private feedback about StoryTool")
    async def submit(
        self, request: Request, db_session: AsyncSession, data: ProductFeedbackIn
    ) -> ProductFeedbackOut:
        row = ProductFeedback(
            user_id=request.scope["state"]["storytool_user_id"], **data.model_dump()
        )
        db_session.add(row)
        await db_session.flush()
        return ProductFeedbackOut.model_validate(row)


class AdminFeedbackController(Controller):
    path = "/api/admin/product-feedback"
    tags = ["site"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get(summary="Read the latest product feedback (site admin only)")
    async def list_feedback(
        self, request: Request, db_session: AsyncSession
    ) -> list[ProductFeedbackOut]:
        await require_admin(request, db_session)
        rows = await db_session.scalars(
            select(ProductFeedback)
            .order_by(ProductFeedback.created_at.desc(), ProductFeedback.id.desc())
            .limit(100)
        )
        return [ProductFeedbackOut.model_validate(row) for row in rows]
