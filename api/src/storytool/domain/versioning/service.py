"""Snapshot and atomically restore all authored story tables and edges.

The caller holds the existing per-story advisory lock. Account credentials, AI
activity, and previous whole-story versions are deliberately outside the graph.
"""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.commands import ENTITIES, LINKS, json_value, restore_value
from storytool.domain.ai.models import AIRun, StoryObservation
from storytool.domain.narrative.models import Annotation, SceneRevision, Suggestion
from storytool.domain.narrative.prose import count_words
from storytool.domain.versioning.models import StoryVersion
from storytool.domain.versioning.schemas import VersionChange

EXTRAS: dict[str, Any] = {
    "annotation": Annotation.__table__,
    "scene_revision": SceneRevision.__table__,
    "suggestion": Suggestion.__table__,
}
AUDIT = {"created_at", "updated_at", "sa_orm_sentinel", "word_count"}
ADMIN = {"user_id", "parent_story_id", "deleted_at"}


async def full_state(db: AsyncSession, story_id: UUID) -> dict[str, Any]:
    state: dict[str, Any] = {"format_version": 1}
    identifiers: dict[str, list[UUID]] = {}
    for kind, (model, _, _) in ENTITIES.items():
        table = model.__table__
        if kind == "story":
            query = select(table).where(table.c.id == story_id)
        elif kind == "arc_stage":
            query = select(table).where(table.c.arc_id.in_(identifiers["arc"]))
        else:
            query = select(table).where(table.c.story_id == story_id)
        rows = (await db.execute(query.order_by(table.c.id))).mappings().all()
        identifiers[kind] = [row["id"] for row in rows]
        state[kind] = [
            json_value(
                {
                    k: v
                    for k, v in row.items()
                    if k != "sa_orm_sentinel" and not (kind == "story" and k in ADMIN)
                }
            )
            for row in rows
        ]
    for kind, (table, left, _, left_col, _) in LINKS.items():
        rows = (
            (await db.execute(select(table).where(table.c[left_col].in_(identifiers[left]))))
            .mappings()
            .all()
        )
        state[kind] = sorted(
            [json_value({k: v for k, v in row.items() if k != "sa_orm_sentinel"}) for row in rows],
            key=lambda row: json.dumps(row, sort_keys=True),
        )
    for kind, table in EXTRAS.items():
        condition = (
            table.c.story_id == story_id
            if kind == "suggestion"
            else table.c.scene_id.in_(identifiers["scene"])
        )
        rows = (
            (await db.execute(select(table).where(condition).order_by(table.c.id))).mappings().all()
        )
        state[kind] = [
            json_value({k: v for k, v in row.items() if k != "sa_orm_sentinel"}) for row in rows
        ]
    return state


def semantic(state: dict[str, Any]) -> dict[str, Any]:
    return {
        kind: [{key: value for key, value in row.items() if key not in AUDIT} for row in rows]
        for kind, rows in state.items()
        if isinstance(rows, list)
    }


def fingerprint(state: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(semantic(state), sort_keys=True).encode()).hexdigest()


def statistics(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "counts": {kind: len(rows) for kind, rows in state.items() if isinstance(rows, list)},
        "word_count": sum(count_words(row.get("content")) for row in state["scene"]),
    }


async def checkpoint(
    db: AsyncSession,
    story_id: UUID,
    user_id: UUID,
    label: str,
    source: str,
    state: dict[str, Any] | None = None,
) -> StoryVersion:
    state = state if state is not None else await full_state(db, story_id)
    number = (
        await db.scalar(
            select(func.max(StoryVersion.number)).where(StoryVersion.story_id == story_id)
        )
        or 0
    ) + 1
    record = StoryVersion(
        story_id=story_id,
        user_id=user_id,
        number=number,
        label=label,
        source=source,
        state=state,
        fingerprint=fingerprint(state),
        statistics=statistics(state),
    )
    db.add(record)
    await db.flush()
    return record


async def automatic_checkpoint(
    db: AsyncSession,
    story_id: UUID,
    user_id: UUID,
    state: dict[str, Any],
    label: str,
    force: bool = False,
) -> None:
    latest_fingerprint = await db.scalar(
        select(StoryVersion.fingerprint)
        .where(StoryVersion.story_id == story_id)
        .order_by(StoryVersion.number.desc())
        .limit(1)
    )
    if latest_fingerprint == fingerprint(state):
        return
    automatic_created = await db.scalar(
        select(StoryVersion.created_at)
        .where(StoryVersion.story_id == story_id, StoryVersion.source == "automatic")
        .order_by(StoryVersion.number.desc())
        .limit(1)
    )
    if (
        not force
        and automatic_created
        and (datetime.now(UTC) - automatic_created).total_seconds() < 60
    ):
        return
    await checkpoint(db, story_id, user_id, label, "automatic", state)
    # Retain 50 automatic checkpoints. Named, initial and recovery checkpoints stay.
    obsolete = (
        select(StoryVersion.id)
        .where(StoryVersion.story_id == story_id, StoryVersion.source == "automatic")
        .order_by(StoryVersion.number.desc())
        .offset(50)
    )
    await db.execute(delete(StoryVersion).where(StoryVersion.id.in_(obsolete)))


