"""Story-owned images, quotas, versioned descriptions and portable asset copies."""

import base64
import binascii
import io
import re
from collections import Counter
from typing import Any, Literal
from uuid import UUID

from litestar import Controller, Request, Response, delete, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils import uuid7

from storytool.domain.cast.models import Character
from storytool.domain.glossary import GlossaryEntry
from storytool.domain.narrative.models import Scene
from storytool.domain.narrative.prose import save_scene_content
from storytool.domain.story.image_models import ImageBlob, StoryImage
from storytool.domain.story.image_storage import get_image, inspect_image, put_image
from storytool.domain.world.models import Location

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_STORY_BYTES = 100 * 1024 * 1024
MAX_STORY_IMAGES = 50
IMAGE_REF = re.compile(r"!\[([^\]\n]*)\]\(storytool-image:([0-9a-fA-F-]{36})\)")
TARGETS = {"character": Character, "location": Location, "glossary": GlossaryEntry, "scene": Scene}
TARGET_STATE = {
    "character": "character",
    "location": "location",
    "glossary": "glossary_entry",
    "scene": "scene",
}


class ImageAttachment(BaseModel):
    entity: Literal["character", "location", "glossary", "scene"]
    id: UUID


class ImageDescription(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    alt: str = Field(default="", max_length=500)
    caption: str = Field(default="", max_length=1000)
    attachments: list[ImageAttachment] = Field(default_factory=list, max_length=100)


class ImageUpload(ImageDescription):
    upload_id: UUID
    data: str = Field(max_length=4 * ((MAX_IMAGE_BYTES + 2) // 3))


class ImageOut(ImageDescription):
    archived: bool
    manuscript_uses: int = 0
    id: UUID
    size: int
    width: int
    height: int
    url: str


class ImageLibrary(BaseModel):
    images: list[ImageOut]
    retained_count: int
    retained_bytes: int
    max_image_bytes: int = MAX_IMAGE_BYTES
    max_story_bytes: int = MAX_STORY_BYTES
    max_images: int = MAX_STORY_IMAGES


def decode_image(encoded: str) -> bytes:
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ClientException(detail="The image upload is unreadable") from None
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ClientException(detail="Each image must be 5 MB or smaller")
    return data


async def image_usage(db: AsyncSession, story_id: UUID) -> tuple[int, int]:
    row = (
        await db.execute(
            select(func.count(ImageBlob.id), func.coalesce(func.sum(ImageBlob.size), 0)).where(
                ImageBlob.story_id == story_id
            )
        )
    ).one()
    return int(row[0]), int(row[1])


async def check_capacity(db: AsyncSession, story_id: UUID, sizes: list[int]) -> None:
    count, total = await image_usage(db, story_id)
    if count + len(sizes) > MAX_STORY_IMAGES or total + sum(sizes) > MAX_STORY_BYTES:
        raise ClientException(
            detail="This story has reached its image limit: 50 images or 100 MB, "
            "including images retained for history"
        )


async def validate_attachments(
    db: AsyncSession, story_id: UUID, attachments: list[ImageAttachment]
) -> None:
    for item in attachments:
        model = TARGETS[item.entity]
        if (
            await db.scalar(select(model.id).where(model.id == item.id, model.story_id == story_id))
            is None
        ):
            raise NotFoundException(detail="Image attachment target not found in this story")


async def save_blob(
    db: AsyncSession, story_id: UUID, data: bytes, identifier: UUID | None = None
) -> ImageBlob:
    mime, width, height = inspect_image(data)
    identifier = identifier or UUID(str(uuid7()))
    key = f"stories/{story_id}/{identifier}"
    await put_image(key, data, mime)
    blob = ImageBlob(
        id=identifier,
        story_id=story_id,
        object_key=key,
        mime=mime,
        size=len(data),
        width=width,
        height=height,
    )
    db.add(blob)
    await db.flush()
    return blob


def image_out(image: StoryImage, blob: ImageBlob, uses: int = 0) -> ImageOut:
    return ImageOut(
        id=image.id,
        archived=image.archived and not uses and not image.attachments,
        manuscript_uses=uses,
        name=image.name,
        alt=image.alt,
        caption=image.caption,
        attachments=image.attachments,
        size=blob.size,
        width=blob.width,
        height=blob.height,
        url=f"/api/stories/{image.story_id}/images/{image.id}/file",
    )


def public_images(state: dict[str, Any], base_url: str) -> list[dict[str, Any]]:
    refs = {
        match[1]
        for scene in state.get("scene", [])
        for match in IMAGE_REF.findall(scene.get("content") or "")
    }
    targets = {
        kind: {str(row["id"]) for row in state.get(TARGET_STATE[kind], [])} for kind in TARGETS
    }
    result = []
    for row in state.get("story_image", []):
        attachments = [
            a for a in row.get("attachments", []) if a["id"] in targets.get(a["entity"], set())
        ]
        if str(row["id"]) in refs or attachments:
            result.append(
                {k: row[k] for k in ("id", "name", "alt", "caption", "blob_id")}
                | {"attachments": attachments, "url": f"{base_url}/{row['id']}/file"}
            )
    return result


async def image_response(
    db: AsyncSession, story_id: UUID, image_id: UUID, rows: list[dict[str, Any]] | None = None
) -> Response[bytes]:
    if rows is None:
        image = await db.scalar(
            select(StoryImage).where(StoryImage.id == image_id, StoryImage.story_id == story_id)
        )
        # A scene revision can refer to an image removed from the current picker.
        blob_id = image.blob_id if image else image_id
    else:
        row = next((row for row in rows if row["id"] == str(image_id)), None)
        if row is None:
            raise NotFoundException(detail="Image not available in this reading")
        blob_id = UUID(row["blob_id"])
    blob = await db.scalar(
        select(ImageBlob).where(ImageBlob.id == blob_id, ImageBlob.story_id == story_id)
    )
    if blob is None:
        raise NotFoundException(detail="Image not found")
    return Response(
        content=await get_image(blob.object_key),
        media_type=blob.mime,
        headers={"cache-control": "private, no-store", "x-content-type-options": "nosniff"},
    )


async def export_images(
    db: AsyncSession, story_id: UUID, markdown: str
) -> dict[str, tuple[bytes, str, str, str]]:
    result = {}
    for alt, identifier in IMAGE_REF.findall(markdown):
        if identifier in result:
            continue
        image = await db.scalar(
            select(StoryImage).where(
                StoryImage.id == UUID(identifier), StoryImage.story_id == story_id
            )
        )
        blob = await db.get(ImageBlob, image.blob_id if image else UUID(identifier))
        if blob is None or blob.story_id != story_id:
            raise ClientException(
                detail="The manuscript contains an image that does not belong to this story"
            )
        raw, mime = await get_image(blob.object_key), blob.mime
        if mime == "image/webp":
            with Image.open(io.BytesIO(raw)) as decoded:
                buffer = io.BytesIO()
                decoded.save(buffer, format="PNG")
                raw, mime = buffer.getvalue(), "image/png"
        result[identifier] = (
            raw,
            mime,
            image.alt if image else alt,
            image.caption if image else "",
        )
    return result


async def portable_images(
    db: AsyncSession, state: dict[str, Any], *, include_history: bool = False
) -> dict[str, str]:
    result = {}
    story_id = UUID(state["story"][0]["id"])
    if include_history:
        blobs = list(await db.scalars(select(ImageBlob).where(ImageBlob.story_id == story_id)))
    else:
        blobs = [
            await db.get(ImageBlob, UUID(image["blob_id"]))
            for image in state.get("story_image", [])
        ]
    for blob in blobs:
        if blob is None or blob.story_id != story_id:
            raise ClientException(detail="A backup image is unavailable")
        result[str(blob.id)] = base64.b64encode(await get_image(blob.object_key)).decode("ascii")
    return result


async def import_images(
    db: AsyncSession,
    state: dict[str, Any],
    files: dict[str, str],
    copied: dict[str, Any],
    story_id: UUID,
    *,
    image_ids: dict[str, str] | None = None,
) -> None:
    rows = state.get("story_image", [])
    if not {r["blob_id"] for r in rows} <= set(files) or len(files) > MAX_STORY_IMAGES:
        raise ValueError("The backup's image files are incomplete")
    decoded = [decode_image(encoded) for encoded in files.values()]
    references = {
        m[1]
        for kind in ("scene", "scene_revision")
        for row in state.get(kind, [])
        for m in IMAGE_REF.findall(row.get("content") or "")
    }
    if not references <= set(files):
        raise ValueError("The backup is missing a manuscript image")
    for data in decoded:
        inspect_image(data)
    await check_capacity(db, story_id, [len(data) for data in decoded])
    mapping = image_ids or {
        old["blob_id"]: new["id"]
        for old, new in zip(rows, copied.get("story_image", []), strict=True)
    }
    for old_id, data in zip(files, decoded, strict=True):
        await save_blob(db, story_id, data, UUID(mapping[old_id]))
    for row in copied.get("story_image", []):
        attachments = [ImageAttachment.model_validate(a) for a in row.get("attachments", [])]
        # Targets are validated against the copied graph before it is inserted.
        for a in attachments:
            if str(a.id) not in {r["id"] for r in copied.get(TARGET_STATE[a.entity], [])}:
                raise ValueError("An image points outside this backup")


class StoryImagesController(Controller):
    path = "/api/stories/{story_id:uuid}/images"
    tags = ["images"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012 - Litestar controller configuration

    @get()
    async def library(self, db_session: AsyncSession, story_id: UUID) -> ImageLibrary:
        rows = await db_session.execute(
            select(StoryImage, ImageBlob)
            .join(ImageBlob, StoryImage.blob_id == ImageBlob.id)
            .where(StoryImage.story_id == story_id)
            .order_by(StoryImage.created_at)
        )
        count, size = await image_usage(db_session, story_id)
        prose = await db_session.scalars(select(Scene.content).where(Scene.story_id == story_id))
        uses = Counter(
            match[1].lower() for text in prose for match in IMAGE_REF.findall(text or "")
        )
        return ImageLibrary(
            images=[image_out(i, b, uses[str(i.id)]) for i, b in rows],
            retained_count=count,
            retained_bytes=size,
        )

    @post(request_max_body_size=8 * 1024 * 1024)
    async def upload(self, db_session: AsyncSession, story_id: UUID, data: ImageUpload) -> ImageOut:
        prior = await db_session.get(ImageBlob, data.upload_id)
        if prior is not None:
            if prior.story_id != story_id:
                raise NotFoundException(detail="Image not found")
            image = await db_session.get(StoryImage, prior.id)
            if image is None:
                raise ClientException(
                    status_code=409, detail="This uploaded image has been removed from the library"
                )
            return image_out(image, prior)
        await validate_attachments(db_session, story_id, data.attachments)
        raw = decode_image(data.data)
        inspect_image(raw)
        await check_capacity(db_session, story_id, [len(raw)])
        blob = await save_blob(db_session, story_id, raw, data.upload_id)
        image = StoryImage(
            id=blob.id,
            story_id=story_id,
            blob_id=blob.id,
            **data.model_dump(mode="json", exclude={"data", "upload_id"}),
        )
        db_session.add(image)
        await db_session.flush()
        return image_out(image, blob)

    @patch("/{image_id:uuid}")
    async def describe(
        self, db_session: AsyncSession, story_id: UUID, image_id: UUID, data: ImageDescription
    ) -> ImageOut:
        image = await db_session.scalar(
            select(StoryImage).where(StoryImage.id == image_id, StoryImage.story_id == story_id)
        )
        if image is None:
            raise NotFoundException(detail="Image not found")
        await validate_attachments(db_session, story_id, data.attachments)
        for key, value in data.model_dump(mode="json").items():
            setattr(image, key, value)
        await db_session.flush()
        blob = await db_session.get(ImageBlob, image.blob_id)
        assert blob is not None
        return image_out(image, blob)

    @delete("/{image_id:uuid}")
    async def remove(
        self, db_session: AsyncSession, request: Request, story_id: UUID, image_id: UUID
    ) -> None:
        image = await db_session.scalar(
            select(StoryImage).where(StoryImage.id == image_id, StoryImage.story_id == story_id)
        )
        if image is None:
            raise NotFoundException(detail="Image not found")
        scenes = list(await db_session.scalars(select(Scene).where(Scene.story_id == story_id)))
        affected = [
            scene
            for scene in scenes
            if any(
                match[1].lower() == str(image_id)
                for match in IMAGE_REF.findall(scene.content or "")
            )
        ]
        if image.archived and not affected and not image.attachments:
            return
        from storytool.domain.versioning.service import checkpoint

        label = f"Before deleting image: {image.name}"[:200]
        await checkpoint(
            db_session,
            story_id,
            request.scope["state"]["storytool_user_id"],
            label,
            "recovery",
            state=request.scope["state"].get("storytool_version_context", {}).get("before"),
        )
        for scene in affected:
            content = IMAGE_REF.sub(
                lambda match: "" if match[2].lower() == str(image_id) else match[0],
                scene.content or "",
            )
            await save_scene_content(
                db_session, scene, content, snapshot=True, snapshot_label=label
            )
        image.archived = True
        image.attachments = []

    @get("/{image_id:uuid}/file")
    async def file(
        self, db_session: AsyncSession, story_id: UUID, image_id: UUID
    ) -> Response[bytes]:
        return await image_response(db_session, story_id, image_id)


class SharedImagesController(Controller):
    path = "/api/shared-stories/{story_id:uuid}/images"
    tags = ["images"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012 - Litestar controller configuration

    @get("/{image_id:uuid}/file")
    async def file(
        self, request: Request, db_session: AsyncSession, story_id: UUID, image_id: UUID
    ) -> Response[bytes]:
        from storytool.domain.story.sharing import actor, shared_source
        from storytool.domain.versioning.service import full_state

        await shared_source(db_session, actor(request), story_id)
        rows = public_images(await full_state(db_session, story_id), "")
        return await image_response(db_session, story_id, image_id, rows)


class ShowcaseImagesController(Controller):
    path = "/api/showcase/{token:str}/images"
    tags = ["images"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012 - Litestar controller configuration

    @get("/{image_id:uuid}/file")
    async def file(self, db_session: AsyncSession, token: str, image_id: UUID) -> Response[bytes]:
        from storytool.domain.story.models import Story
        from storytool.domain.story.showcase import StoryShowcase
        from storytool.domain.versioning.service import full_state

        story_id = await db_session.scalar(
            select(Story.id)
            .join(StoryShowcase, StoryShowcase.story_id == Story.id)
            .where(
                StoryShowcase.token == token,
                StoryShowcase.enabled.is_(True),
                Story.deleted_at.is_(None),
            )
        )
        if story_id is None:
            raise NotFoundException(detail="Showcase unavailable")
        return await image_response(
            db_session,
            story_id,
            image_id,
            public_images(await full_state(db_session, story_id), ""),
        )


class BetaImagesController(Controller):
    path = "/api/beta/rounds/{round_id:uuid}/images"
    tags = ["images"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012 - Litestar controller configuration

    @get("/{image_id:uuid}/file")
    async def file(
        self, request: Request, db_session: AsyncSession, round_id: UUID, image_id: UUID
    ) -> Response[bytes]:
        from storytool.domain.story.beta import round_access

        row, _, _, _ = await round_access(db_session, request, round_id)
        return await image_response(
            db_session, row.story_id, image_id, row.snapshot["structure"].get("story_image", [])
        )
