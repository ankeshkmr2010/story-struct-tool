"""SQLAlchemy wiring for Litestar: async engine, session-per-request, Alembic config."""

import inspect
import json
import logging
from datetime import UTC, datetime

from advanced_alchemy.extensions.litestar import (
    AlembicAsyncConfig,
    EngineConfig,
    SQLAlchemyAsyncConfig,
    SQLAlchemyPlugin,
)
from litestar.types import Message, Scope
from sqlalchemy import update

from storytool.config import get_settings
from storytool.db import models as _models  # noqa: F401  -- registers all tables
from storytool.db.base import metadata
from storytool.domain.story.models import Story


def build_db_config() -> SQLAlchemyAsyncConfig:
    settings = get_settings()
    config = SQLAlchemyAsyncConfig(
        connection_string=settings.database_url,
        metadata=metadata,
        engine_config=EngineConfig(
            echo=settings.db_echo,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            connect_args=settings.database_connect_args,
        ),
        # Commit the request's session on a 2xx response; roll back otherwise. Keeps
        # controllers free of explicit commit calls.
        before_send_handler="autocommit",
        alembic_config=AlembicAsyncConfig(
            script_location="src/storytool/db/migrations",
        ),
    )
    original = config.before_send_handler
    assert callable(original)

    async def versioned_commit(message: Message, scope: Scope) -> None:
        context = (
            scope.get("state", {}).pop("storytool_version_context", None)
            if message["type"] == "http.response.start"
            else None
        )
        live_id = (
            scope.get("state", {}).pop("storytool_live_story_id", None)
            if message["type"] == "http.response.start"
            else None
        )
        if (
            message["type"] == "http.response.start"
            and (context or live_id)
            and 200 <= message["status"] < 300
        ):
            from storytool.domain.versioning import service as versions

            db = config.provide_session(scope["app"].state, scope)
            try:
                await db.flush()
                if context:
                    after = await versions.full_state(db, context["story_id"])
                    from uuid import UUID

                    from storytool.domain.ai.models import AIRun
                    from storytool.domain.story.authorship import record_changes

                    origin = scope.get("state", {}).get("storytool_write_origin", "author")
                    actor_label = "External MCP client" if origin == "mcp" else "Author"
                    path = scope.get("path", "")
                    if path.endswith("/scaffold"):
                        origin, actor_label = "system", "Framework scaffold"
                    if context["ai_batch"]:
                        run_id = path.split("/ai/runs/", 1)[1].split("/", 1)[0]
                        run = await db.get(AIRun, UUID(run_id))
                        if run:
                            origin = "mcp" if run.provider == "external" else "assistant"
                            actor_label = (
                                "External MCP client"
                                if origin == "mcp"
                                else f"App assistant ({run.model})"
                            )
                        if path.endswith("/undo"):
                            origin, actor_label = "undo", "Undo applied changes"
                    removed = [
                        (kind, row)
                        for kind in after
                        if isinstance(after[kind], list)
                        for row in context["before"].get(kind, [])
                        if "id" in row and row["id"] not in {r.get("id") for r in after[kind]}
                    ]
                    if removed and not scope.get("state", {}).get("explicit_deletion_checkpoint"):
                        await versions.checkpoint(
                            db,
                            context["story_id"],
                            context["user_id"],
                            "Before deleting story entities",
                            "recovery",
                            context["before"],
                        )
                    await record_changes(
                        db,
                        context["story_id"],
                        context["user_id"],
                        context["before"],
                        after,
                        origin,
                        actor_label,
                    )
                    if context["initial"]:
                        await versions.checkpoint(
                            db,
                            context["story_id"],
                            context["user_id"],
                            "Before the first versioned edit",
                            "initial",
                            context["before"],
                        )
                    if versions.fingerprint(context["before"]) != versions.fingerprint(after):
                        if context["ai_batch"]:
                            await versions.automatic_checkpoint(
                                db,
                                context["story_id"],
                                context["user_id"],
                                context["before"],
                                "Before assistant changes",
                                force=True,
                            )
                        await versions.automatic_checkpoint(
                            db,
                            context["story_id"],
                            context["user_id"],
                            after,
                            "After assistant changes"
                            if context["ai_batch"]
                            else "Editing checkpoint",
                            force=context["ai_batch"] or bool(removed),
                        )
                if live_id:
                    await db.execute(
                        update(Story)
                        .where(Story.id == live_id)
                        .values(updated_at=datetime.now(UTC))
                    )
                # Checkpoint failure must abort the edit rather than commit it without history.
                await db.commit()
            except Exception as exc:
                await db.rollback()
                logging.getLogger("storytool.versions").error(
                    "Story checkpoint failed (%s); request rolled back", type(exc).__name__
                )
                body = json.dumps(
                    {
                        "status_code": 503,
                        "detail": "Could not save this edit and its story checkpoint. "
                        "Keep your changes open and retry.",
                    }
                ).encode()
                scope.setdefault("state", {})["storytool_version_error"] = body
                message["status"] = 503
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() not in {b"content-type", b"content-length"}
                ]
                headers.extend(
                    [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ]
                )
                message["headers"] = headers
        if message["type"] == "http.response.body" and scope.get("state", {}).get(
            "storytool_version_error"
        ):
            message["body"] = scope["state"]["storytool_version_error"]
            message["more_body"] = False
        result = original(message, scope)
        if inspect.isawaitable(result):
            await result

    config.before_send_handler = versioned_commit
    return config


def build_db_plugin() -> SQLAlchemyPlugin:
    return SQLAlchemyPlugin(config=build_db_config())
