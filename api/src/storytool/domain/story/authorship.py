"""Field authorship records contain attribution, never duplicated prose or provider keys."""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from litestar import Controller, get
from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey, String, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from storytool.db.base import StoryToolBase
from storytool.domain.ai.commands import ENTITIES, LINKS


class FieldAuthorship(StoryToolBase):
    __tablename__ = "field_authorship"
    story_id: Mapped[UUID] = mapped_column(ForeignKey("story.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[UUID] = mapped_column(index=True)
    field: Mapped[str] = mapped_column(String(100))
    origin: Mapped[str] = mapped_column(String(30))
    actor_label: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(20))
    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), default=None
    )


class AuthorshipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    entity_type: str
    entity_id: UUID
    field: str
    origin: str
    actor_label: str
    action: str
    created_at: datetime


async def record_changes(
    db: AsyncSession,
    story_id: UUID,
    user_id: UUID,
    before: dict[str, Any],
    after: dict[str, Any],
    origin: str,
    actor_label: str,
) -> None:
    audit = {
        "id",
        "created_at",
        "updated_at",
        "sa_orm_sentinel",
        "word_count",
        "user_id",
        "deleted_at",
        "parent_story_id",
    }
    for kind in ENTITIES:
        old = {row["id"]: row for row in before.get(kind, [])}
        new = {row["id"]: row for row in after.get(kind, [])}
        for identifier in old.keys() | new.keys():
            action = (
                "create"
                if identifier not in old
                else "delete"
                if identifier not in new
                else "update"
            )
            fields = (
                ["*"]
                if action == "delete"
                else [
                    field
                    for field in new[identifier]
                    if field not in audit
                    and new[identifier].get(field) != old.get(identifier, {}).get(field)
                ]
            )
            for field in fields:
                db.add(
                    FieldAuthorship(
                        story_id=story_id,
                        user_id=user_id,
                        entity_type=kind,
                        entity_id=UUID(identifier),
                        field=field,
                        origin=origin,
                        actor_label=actor_label[:200],
                        action=action,
                    )
                )
    for kind, (_table, left_kind, _right, left_column, _right_column) in LINKS.items():
        old = before.get(kind, [])
        new = after.get(kind, [])
        if old != new:
            ids = {row[left_column] for row in old + new}
            for identifier in ids:
                if [r for r in old if r[left_column] == identifier] != [
                    r for r in new if r[left_column] == identifier
                ]:
                    db.add(
                        FieldAuthorship(
                            story_id=story_id,
                            user_id=user_id,
                            entity_type=left_kind,
                            entity_id=UUID(identifier),
                            field=kind,
                            origin=origin,
                            actor_label=actor_label[:200],
                            action="link",
                        )
                    )
    await db.flush()


TECHNICAL_FIELD = re.compile(r"(^id$|_id$|sort_key)")


class OriginCounts(BaseModel):
    author: int = 0
    assistant: int = 0
    mcp: int = 0
    other: int = 0


class DisclosureOut(BaseModel):
    story_title: str
    author_name: str | None
    tracking_since: datetime | None
    prose: OriginCounts
    planning: OriginCounts
    ai_tools: list[str]
    last_ai_edit: datetime | None


class AuthorshipController(Controller):
    path = "/api/stories/{story_id:uuid}/authorship"
    tags = ["authorship"]  # noqa: RUF012
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get()
    async def history(self, db_session: AsyncSession, story_id: UUID) -> list[AuthorshipOut]:
        rows = await db_session.scalars(
            select(FieldAuthorship)
            .where(FieldAuthorship.story_id == story_id)
            .order_by(FieldAuthorship.created_at.desc(), FieldAuthorship.id.desc())
            .limit(500)
        )
        return [AuthorshipOut.model_validate(row) for row in rows]

    @get("/summary")
    async def summary(self, db_session: AsyncSession, story_id: UUID) -> DisclosureOut:
        """Counts of tracked saved edits by origin, for an AI-use disclosure. Not word shares."""
        from storytool.domain.auth.models import User
        from storytool.domain.story.models import Story

        story = await db_session.get(Story, story_id)
        owner = await db_session.get(User, story.user_id) if story else None
        rows = await db_session.execute(
            select(
                FieldAuthorship.entity_type,
                FieldAuthorship.field,
                FieldAuthorship.origin,
                func.count(),
                func.min(FieldAuthorship.created_at),
                func.max(FieldAuthorship.created_at),
            )
            .where(FieldAuthorship.story_id == story_id)
            .group_by(FieldAuthorship.entity_type, FieldAuthorship.field, FieldAuthorship.origin)
        )
        prose, planning = OriginCounts(), OriginCounts()
        since: datetime | None = None
        last_ai: datetime | None = None
        for entity_type, field, origin, count, first, last in rows:
            since = first if since is None or first < since else since
            if origin in {"mcp", "assistant"}:
                last_ai = last if last_ai is None or last > last_ai else last_ai
            if TECHNICAL_FIELD.search(field):
                continue
            bucket = prose if (entity_type, field) == ("scene", "content") else planning
            key = origin if origin in {"author", "assistant", "mcp"} else "other"
            setattr(bucket, key, getattr(bucket, key) + count)
        clients = await db_session.scalars(
            select(FieldAuthorship.actor_label)
            .where(
                FieldAuthorship.story_id == story_id,
                FieldAuthorship.origin.in_(["mcp", "assistant"]),
            )
            .distinct()
        )
        return DisclosureOut(
            story_title=story.title if story else "",
            author_name=(owner.author_name or owner.name) if owner else None,
            tracking_since=since,
            prose=prose,
            planning=planning,
            ai_tools=sorted(clients),
            last_ai_edit=last_ai,
        )
