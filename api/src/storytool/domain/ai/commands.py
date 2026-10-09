"""Typed, owned story operations shared by the assistant and external agents."""

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from litestar.exceptions import ClientException, NotFoundException
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.schemas import Proposal
from storytool.domain.cast import models as cast_models
from storytool.domain.cast import schemas as cast_schemas
from storytool.domain.narrative import models as narrative
from storytool.domain.narrative import schemas as narrative_schemas
from storytool.domain.narrative.prose import save_scene_content
from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryUpdate
from storytool.domain.structure import models as structure
from storytool.domain.structure import schemas as structure_schemas
from storytool.domain.world.models import Location
from storytool.domain.world.schemas import LocationCreate, LocationUpdate

ENTITIES: dict[str, tuple[Any, Any, Any]] = {
    "character": (
        cast_models.Character,
        cast_schemas.CharacterCreate,
        cast_schemas.CharacterUpdate,
    ),
    "location": (Location, LocationCreate, LocationUpdate),
    "act": (structure.Act, structure_schemas.ActCreate, structure_schemas.ActUpdate),
    "beat": (structure.Beat, structure_schemas.BeatCreate, structure_schemas.BeatUpdate),
    "thread": (structure.Thread, structure_schemas.ThreadCreate, structure_schemas.ThreadUpdate),
    "relationship": (
        cast_models.Relationship,
        cast_schemas.RelationshipCreate,
        cast_schemas.RelationshipUpdate,
    ),
    "chapter": (
        narrative.Chapter,
        narrative_schemas.ChapterCreate,
        narrative_schemas.ChapterUpdate,
    ),
    "scene": (narrative.Scene, narrative_schemas.SceneCreate, narrative_schemas.SceneUpdate),
    "event": (structure.Event, structure_schemas.EventCreate, structure_schemas.EventUpdate),
    "arc": (cast_models.Arc, cast_schemas.ArcCreate, cast_schemas.ArcUpdate),
    "arc_stage": (cast_models.ArcStage, cast_schemas.ArcStageCreate, cast_schemas.ArcStageUpdate),
    "story": (Story, None, StoryUpdate),
}
REFERENCES = {
    "act_id": "act",
    "chapter_id": "chapter",
    "scene_id": "scene",
    "arc_id": "arc",
    "location_id": "location",
    "pov_character_id": "character",
    "owner_character_id": "character",
    "character_id": "character",
    "character_a_id": "character",
    "character_b_id": "character",
    "relationship_id": "relationship",
    "thread_id": "thread",
    "opening_turning_point_id": "event",
    "closing_turning_point_id": "event",
}
LINKS: dict[str, tuple[Any, str, str, str, str]] = {
    "chapter_beat": (narrative.chapter_beat, "chapter", "beat", "chapter_id", "beat_id"),
    "scene_beat": (narrative.scene_beat, "scene", "beat", "scene_id", "beat_id"),
    "scene_thread": (narrative.scene_thread, "scene", "thread", "scene_id", "thread_id"),
    "scene_arc_advance": (
        narrative.scene_arc_advance,
        "scene",
        "arc_stage",
        "scene_id",
        "arc_stage_id",
    ),
    "event_character": (
        structure.event_character,
        "event",
        "character",
        "event_id",
        "character_id",
    ),
    "scene_presence": (
        narrative.SceneCharacterMention.__table__,
        "scene",
        "character",
        "scene_id",
        "character_id",
    ),
}


