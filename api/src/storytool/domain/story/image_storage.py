"""Private Neon S3 storage. Call only after StoryTool has authorized the image."""

import asyncio
import io
import warnings
from typing import Any

import boto3
from botocore.config import Config
from litestar.exceptions import ClientException, ServiceUnavailableException
from PIL import Image

from storytool.config import get_settings

MIME = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MAX_PIXELS = 20_000_000


def client() -> Any:
    settings = get_settings()
    if not all(
        (
            settings.image_storage_endpoint,
            settings.image_storage_access_key,
            settings.image_storage_secret_key,
        )
    ):
        raise ServiceUnavailableException(detail="Image storage is not configured yet")
    return boto3.client(
        "s3",
        endpoint_url=settings.image_storage_endpoint,
        region_name=settings.image_storage_region,
        aws_access_key_id=settings.image_storage_access_key,
        aws_secret_access_key=settings.image_storage_secret_key,
        config=Config(
            s3={"addressing_style": "path"},
            signature_version="s3v4",
            connect_timeout=10,
            read_timeout=30,
            retries={"max_attempts": 2},
        ),
    )


def inspect_image(data: bytes) -> tuple[str, int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                mime = MIME.get(image.format or "")
                if not mime or image.width * image.height > MAX_PIXELS:
                    raise ValueError()
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError()
                width, height = image.size
                image.verify()
        return mime, width, height
    except (ValueError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ClientException(
            detail="Use a still JPEG, PNG or WebP image up to 20 megapixels"
        ) from None


async def put_image(key: str, data: bytes, mime: str) -> None:
    def put() -> None:
        client().put_object(
            Bucket=get_settings().image_bucket,
            Key=key,
            Body=data,
            ContentType=mime,
            CacheControl="private, max-age=300",
        )

    try:
        await asyncio.to_thread(put)
    except ServiceUnavailableException:
        raise
    except Exception:
        raise ServiceUnavailableException(detail="Image upload failed. Please retry.") from None


async def get_image(key: str) -> bytes:
    def read() -> bytes:
        response = client().get_object(Bucket=get_settings().image_bucket, Key=key)
        try:
            return response["Body"].read()
        finally:
            response["Body"].close()

    try:
        return await asyncio.to_thread(read)
    except ServiceUnavailableException:
        raise
    except Exception:
        raise ServiceUnavailableException(
            detail="This image is temporarily unavailable. Please retry."
        ) from None
