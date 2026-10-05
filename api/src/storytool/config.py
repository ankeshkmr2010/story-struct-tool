"""Runtime configuration. Env-var driven with dev defaults.

Deliberately env-only (no branching on "is this local vs container vs hosted") so the
same image runs unchanged as a dev container or a deployed service.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="STORYTOOL_", env_file=".env", extra="ignore")

    debug: bool = True

    # Postgres in dev and prod both -- see DESIGN.md section 7.
    database_url: str = "postgresql+asyncpg://storytool:storytool@localhost:5432/storytool"

    # Echo SQL in logs. Noisy; opt-in.
    db_echo: bool = False

    # --- Noticing (Phase 4) -------------------------------------------------
    # Read from the unprefixed name the Anthropic SDK itself uses, so one variable
    # configures both.
    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")

    # "sonnet equivalent" per the product decision. claude-haiku-4-5 is the cheaper swap if
    # these calls prove simple enough; it is a one-line change.
    noticing_model: str = "claude-sonnet-5-5"

    # On by default, but gated on credentials existing -- with no key the deterministic
    # noticer is used and the feature degrades instead of erroring or billing anyone.
    noticing_use_claude: bool = True

    @property
    def claude_noticing_available(self) -> bool:
        return bool(self.noticing_use_claude and self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
