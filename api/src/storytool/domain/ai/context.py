import hashlib
import json
from dataclasses import asdict, replace
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.ai.commands import ENTITIES, LINKS, fingerprint, json_value, snapshot
from storytool.domain.ai.models import StoryObservation
from storytool.domain.ai.patches import LIST_FIELDS, field_hash
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.continuity import run_continuity
from storytool.domain.graph import StoryGraph
from storytool.domain.health import run_health
from storytool.domain.narrative.models import Scene, Suggestion


def prose_revision(content: str | None) -> str:
    return hashlib.sha256((content or "").encode()).hexdigest()


def reader_revision(graph: StoryGraph, scene: Scene) -> str:
    value = {
        "reader_rules_version": 2,
        "prose": prose_revision(scene.content),
        "characters": sorted(
            (str(item.id), item.name, tuple(item.aliases or ())) for item in graph.characters
        ),
        "beats": sorted((str(item.id), item.label, item.description) for item in graph.beats),
        "locations": sorted(
            (str(item.id), item.name, item.description) for item in graph.locations
        ),
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


async def story_context(
    db: AsyncSession,
    story_id: UUID,
    include_prose: bool,
    state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state = state or await snapshot(db, story_id)
    entities = json_value(state)
    prose_budget = 24000
    for rows in entities.values():
        for row in rows:
            for field in [
                "user_id",
                "created_at",
                "updated_at",
                "sa_orm_sentinel",
                "parent_story_id",
            ]:
                row.pop(field, None)
            if "content" in row:
                excerpt = (
                    row["content"][: min(8000, prose_budget)]
                    if include_prose and row["content"]
                    else None
                )
                row["content"] = excerpt
                prose_budget -= len(excerpt or "")
    graph = await load_graph_by_id(db, story_id)
    assert graph is not None
    scenes = {scene.id: scene for scene in graph.scenes}
    observations = list(
        (
            await db.execute(
                select(StoryObservation)
                .where(StoryObservation.story_id == story_id)
                .order_by(StoryObservation.updated_at.desc())
                .limit(40)
            )
        ).scalars()
    )
    observations_out: list[dict[str, Any]] = [
        {
            "id": str(row.id),
            "scene_id": str(row.scene_id),
            "source": row.source,
            "payload": json_value(row.payload),
        }
        for row in observations
        if row.scene_id in scenes
        and row.source_revision == reader_revision(graph, scenes[row.scene_id])
    ]
    if not include_prose:

        def hide_evidence(value: Any) -> None:
            if isinstance(value, dict):
                for field in list(value):
                    if field in {"evidence", "prose"}:
                        value[field] = None
                    else:
                        hide_evidence(value[field])
            elif isinstance(value, list):
                for item in value:
                    hide_evidence(item)

        for observation in observations_out:
            hide_evidence(observation["payload"])
    dismissed = list(
        (
            await db.execute(
                select(Suggestion.message).where(
                    Suggestion.story_id == story_id, Suggestion.is_dismissed.is_(True)
                )
            )
        ).scalars()
    )
    create_schemas = {
        kind: schema.model_json_schema() for kind, (_, schema, _) in ENTITIES.items() if schema
    }
    create_schemas["arc_stage"]["properties"]["arc_id"] = {
        "type": "string",
        "description": "Existing arc UUID or new: reference",
    }
    create_schemas["arc_stage"]["required"].append("arc_id")
    return {
        "story_id": str(story_id),
        "base_fingerprint": fingerprint(state),
        "entities": entities,
        "field_hashes": [
            {"entity": kind, "id": row["id"], "field": field, "hash": field_hash(row[field])}
            for kind, fields in LIST_FIELDS.items()
            for row in state[kind]
            for field in sorted(fields)
        ]
        + (
            [
                {
                    "entity": "scene",
                    "id": row["id"],
                    "field": "content",
                    "hash": prose_revision(row.get("content")),
                }
                for row in state["scene"]
            ]
            if include_prose
            else []
        ),
        "create_schemas": create_schemas,
        "update_schemas": {
            kind: schema.model_json_schema() for kind, (_, _, schema) in ENTITIES.items()
        },
        "link_types": {
            kind: {"from": left, "to": right} for kind, (_, left, right, _, _) in LINKS.items()
        },
        "observations": observations_out,
        "health": json_value([asdict(finding) for finding in run_health(graph)]),
        "continuity": json_value(
            [
                asdict(finding)
                for finding in run_continuity(
                    replace(
                        graph,
                        character_mentions=tuple(
                            (UUID(row["scene_id"]), UUID(row["character_id"]))
                            for row in state["scene_presence"]
                            if row["source"] in {"manual", "confirmed"} and not row["is_rejected"]
                        ),
                    )
                )
            ]
        ),
        "dismissed_feedback": dismissed,
        "context_note": "Prose excerpts are limited to 8000 characters per scene."
        if include_prose
        else "Full scene prose was not shared.",
    }
