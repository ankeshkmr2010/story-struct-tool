"""Reverse outline: which drafted scenes has the outline fallen behind, and what an agent needs to
catch it up. Computed on every read from prose, outline fields and field authorship; never stored.
Both the MCP tool and the in-app assistant use this same worklist.
"""

import hashlib
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from storytool.domain.story.authorship import FieldAuthorship

PROSE_LIMIT = 12000

INSTRUCTIONS = (
    "Reverse outline: build the outline from the prose already written. For each listed scene, "
    "read its prose and propose only what the prose shows: update scene.summary (what actually "
    "happens, 1-3 sentences), set location_id or pov_character_id when clear, link characters "
    "who appear with scene_presence, and create characters, locations or events the prose "
    "introduces that are not in `known`. Reuse known IDs; never duplicate a known name or alias. "
    "Do not change prose. Do not invent anything the prose does not show. Put everything in one "
    "proposal with this base_fingerprint so the author can accept all, some or none."
)


async def catchup_worklist(
    db: AsyncSession, story_id: UUID, state: dict[str, Any], limit: int = 6
) -> dict[str, Any]:
    changed = {
        (str(entity_id), field): at
        for entity_id, field, at in await db.execute(
            select(
                FieldAuthorship.entity_id,
                FieldAuthorship.field,
                func.max(FieldAuthorship.created_at),
            )
            .where(
                FieldAuthorship.story_id == story_id,
                FieldAuthorship.entity_type == "scene",
                FieldAuthorship.field.in_(["content", "summary"]),
            )
            .group_by(FieldAuthorship.entity_id, FieldAuthorship.field)
        )
    }
    chapters = {row["id"]: row for row in state["chapter"]}
    present: dict[str, list[str]] = {}
    for row in state["scene_presence"]:
        if not row.get("is_rejected"):
            present.setdefault(row["scene_id"], []).append(row["character_id"])
    events: dict[str, list[str]] = {}
    for row in state["event"]:
        if row.get("scene_id"):
            events.setdefault(row["scene_id"], []).append(row["id"])

    def order(scene: dict[str, Any]) -> tuple[float, float]:
        chapter = chapters.get(scene.get("chapter_id") or "")
        return (chapter["sort_key"] if chapter else float("inf"), scene["sort_key"])

    pending = []
    drafted = 0
    for scene in sorted(state["scene"], key=order):
        if not (scene.get("content") or "").strip():
            continue
        drafted += 1
        reasons = []
        if not (scene.get("summary") or "").strip():
            reasons.append("no_summary")
        else:
            prose_at = changed.get((scene["id"], "content"))
            summary_at = changed.get((scene["id"], "summary"))
            if prose_at and (not summary_at or prose_at > summary_at):
                reasons.append("prose_changed_since_summary")
        if not present.get(scene["id"]):
            reasons.append("no_characters")
        if not scene.get("location_id"):
            reasons.append("no_location")
        if reasons:
            pending.append((scene, reasons))

    def compact(scene: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
        chapter = chapters.get(scene.get("chapter_id") or "")
        content = scene["content"]
        return {
            "id": scene["id"],
            "title": scene.get("title"),
            "chapter": {"id": chapter["id"], "title": chapter.get("title")} if chapter else None,
            "reasons": reasons,
            "summary": scene.get("summary"),
            "location_id": scene.get("location_id"),
            "location_text": scene.get("location"),
            "pov_character_id": scene.get("pov_character_id"),
            "character_ids": present.get(scene["id"], []),
            "event_ids": events.get(scene["id"], []),
            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            "prose": content[:PROSE_LIMIT],
            "prose_truncated": len(content) > PROSE_LIMIT,
        }

    return {
        "instructions": INSTRUCTIONS,
        "drafted_scenes": drafted,
        "pending_scenes": len(pending),
        "scenes": [compact(scene, reasons) for scene, reasons in pending[:limit]],
        "known": {
            "character": [
                {"id": r["id"], "name": r["name"], "aliases": r.get("aliases") or []}
                for r in state["character"]
            ],
            "location": [{"id": r["id"], "name": r["name"]} for r in state["location"]],
            "event": [
                {"id": r["id"], "label": r["label"], "scene_id": r.get("scene_id")}
                for r in state["event"]
            ],
        },
    }
