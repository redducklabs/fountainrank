import json
from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # Async SQLAlchemy URL. NOTE: asyncpg rejects libpq `?sslmode=` args —
    # never add sslmode here; SSL (DO Managed Postgres) goes via connect_args.
    database_url: str = (
        "postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank"
    )
    app_name: str = "fountainrank-backend"
    # Path to the CA cert (PEM) for DO Managed Postgres TLS, mounted as a k8s secret
    # in production (env DB_SSL_ROOT_CERT). Unset locally -> plaintext, no SSL.
    db_ssl_root_cert: str | None = None

    # Logging (see app/logging_config.py + CLAUDE.md "Logging & Observability").
    # LOG_LEVEL: standard level name. LOG_FORMAT: "json" (structured, default) or
    # "console" (human-readable for local dev).
    log_level: str = "INFO"
    log_format: str = "json"

    # Browser origins allowed to call the API cross-origin (the web client). The
    # deployed web app at these origins calls api.fountainrank.com from Phase 2 on.
    # NoDecode: take the raw env string ourselves rather than letting pydantic-settings
    # JSON-decode it — a bare list[str] from env crashes startup on a comma-separated or
    # empty value (see claude_help/testing-ci.md). We accept either form.
    cors_allow_origins: Annotated[list[str], NoDecode] = [
        "https://fountainrank.com",
        "https://www.fountainrank.com",
        "http://localhost:3020",
    ]

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _parse_cors_allow_origins(cls, v: object) -> object:
        # Env arrives as a raw string (NoDecode). Accept a comma-separated list (the
        # natural ops form) or a JSON array; empty -> no origins. The Python default
        # (already a list) passes through untouched.
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                return json.loads(s)
            return [origin.strip() for origin in s.split(",") if origin.strip()]
        return v

    # --- Phase 1 ---
    # Dev-only write-auth seam. FALSE in production so add/rate stay closed until
    # Phase 2's Logto JWT validation lands. Local dev + tests set this True.
    dev_auth_enabled: bool = False
    # Bayesian ranking confidence constant `m` (see ranking.py / spec §8).
    ranking_confidence_m: int = 5
    # Reject a new fountain if one already exists within this many meters (spec §7).
    duplicate_threshold_m: float = 10.0
    # Map-read guardrails.
    nearby_default_radius_m: float = 1000.0
    nearby_max_radius_m: float = 50_000.0
    max_results: int = 500


@lru_cache
def get_settings() -> Settings:
    return Settings()
