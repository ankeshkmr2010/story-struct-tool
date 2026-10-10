"""Whole-story backup, restore-as-a-copy, and Word export. The words must be able to leave."""

import copy
import io
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from docx import Document
from litestar import Controller, Request, Response, get, post
from litestar.exceptions import ClientException, NotFoundException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils import uuid7

from storytool.domain.ai.commands import ENTITIES, LINKS
from storytool.domain.analysis import load_graph_by_id
from storytool.domain.narrative.prose import compile_manuscript
from storytool.domain.story.models import Story
from storytool.domain.story.schemas import StoryOut
from storytool.domain.versioning.service import ADMIN, EXTRAS, checkpoint, full_state, restore_state

BACKUP_FORMAT = "storytool-backup"
MAX_BACKUP_BYTES = 50 * 1024 * 1024


def tables() -> dict[str, Any]:
    return {
        **{kind: model.__table__ for kind, (model, _, _) in ENTITIES.items()},
        **{kind: table for kind, (table, _, _, _, _) in LINKS.items()},
        **EXTRAS,
    }


def rehome(state: dict[str, Any], story_id: UUID, *, strict: bool = False) -> dict[str, Any]:
    """Copy a full_state under fresh IDs. Strict mode rejects references outside the copy."""
    state = copy.deepcopy(state)
    identifiers = {row["id"]: str(uuid7()) for kind in ENTITIES for row in state[kind]}
    identifiers[state["story"][0]["id"]] = str(story_id)
    for kind, table in tables().items():
        for row in state.get(kind, []):
            if "id" in row:
                row["id"] = identifiers[row["id"]] if kind in ENTITIES else str(uuid7())
            for column in table.c:
                value = row.get(column.name)
                if not column.foreign_keys or value is None:
                    continue
                if value in identifiers:
                    row[column.name] = identifiers[value]
                elif strict:
                    raise ValueError(f"{kind}.{column.name} points outside this backup")
    return state


def validated_state(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("format") != BACKUP_FORMAT:
        raise ValueError("This is not a StoryTool backup file")
    if payload.get("version") != 1:
        raise ValueError("This backup was made by a newer StoryTool")
    state = payload.get("state")
    if not isinstance(state, dict) or state.get("format_version") != 1:
        raise ValueError("The backup's story data is missing or unreadable")
    known = tables()
    unknown = set(state) - set(known) - {"format_version"}
    if unknown:
        raise ValueError("Unknown sections: " + ", ".join(sorted(unknown)))
    clean: dict[str, Any] = {"format_version": 1}
    seen: set[str] = set()
    for kind, table in known.items():
        rows = state.get(kind, [])
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ValueError(f"Section {kind} must be a list of records")
        columns = set(table.c.keys())
        for row in rows:
            extra = set(row) - columns
            if extra:
                raise ValueError(f"Unknown {kind} fields: " + ", ".join(sorted(extra)))
            if kind in ENTITIES:
                if not isinstance(row.get("id"), str) or row["id"] in seen:
                    raise ValueError(f"Every {kind} needs a unique id")
                seen.add(row["id"])
        clean[kind] = [
            {k: v for k, v in row.items() if not (kind == "story" and k in ADMIN)} for row in rows
        ]
    if len(clean["story"]) != 1:
        raise ValueError("A backup holds exactly one story")
    return clean


def slug(title: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (title or "story").lower()).strip("-") or "story"


_INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)")


def add_runs(paragraph: Any, text: str) -> None:
    for part in _INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            paragraph.add_run(part[2:-2]).bold = True
        elif len(part) > 2 and part[0] == part[-1] and part[0] in "*_":
            paragraph.add_run(part[1:-1]).italic = True
        else:
            paragraph.add_run(part)


def manuscript_docx(markdown: str) -> bytes:
    """Lay out the compiled Markdown manuscript as a plain Word document."""
    document = Document()
    for block in re.split(r"\n\s*\n", markdown):
        lines = [line.rstrip() for line in block.strip().splitlines()]
        if not lines:
            continue
        first = lines[0]
        heading = re.match(r"^(#{1,4})\s+(.*)$", first)
        if heading and len(lines) == 1:
            level = len(heading.group(1))
            document.add_heading(heading.group(2), 0 if level == 1 else level - 1)
        elif all(line.startswith(">") for line in lines):
            quote = document.add_paragraph(style="Quote")
            add_runs(quote, " ".join(line.lstrip("> ").strip() for line in lines))
        elif lines == ["* * *"]:
            document.add_paragraph("* * *").alignment = 1  # centred scene break
        else:
            add_runs(document.add_paragraph(), " ".join(line.strip() for line in lines))
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


class StoryBackupController(Controller):
    path = "/api/stories/{story_id:uuid}"
    tags = ["backup"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @get("/backup", summary="Download the whole story as a JSON backup")
    async def backup(self, db_session: AsyncSession, story_id: UUID) -> Response[dict[str, Any]]:
        story = await db_session.get(Story, story_id)
        if story is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        exported = datetime.now(UTC)
        return Response(
            content={
                "format": BACKUP_FORMAT,
                "version": 1,
                "exported_at": exported.isoformat(),
                "title": story.title,
                "state": await full_state(db_session, story_id),
            },
            headers={
                "content-disposition": (
                    f'attachment; filename="{slug(story.title)}-{exported:%Y%m%d}.storytool.json"'
                )
            },
        )

    @get("/manuscript.docx", summary="Compile the manuscript as a Word document")
    async def manuscript(
        self, db_session: AsyncSession, story_id: UUID, include_unplaced: bool = True
    ) -> Response[bytes]:
        graph = await load_graph_by_id(db_session, story_id)
        if graph is None:
            raise NotFoundException(detail=f"No story with id {story_id}")
        return Response(
            content=manuscript_docx(compile_manuscript(graph, include_unplaced=include_unplaced)),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "content-disposition": f'attachment; filename="{slug(graph.story.title)}.docx"'
            },
        )


class BackupImportController(Controller):
    path = "/api/backups"
    tags = ["backup"]  # noqa: RUF012 - Litestar controller configuration
    signature_namespace = {"AsyncSession": AsyncSession}  # noqa: RUF012

    @post(
        "/import",
        status_code=201,
        summary="Restore a backup file as a new story",
        request_max_body_size=MAX_BACKUP_BYTES,
    )
    async def import_backup(
        self, db_session: AsyncSession, request: Request, data: dict[str, Any]
    ) -> StoryOut:
        user_id: UUID = request.scope["state"]["storytool_user_id"]
        try:
            state = validated_state(data)
            async with db_session.begin_nested():
                created = Story(
                    title=state["story"][0].get("title") or "Restored story", user_id=user_id
                )
                db_session.add(created)
                await db_session.flush()
                await restore_state(db_session, created.id, rehome(state, created.id, strict=True))
        except (ValueError, TypeError, KeyError, SQLAlchemyError) as error:
            detail = str(error) if isinstance(error, ValueError) else "The backup is damaged"
            raise ClientException(detail=f"Could not restore backup: {detail}") from error
        await db_session.refresh(created)
        from storytool.domain.story.authorship import record_changes

        await record_changes(
            db_session,
            created.id,
            user_id,
            {},
            await full_state(db_session, created.id),
            "import",
            "Restored from backup",
        )
        await checkpoint(db_session, created.id, user_id, "Restored from backup", "initial")
        return StoryOut.model_validate(created)
