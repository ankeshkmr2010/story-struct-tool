"""Runtime configuration. Env-var driven with dev defaults.

Deliberately env-only (no branching on "is this local vs container vs hosted") so the
same image runs unchanged as a dev container or a deployed service.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STORYTOOL_", env_file=".env", extra="ignore")

    debug: bool = True

    # Postgres in dev and prod both -- see DESIGN.md section 7.
    database_url: str = "postgresql+asyncpg://storytool:storytool@localhost:5432/storytool"

    # Echo SQL in logs. Noisy; opt-in.
    db_echo: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
