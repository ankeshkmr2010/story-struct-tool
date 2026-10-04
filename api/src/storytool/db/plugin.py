"""SQLAlchemy wiring for Litestar: async engine, session-per-request, Alembic config."""

from advanced_alchemy.extensions.litestar import (
    AlembicAsyncConfig,
    EngineConfig,
    SQLAlchemyAsyncConfig,
    SQLAlchemyPlugin,
)

from storytool.config import get_settings
from storytool.db import models as _models  # noqa: F401  -- registers all tables
from storytool.db.base import metadata


def build_db_config() -> SQLAlchemyAsyncConfig:
    settings = get_settings()
    return SQLAlchemyAsyncConfig(
        connection_string=settings.database_url,
        metadata=metadata,
        engine_config=EngineConfig(echo=settings.db_echo),
        # Commit the request's session on a 2xx response; roll back otherwise. Keeps
        # controllers free of explicit commit calls.
        before_send_handler="autocommit",
        alembic_config=AlembicAsyncConfig(
            script_location="src/storytool/db/migrations",
        ),
    )


def build_db_plugin() -> SQLAlchemyPlugin:
    return SQLAlchemyPlugin(config=build_db_config())