def json_value(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


async def owned_story(db: AsyncSession, story_id: UUID, user_id: UUID) -> Story:
    story = await db.scalar(
        select(Story).where(
            Story.id == story_id, Story.user_id == user_id, Story.deleted_at.is_(None)
        )
    )
    if story is None:
        raise NotFoundException(detail="Story not found")
    return story


async def owned_entity(db: AsyncSession, kind: str, identifier: UUID, story_id: UUID) -> Any:
    model = ENTITIES[kind][0]
    stmt = select(model).where(model.id == identifier)
    if kind == "story":
        stmt = stmt.where(Story.id == story_id)
    elif kind == "arc_stage":
        stmt = stmt.join(cast_models.Arc).where(cast_models.Arc.story_id == story_id)
    else:
        stmt = stmt.where(model.story_id == story_id)
    item = await db.scalar(stmt)
    if item is None:
        raise NotFoundException(detail="Referenced story item not found")
    return item


async def snapshot(db: AsyncSession, story_id: UUID) -> dict[str, Any]:
    result: dict[str, Any] = {}
    ids: dict[str, list[UUID]] = {}
    for kind, (model, _, _) in ENTITIES.items():
        stmt = select(model)
        if kind == "story":
            stmt = stmt.where(model.id == story_id)
        elif kind == "arc_stage":
            stmt = stmt.join(cast_models.Arc).where(cast_models.Arc.story_id == story_id)
        else:
            stmt = stmt.where(model.story_id == story_id)
        rows = list((await db.execute(stmt.order_by(model.id))).scalars())
        ids[kind] = [row.id for row in rows]
        result[kind] = [
            json_value(
                {
                    column.name: getattr(row, column.name)
                    for column in model.__table__.columns
                    if column.name != "sa_orm_sentinel"
                }
            )
            for row in rows
        ]
    for kind, (table, left_kind, _, left_col, _) in LINKS.items():
        link_rows = await db.execute(select(table).where(table.c[left_col].in_(ids[left_kind])))
        result[kind] = sorted(
            [json_value(dict(row._mapping)) for row in link_rows],
            key=lambda row: json.dumps(row, sort_keys=True),
        )
    return result


def fingerprint(state: dict[str, Any]) -> str:
    # A live-update marker changes on staging and other administrative writes too.
    # It must not invalidate a proposal that has not changed the authored graph.
    canonical = {
        kind: [
            {
                key: value
                for key, value in row.items()
                if not (kind == "story" and key == "updated_at")
            }
            for row in rows
        ]
        for kind, rows in state.items()
    }
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


def matches_fingerprint(state: dict[str, Any], expected: str) -> bool:
    legacy = hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()
    return expected in {fingerprint(state), legacy}


async def execute_proposal(
    db: AsyncSession,
    story_id: UUID,
    user_id: UUID,
    proposal: Proposal,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    await owned_story(db, story_id, user_id)
    refs: dict[str, tuple[str, UUID]] = {}
    inverse: list[dict[str, Any]] = []
    if any(operation.op == "delete" for operation in proposal.operations):
        from storytool.domain.versioning.service import full_state

        inverse.append(
            {
                "op": "restore_deleted_graph",
                "entity": "story",
                "state": await full_state(db, story_id),
            }
        )
    created = [operation for operation in proposal.operations if operation.op == "create"]
    for operation in created:
        if operation.entity not in ENTITIES or operation.entity == "story":
            raise ClientException(detail="This entity cannot be created by a proposal")
        if not operation.ref.startswith("new:") or operation.ref in refs:
            raise ClientException(detail="Each created entity needs a unique new: reference")
        refs[operation.ref] = (operation.entity, uuid4())

    async def resolve(kind: str, value: Any, field: str = "reference") -> UUID:
        if isinstance(value, str) and value in refs:
            ref_kind, identifier = refs[value]
            if ref_kind != kind:
                raise ClientException(detail="A proposal reference has the wrong entity type")
            return identifier
        try:
            identifier = UUID(str(value))
        except ValueError as exc:
            raise ClientException(
                detail=(
                    f"Invalid {kind} reference in {field}. Use an existing UUID from "
                    "get_story_context, or a new: reference declared by a create operation "
                    "in this same proposal. A name or label is not an entity ID."
                )
            ) from exc
        await owned_entity(db, kind, identifier, story_id)
        return identifier

    async def validated_data(operation: Any, creating: bool) -> dict[str, Any]:
        schema = ENTITIES[operation.entity][1 if creating else 2]
        allowed = set(schema.model_fields)
        if creating and operation.entity == "arc_stage":
            allowed.add("arc_id")
        if set(operation.data) - allowed:
            raise ClientException(
                detail=f"The model returned unsupported fields for {operation.entity}. "
                "Your story was not changed. Ask it to revise the plan using the listed fields."
            )
        data = dict(operation.data)
        for field, kind in REFERENCES.items():
            if data.get(field) is not None:
                data[field] = await resolve(kind, data[field], field)
        arc_id = data.pop("arc_id", None) if operation.entity == "arc_stage" else None
        try:
            values = schema.model_validate(data).model_dump(exclude_unset=not creating)
        except ValidationError as exc:
            raise ClientException(detail="Invalid entity fields in the proposal") from exc
        model = ENTITIES[operation.entity][0]
        if creating and operation.entity == "arc_stage":
            if arc_id is None:
                raise ClientException(detail="An arc stage needs an arc_id")
            values["arc_id"] = arc_id
        for field, value in values.items():
            if value is None and not model.__table__.c[field].nullable:
                raise ClientException(detail=f"{field} cannot be cleared")
        return values

    # Required dependencies first; optional FKs are filled only after every row exists.
    pending: list[tuple[Any, dict[str, Any]]] = []
    rank = {kind: index for index, kind in enumerate(ENTITIES)}
    for operation in sorted(created, key=lambda operation: rank[operation.entity]):
        values = await validated_data(operation, True)
        model = ENTITIES[operation.entity][0]
        optional_refs = {
            field: values.pop(field)
            for field in list(values)
            if field in REFERENCES
            and model.__table__.c[field].nullable
            and operation.entity != "arc"
        }
        kwargs = {"id": refs[operation.ref][1], **values}
        if operation.entity != "arc_stage":
            kwargs["story_id"] = story_id
        record = model(**kwargs)
        db.add(record)
        await db.flush()
        pending.append((record, optional_refs))
        inverse.append({"op": "delete", "entity": operation.entity, "id": str(record.id)})
    for record, values in pending:
        for field, value in values.items():
            setattr(record, field, value)
    await db.flush()

    for operation in proposal.operations:
        if operation.op == "create":
            continue
        if operation.op == "delete":
            if operation.entity not in ENTITIES or operation.entity == "story" or operation.data:
                raise ClientException(
                    detail=(
                        "Delete an existing entity by UUID with empty data; "
                        "whole-story deletion is not an agent operation"
                    )
                )
            identifier = await resolve(operation.entity, operation.ref)
            record = await owned_entity(db, operation.entity, identifier, story_id)
            await db.delete(record)
            await db.flush()
            continue
        if operation.op == "write_prose":
            if operation.entity != "scene" or set(operation.data) != {
                "content",
                "expected_content_hash",
            }:
                raise ClientException(
                    detail="Prose edits need a scene, content and expected_content_hash"
                )
            identifier = await resolve("scene", operation.ref)
            scene = await owned_entity(db, "scene", identifier, story_id)
            content = operation.data["content"]
            if not isinstance(content, str) or len(content) > 200000:
                raise ClientException(
                    detail="Prose content must be text, at most 200000 characters"
                )
            content_hash = hashlib.sha256((scene.content or "").encode()).hexdigest()
            if operation.data["expected_content_hash"] != content_hash:
                raise ClientException(
                    detail="Scene prose changed; read the scene before proposing edits"
                )
            annotations = list(
                (
                    await db.scalars(
                        select(narrative.Annotation).where(
                            narrative.Annotation.scene_id == identifier
                        )
                    )
                ).all()
            )
            inverse.append(
                {
                    "op": "write_prose",
                    "entity": "scene",
                    "id": str(identifier),
                    "data": {
                        "content": scene.content,
                        "annotations": [
                            {
                                "id": str(a.id),
                                "start_offset": a.start_offset,
                                "end_offset": a.end_offset,
                                "is_orphaned": a.is_orphaned,
                            }
                            for a in annotations
                        ],
                    },
                }
            )
            await save_scene_content(
                db, scene, content, snapshot=True, snapshot_label="Before assistant prose edit"
            )
            continue
        if operation.op == "update":
            if operation.entity not in ENTITIES:
                raise ClientException(detail="Use link/unlink for relationships between entities")
            identifier = await resolve(operation.entity, operation.ref)
            record = await owned_entity(db, operation.entity, identifier, story_id)
            values = await validated_data(operation, False)
            inverse.append(
                {
                    "op": "update",
                    "entity": operation.entity,
                    "id": str(identifier),
                    "data": json_value({field: getattr(record, field) for field in values}),
                }
            )
            for field, value in values.items():
                setattr(record, field, value)
            await db.flush()
            continue
        if operation.entity not in LINKS:
            raise ClientException(detail="Unsupported link operation")
        if set(operation.data) - {"from_id", "to_id", "is_primary"}:
            raise ClientException(detail="Unsupported link fields")
        if "is_primary" in operation.data and operation.entity != "scene_thread":
            raise ClientException(detail="Only scene threads can be primary")
        table, left_kind, right_kind, left_col, right_col = LINKS[operation.entity]
        left = await resolve(left_kind, operation.data.get("from_id"), "from_id")
        right = await resolve(right_kind, operation.data.get("to_id"), "to_id")
        condition = (table.c[left_col] == left) & (table.c[right_col] == right)
        old = (await db.execute(select(table).where(condition))).mappings().one_or_none()
        inverse.append(
            {
                "op": "restore_link",
                "entity": operation.entity,
                "left": str(left),
                "right": str(right),
                "data": json_value(dict(old)) if old else None,
            }
        )
        if operation.entity == "scene_presence":
            values = {
                left_col: left,
                right_col: right,
                "source": "manual",
                "is_rejected": operation.op == "unlink",
            }
            await db.execute(
                insert(table)
                .values(**values)
                .on_conflict_do_update(
                    constraint="one_per_pair",
                    set_={"source": "manual", "is_rejected": values["is_rejected"]},
                )
            )
        elif operation.op == "unlink":
            await db.execute(delete(table).where(condition))
        else:
            values = {left_col: left, right_col: right}
            if operation.entity == "scene_thread":
                if not isinstance(operation.data.get("is_primary", False), bool):
                    raise ClientException(detail="is_primary must be a boolean")
                values["is_primary"] = operation.data.get("is_primary", False)
                await db.execute(
                    insert(table)
                    .values(**values)
                    .on_conflict_do_update(
                        index_elements=[left_col, right_col],
                        set_={"is_primary": values["is_primary"]},
                    )
                )
            else:
                await db.execute(insert(table).values(**values).on_conflict_do_nothing())
    await db.flush()
    return {
        "created": {ref: str(identifier) for ref, (_, identifier) in refs.items()},
        "operations_applied": len(proposal.operations),
    }, inverse


def restore_value(column: Any, value: Any) -> Any:
    if value is None:
        return None
    try:
        kind = column.type.python_type
    except NotImplementedError:
        return value
    if kind is UUID:
        return UUID(value)
    if kind is datetime:
        return datetime.fromisoformat(value)
    return value


async def undo_operations(db: AsyncSession, story_id: UUID, inverse: list[dict[str, Any]]) -> None:
    recovery = next((item for item in inverse if item["op"] == "restore_deleted_graph"), None)
    if recovery:
        from storytool.domain.versioning.service import restore_state

        await restore_state(db, story_id, recovery["state"])
        return
    for operation in reversed(inverse):
        kind = operation["entity"]
        if operation["op"] == "restore_link":
            table, _, _, left_col, right_col = LINKS[kind]
            await db.execute(
                delete(table).where(
                    table.c[left_col] == UUID(operation["left"]),
                    table.c[right_col] == UUID(operation["right"]),
                )
            )
            if operation["data"] is not None:
                values = {
                    field: restore_value(table.c[field], value)
                    for field, value in operation["data"].items()
                }
                await db.execute(insert(table).values(**values))
        else:
            item = await owned_entity(db, kind, UUID(operation["id"]), story_id)
            if operation["op"] == "write_prose":
                await save_scene_content(
                    db,
                    item,
                    operation["data"]["content"],
                    snapshot=True,
                    snapshot_label="Before undoing assistant prose edit",
                )
                for anchor in operation["data"]["annotations"]:
                    annotation = await db.scalar(
                        select(narrative.Annotation).where(
                            narrative.Annotation.id == UUID(anchor["id"]),
                            narrative.Annotation.scene_id == item.id,
                        )
                    )
                    if annotation:
                        for field in ("start_offset", "end_offset", "is_orphaned"):
                            setattr(annotation, field, anchor[field])
            elif operation["op"] == "delete":
                await db.delete(item)
            else:
                for field, value in operation["data"].items():
                    setattr(item, field, restore_value(item.__table__.c[field], value))
            await db.flush()
