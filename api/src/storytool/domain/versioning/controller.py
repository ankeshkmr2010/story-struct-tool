from uuid import UUID

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException, NotFoundException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from storytool.domain.ai.commands import owned_story
from storytool.domain.versioning import service
from storytool.domain.versioning.models import StoryVersion
from storytool.domain.versioning.schemas import (
    VersionCreate,
    VersionOut,
    VersionPreview,
    VersionRestore,
    VersionRestoreOut,
)


class VersionConflict(ClientException):
    status_code = 409


async def owned_version(
    db: AsyncSession, story_id: UUID, user_id: UUID, version_id: UUID
) -> StoryVersion:
    await owned_story(db, story_id, user_id)
    record = await db.scalar(
        select(StoryVersion).where(
            StoryVersion.id == version_id,
            StoryVersion.story_id == story_id,
            StoryVersion.user_id == user_id,
        )
    )
    if record is None:
        raise NotFoundException(detail="Story version not found")
    return record


class StoryVersionController(Controller):
    path = "/api/stories/{story_id:uuid}/versions"
    tags = ["story-versions"]
    signature_namespace = {"AsyncSession": AsyncSession}

    @get()
    async def list_versions(
        self, request: Request, db_session: AsyncSession, story_id: UUID
    ) -> list[VersionOut]:
        await owned_story(db_session, story_id, request.scope["state"]["storytool_user_id"])
        rows = (
            await db_session.execute(
                select(StoryVersion)
                .options(
                    load_only(
                        StoryVersion.id,
                        StoryVersion.number,
                        StoryVersion.label,
                        StoryVersion.source,
                        StoryVersion.created_at,
                        StoryVersion.statistics,
                    )
                )
                .where(StoryVersion.story_id == story_id)
                .order_by(StoryVersion.number.desc())
            )
        ).scalars()
        return [VersionOut.model_validate(row) for row in rows]

    @post()
    async def save_version(
        self, request: Request, db_session: AsyncSession, story_id: UUID, data: VersionCreate
    ) -> VersionOut:
        user_id = request.scope["state"]["storytool_user_id"]
        await owned_story(db_session, story_id, user_id)
        record = await service.checkpoint(
            db_session, story_id, user_id, data.label.strip() or "Named version", "manual"
        )
        return VersionOut.model_validate(record)

    @get("/{version_id:uuid}/preview")
    async def preview(
        self, request: Request, db_session: AsyncSession, story_id: UUID, version_id: UUID
    ) -> VersionPreview:
        # GET previews also need a consistent graph while other tabs are editing it.
        await db_session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": int.from_bytes(story_id.bytes[:8], "big", signed=True)},
        )
        record = await owned_version(
            db_session, story_id, request.scope["state"]["storytool_user_id"], version_id
        )
        current = await service.full_state(db_session, story_id)
        changes, count = service.changes(current, record.state)
        return VersionPreview(
            version=VersionOut.model_validate(record),
            current_fingerprint=service.fingerprint(current),
            current_statistics=service.statistics(current),
            changes=changes,
            change_count=count,
        )

    @post("/{version_id:uuid}/restore")
    async def restore(
        self,
        request: Request,
        db_session: AsyncSession,
        story_id: UUID,
        version_id: UUID,
        data: VersionRestore,
    ) -> VersionRestoreOut:
        user_id = request.scope["state"]["storytool_user_id"]
        record = await owned_version(db_session, story_id, user_id, version_id)
        current = await service.full_state(db_session, story_id)
        if service.fingerprint(current) != data.expected_fingerprint:
            raise VersionConflict(
                detail="The story changed after this preview. Refresh the preview before restoring."
            )
        recovery = await service.checkpoint(
            db_session, story_id, user_id, f"Before restoring v{record.number}", "recovery", current
        )
        await service.restore_state(db_session, story_id, record.state)
        restored = await service.checkpoint(
            db_session,
            story_id,
            user_id,
            f"Restored from v{record.number}: {record.label}"[:200],
            "restore",
        )
        return VersionRestoreOut(
            restored_number=record.number,
            recovery_version=VersionOut.model_validate(recovery),
            restored_version=VersionOut.model_validate(restored),
        )