def changes(current: dict[str, Any], target: dict[str, Any]) -> tuple[list[VersionChange], int]:
    result = []
    now, then = semantic(current), semantic(target)
    labels = {
        row["id"]: str(
            row.get("name") or row.get("title") or row.get("label") or kind.replace("_", " ")
        )
        for graph in [now, then]
        for kind, rows in graph.items()
        for row in rows
        if "id" in row
    }
    for kind in now:
        if kind in LINKS:
            old_links = {json.dumps(row, sort_keys=True) for row in now[kind]}
            new_links = {json.dumps(row, sort_keys=True) for row in then[kind]}
            if old_links != new_links:
                result.append(
                    VersionChange(
                        entity=kind,
                        title=kind.replace("_", " "),
                        action="restore links",
                        before={"removed links": str(len(old_links - new_links))},
                        after={"added links": str(len(new_links - old_links))},
                    )
                )
            continue
        old = {row["id"]: row for row in now[kind]}
        new = {row["id"]: row for row in then[kind]}
        for identifier in sorted(old.keys() | new.keys()):
            before, after = old.get(identifier, {}), new.get(identifier, {})
            if before == after:
                continue
            title = (
                after.get("title")
                or after.get("name")
                or after.get("label")
                or before.get("title")
                or before.get("name")
                or before.get("label")
                or kind.replace("_", " ")
            )
            fields = [
                field
                for field in sorted(before.keys() | after.keys())
                if field not in {"id", "story_id"} and before.get(field) != after.get(field)
            ]

            def brief(value: Any) -> str:
                return "Not set" if value is None else labels.get(str(value), str(value)[:300])

            result.append(
                VersionChange(
                    entity=kind,
                    title=str(title),
                    action="add" if not before else "remove" if not after else "update",
                    fields=fields,
                    before={f: brief(before.get(f)) for f in fields},
                    after={f: brief(after.get(f)) for f in fields},
                )
            )
    return result[:50], len(result)


async def restore_state(db: AsyncSession, story_id: UUID, state: dict[str, Any]) -> None:
    if state.get("format_version") != 1 or state["story"][0]["id"] != str(story_id):
        raise ValueError("Invalid story version")
    current = await full_state(db, story_id)
    for kind, table in EXTRAS.items():
        condition = (
            table.c.story_id == story_id
            if kind == "suggestion"
            else table.c.scene_id.in_([UUID(s["id"]) for s in current["scene"]])
        )
        await db.execute(delete(table).where(condition))
    await db.execute(delete(StoryObservation).where(StoryObservation.story_id == story_id))
    for _kind, (table, left, _, left_col, _) in LINKS.items():
        await db.execute(
            delete(table).where(table.c[left_col].in_([UUID(row["id"]) for row in current[left]]))
        )
    for kind in reversed(list(ENTITIES)):
        if kind == "story":
            continue
        table = ENTITIES[kind][0].__table__
        await db.execute(
            delete(table).where(table.c.id.in_([UUID(row["id"]) for row in current[kind]]))
        )
    deferred = []
    for kind, (model, _, _) in ENTITIES.items():
        if kind == "story":
            continue
        table = model.__table__
        for row in state[kind]:
            values = {key: restore_value(table.c[key], value) for key, value in row.items()}
            later = {}
            for column in table.c:
                if (
                    column.foreign_keys
                    and column.nullable
                    and column.name not in {"story_id"}
                    and kind != "arc"
                ):
                    later[column.name] = values.pop(column.name, None)
                    values[column.name] = None
            if kind == "scene":
                values["word_count"] = count_words(values.get("content"))
            await db.execute(insert(table).values(**values))
            if later:
                deferred.append((table, values["id"], later))
    for table, identifier, values in deferred:
        await db.execute(update(table).where(table.c.id == identifier).values(**values))
    story_table = ENTITIES["story"][0].__table__
    values = {
        key: restore_value(story_table.c[key], value)
        for key, value in state["story"][0].items()
        if key not in AUDIT | ADMIN | {"id"}
    }
    await db.execute(update(story_table).where(story_table.c.id == story_id).values(**values))
    for kind, (table, _, _, _, _) in LINKS.items():
        for row in state[kind]:
            await db.execute(
                insert(table).values(
                    **{key: restore_value(table.c[key], value) for key, value in row.items()}
                )
            )
    for kind, table in EXTRAS.items():
        for row in state[kind]:
            await db.execute(
                insert(table).values(
                    **{key: restore_value(table.c[key], value) for key, value in row.items()}
                )
            )
    # Activity is an append-only ledger. Old graph-specific plans/undo cannot be reused.
    await db.execute(
        update(AIRun)
        .where(AIRun.story_id == story_id, AIRun.status.in_(["proposed", "applied"]))
        .values(status="superseded")
    )
    await db.flush()
