"""Encrypt story text that was written before a data key was configured (or decrypt it all).

Run at startup after migrations (scripts/start-production.sh). Without a key it does nothing; with
one it finds rows whose encrypted columns still hold plain values and rewrites them in batches, so
it is safe to run on every start and after adding or rotating a key. With
STORYTOOL_DATA_ENCRYPT_WRITES=false it runs the other way, turning every value back into plain
text, which must finish before code that predates encryption is deployed. Rows keep their
updated_at: encryption is not an edit, so "last edited", search indexes and versions are
left alone.

    python -m storytool.db.encrypt_existing
"""

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import Text, cast, or_, select, type_coerce, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

import storytool.db.models  # noqa: F401  (registers every table)
from storytool.config import get_settings
from storytool.db.base import metadata
from storytool.db.encryption import (
    PREFIX,
    EncryptedJSON,
    EncryptedText,
    decrypt,
    decrypting,
    enabled,
)

logger = logging.getLogger(__name__)
BATCH = 200


def encrypted_columns(table: Any) -> list[Any]:
    return [c for c in table.columns if isinstance(c.type, EncryptedText | EncryptedJSON)]


def ciphertext(column: Any) -> Any:
    """SQL test for a value that is ciphertext (JSON ciphertext is a JSON string)."""
    marker = PREFIX if isinstance(column.type, EncryptedText) else f'"{PREFIX}'
    return cast(column, Text).startswith(marker)


async def decrypt_table(engine: AsyncEngine, table: Any) -> int:
    columns = encrypted_columns(table)
    done = 0
    while True:
        async with engine.begin() as conn:
            rows = (
                (
                    await conn.execute(
                        select(table.c.id, *[cast(c, Text).label(c.name) for c in columns])
                        .where(or_(*[ciphertext(c) for c in columns]))
                        .limit(BATCH)
                    )
                )
                .mappings()
                .all()
            )
            for row in rows:
                values: dict[str, Any] = {}
                for column in columns:
                    stored = row[column.name]
                    if stored is None:
                        continue
                    if isinstance(column.type, EncryptedText) and stored.startswith(PREFIX):
                        # type_coerce writes the plain text as-is, bypassing the encrypting type.
                        values[column.name] = type_coerce(decrypt(stored), Text)
                    elif not isinstance(column.type, EncryptedText) and stored.startswith(
                        f'"{PREFIX}'
                    ):
                        plain = json.loads(decrypt(json.loads(stored)))
                        values[column.name] = type_coerce(plain, JSONB)
                await conn.execute(
                    update(table)
                    .where(table.c.id == row["id"])
                    .values(**values, updated_at=table.c.updated_at)
                )
            done += len(rows)
        if len(rows) < BATCH:
            return done


def still_plain(column: Any) -> Any:
    """SQL test for a value that is not yet ciphertext (JSON ciphertext is a JSON string).

    JSON null holds no text and writing it back stays null, so it is never "still plain"
    (otherwise the batch loop would pick the same row up forever)."""
    if isinstance(column.type, EncryptedText):
        return column.is_not(None) & ~cast(column, Text).startswith(PREFIX)
    stored = cast(column, Text)
    return column.is_not(None) & (stored != "null") & ~stored.startswith(f'"{PREFIX}')


async def encrypt_table(engine: AsyncEngine, table: Any) -> int:
    columns = encrypted_columns(table)
    done = 0
    while True:
        async with engine.begin() as conn:
            # Read the stored text as-is (cast to TEXT skips the decrypting column types).
            rows = (
                (
                    await conn.execute(
                        select(table.c.id, *[cast(c, Text).label(c.name) for c in columns])
                        .where(or_(*[still_plain(c) for c in columns]))
                        .limit(BATCH)
                    )
                )
                .mappings()
                .all()
            )
            for row in rows:
                values: dict[str, Any] = {}
                for column in columns:
                    stored = row[column.name]
                    if (
                        stored is None
                        or stored == "null"
                        or stored.startswith((PREFIX, f'"{PREFIX}'))
                    ):
                        continue
                    # Plain values go back through the column type, which encrypts them.
                    values[column.name] = (
                        stored if isinstance(column.type, EncryptedText) else json.loads(stored)
                    )
                await conn.execute(
                    update(table)
                    .where(table.c.id == row["id"])
                    .values(**values, updated_at=table.c.updated_at)
                )
            done += len(rows)
        if len(rows) < BATCH:
            return done


async def encrypt_existing(engine: AsyncEngine | None = None) -> dict[str, int]:
    if not enabled() and not decrypting():
        logger.info("No STORYTOOL_DATA_KEYS: story text is stored plain")
        return {}
    step = encrypt_table if enabled() else decrypt_table
    own = engine is None
    engine = engine or create_async_engine(get_settings().database_url)
    try:
        counts = {}
        for table in metadata.sorted_tables:
            if encrypted_columns(table):
                counts[table.name] = await step(engine, table)
        return counts
    finally:
        if own:
            await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = asyncio.run(encrypt_existing())
    label = "Encrypted rows:" if enabled() else "Decrypted rows:"
    print(label, {name: count for name, count in result.items() if count})
