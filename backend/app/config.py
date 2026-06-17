from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # Async SQLAlchemy URL. NOTE: asyncpg rejects libpq `?sslmode=` args —
    # never add sslmode here; SSL (DO Managed Postgres) goes via connect_args.
    database_url: str = (
        "postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank"
    )
    app_name: str = "fountainrank-backend"


@lru_cache
def get_settings() -> Settings:
    return Settings()
