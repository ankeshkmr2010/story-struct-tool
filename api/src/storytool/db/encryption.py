"""Story text encrypted at rest with server-held keys (AES-256-GCM).

Columns typed ``EncryptedText`` / ``EncryptedJSON`` are encrypted on the way into Postgres and
decrypted on the way out, so the rest of the code reads and writes plain values. A database leak,
backup or database admin sees ``enc:v1:<key id>:<ciphertext>``; the running app can still read
everything, which is what AI, search, checks and exports need.

Keys come from ``STORYTOOL_DATA_KEYS`` ("id:base64key,id2:base64key"; 32-byte keys) with
``STORYTOOL_DATA_KEY_ID`` naming the one new writes use. Older keys keep decrypting, so a key can
be rotated by adding a new one and re-encrypting. STORYTOOL_DATA_ENCRYPT_WRITES=false keeps the keys
for reading but writes plain (the rollback path). With no keys configured values are written
plain, and plain values (no prefix) are always readable: that is what lets existing rows be
encrypted gradually. Postgres cannot search or compare ciphertext, so text search, sorting by
title and similar work happens in Python after rows are read.
"""

import base64
import hashlib
import hmac
import json
import os
from functools import lru_cache
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import TypeDecorator

from storytool.config import get_settings

PREFIX = "enc:v1:"
# Binds ciphertext to this purpose, so it cannot be replayed as another kind of secret.
AAD = b"storytool:story-text:v1"


class DataKeyError(RuntimeError):
    """A value was encrypted with a key this server does not have."""


@lru_cache(maxsize=4)
def _keyring(spec: str, current: str | None) -> tuple[str | None, dict[str, AESGCM], bytes | None]:
    keys: dict[str, AESGCM] = {}
    raw: dict[str, bytes] = {}
    for part in filter(None, (piece.strip() for piece in spec.split(","))):
        key_id, _, encoded = part.partition(":")
        secret = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        if not key_id or len(secret) != 32:
            raise DataKeyError("STORYTOOL_DATA_KEYS entries must be id:base64 of 32 bytes")
        keys[key_id], raw[key_id] = AESGCM(secret), secret
    if not keys:
        return None, {}, None
    write_id = current or next(iter(keys))
    if write_id not in keys:
        raise DataKeyError("STORYTOOL_DATA_KEY_ID names a key that is not in STORYTOOL_DATA_KEYS")
    return write_id, keys, raw[write_id]


def keyring() -> tuple[str | None, dict[str, AESGCM], bytes | None]:
    settings = get_settings()
    write_id, keys, secret = _keyring(settings.data_keys, settings.data_key_id)
    # Rolling back: keys stay for reading, new writes are plain.
    return (write_id if settings.data_encrypt_writes else None), keys, secret


def enabled() -> bool:
    """New writes are encrypted."""
    return keyring()[0] is not None


def decrypting() -> bool:
    """Keys are configured but writes are plain: existing ciphertext should be turned back."""
    return not enabled() and bool(keyring()[1])


def is_encrypted(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(value: str) -> str:
    write_id, keys, _ = keyring()
    if write_id is None or is_encrypted(value):
        return value
    nonce = os.urandom(12)
    sealed = keys[write_id].encrypt(nonce, value.encode(), AAD)
    return f"{PREFIX}{write_id}:{base64.urlsafe_b64encode(nonce + sealed).decode().rstrip('=')}"


def decrypt(value: str) -> str:
    if not is_encrypted(value):
        return value
    key_id, _, body = value[len(PREFIX) :].partition(":")
    key = keyring()[1].get(key_id)
    if key is None:
        raise DataKeyError(f"Story text is encrypted with key {key_id!r}, which is not configured")
    blob = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    return key.decrypt(blob[:12], blob[12:], AAD).decode()


def text_order(value: str | None) -> tuple[str, str]:
    """Sort key for decrypted names and titles: case-insensitive, then exact."""
    return ((value or "").casefold(), value or "")


def digest(value: str) -> str:
    """A content hash that cannot confirm guesses without the key (plain SHA-256 with no key)."""
    secret = keyring()[2]
    if secret is None:
        return hashlib.sha256(value.encode()).hexdigest()
    return hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()


class EncryptedText(TypeDecorator[str]):
    """Text stored encrypted; reads and writes look like ordinary strings."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        return None if value is None else encrypt(str(value))

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        return None if value is None else decrypt(value)


class EncryptedJSON(TypeDecorator[Any]):
    """JSON stored as one encrypted JSON string; reads and writes look like ordinary JSON."""

    impl = JSONB
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if value is None or not enabled():
            return value
        return encrypt(json.dumps(value, separators=(",", ":"), ensure_ascii=False))

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        return json.loads(decrypt(value)) if is_encrypted(value) else value
