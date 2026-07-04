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
    # Award the "first in area" contribution bonus only if NO other fountain (including
    # imported ones) already exists within this radius of a new add (gamification §10).
    first_in_area_radius_m: float = 600.0
    # Operational status (#40): only reports within this many days count toward the
    # derived current_status; an authoritative status needs >= this many distinct users.
    condition_freshness_days: int = 90
    condition_corroboration_min: int = 2
    # Default radius (m) for the local contributor leaderboard when no radius_m is given.
    leaderboard_local_radius_m: float = 5000.0

    # --- Crawlable SEO pages (#127, see docs/specs/2026-07-02-crawlable-seo-pages-design.md) ---
    # Thin-content gate (spec §5/§7): a place (country/city) is returned by the public
    # /api/v1/places endpoint, linked, and sitemap-indexed only when its precomputed
    # NON-HIDDEN fountain_count is at least this. Provisional; the coverage gate (Slice 1e)
    # may tune it per scope. Countries are unaffected in practice (any loaded country has
    # far more), so this mainly guards near-empty city pages.
    seo_place_min_fountains: int = 3
    # Thin-content gate for the GLOBAL attribute pages (spec §4.5, "K_attr"): an attribute page
    # (/drinking-fountains/bottle-fillers, /wheelchair-accessible-drinking-fountains) is indexable
    # and sitemap-listed only when its matching NON-HIDDEN fountain count is at least this. Separate
    # from seo_place_min_fountains because global attribute pages scale very differently from a
    # single city. Attributes are crowdsourced, so a page stays noindex until enough are observed.
    seo_attribute_min_fountains: int = 3
    # Cache-Control max-age (== s-maxage) for the public, unauthenticated place endpoints.
    # Place lists change slowly (only on a boundary load / membership refresh), so they cache
    # well at the browser and any shared CDN. One hour by default.
    seo_cache_max_age_seconds: int = 3600

    # --- OSM ingestion (see docs/specs/2026-06-21-osm-fountain-ingestion-design.md) ---
    # Auto-update an imported-only, unrated fountain's location only if it moved <= this.
    osm_move_small_max_m: float = 25.0
    # Movement at/above this flags a review candidate instead of moving.
    osm_move_review_min_m: float = 100.0
    # Untrusted-tag guards for the allow-listed source_tags jsonb.
    osm_tag_max_key_len: int = 64
    osm_tag_max_value_len: int = 255
    osm_tags_max_bytes: int = 4096

    # Logto subjects (the validated JWT `sub`) granted admin. Opaque, case-sensitive ids —
    # trimmed but NEVER lowercased. NoDecode + a custom parser: a bare list[str] from env
    # crashes startup on a comma-separated/empty value (same reasoning as cors_allow_origins).
    admin_subjects: Annotated[list[str], NoDecode] = []

    @field_validator("admin_subjects", mode="before")
    @classmethod
    def _parse_admin_subjects(cls, v: object) -> object:
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                return json.loads(s)
            return [sub.strip() for sub in s.split(",") if sub.strip()]
        return v

    # --- Phase 2a (Logto auth) ---
    # Logto OIDC authority. Issuer + JWKS are DERIVED from this so the backend never
    # depends on the OIDC discovery document (which emits http:// until TRUST_PROXY_HEADER
    # is deployed). Local dev/tests use the dev-auth seam instead of Logto.
    logto_endpoint: str = "https://auth.fountainrank.com"
    # The registered API Resource indicator; becomes the JWT `aud` the backend requires.
    logto_audience: str = "https://api.fountainrank.com"
    # How long a fetched JWKS key set is trusted before a refetch is allowed.
    logto_jwks_cache_ttl_seconds: int = 3600

    @property
    def logto_issuer(self) -> str:
        return f"{self.logto_endpoint.rstrip('/')}/oidc"

    @property
    def logto_jwks_uri(self) -> str:
        return f"{self.logto_issuer}/jwks"

    @property
    def logto_userinfo_uri(self) -> str:
        return f"{self.logto_issuer}/me"

    # --- Email (Logto HTTP email connector -> Gmail API) ---
    # The Google service-account JSON key (whole file, as a string), the impersonated
    # Workspace mailbox (domain-wide delegation), the visible From, and the shared bearer
    # token Logto's HTTP email connector sends. All default None so local dev/tests do not
    # send (the webhook returns 503 unless these are set).
    google_service_account_json: str | None = None
    google_delegated_user: str | None = None
    from_email: str | None = None
    logto_email_webhook_token: str | None = None

    @property
    def email_configured(self) -> bool:
        return bool(
            self.logto_email_webhook_token
            and self.google_service_account_json
            and self.google_delegated_user
        )

    # --- Geocoding (search proxy, spec §8) ---
    # Selects the code-level provider impl (+ its hardcoded host, spec §8.2). No base-URL
    # setting: the provider host is a per-provider code constant, never operator-configurable
    # (removes the SSRF/misrouting footgun entirely).
    geocoding_provider: str = "locationiq"
    # The only secret. Default None -> feature disabled (never a crash), same as the email
    # connector: the endpoint fails closed to 503 geocoding_disabled until a key is set.
    geocoding_api_key: str | None = None
    # Short-TTL, in-process response cache (per-pod, process-local only; spec §8.3).
    geocoding_cache_ttl_seconds: int = 300
    # Coarse in-process token-bucket throttle to smooth bursts (politeness/UX guard, not the
    # spend boundary -- the provider's own no-overage quota is; spec §8.3).
    geocoding_throttle_max_per_window: int = 30
    geocoding_throttle_window_seconds: int = 60

    @property
    def geocoding_enabled(self) -> bool:
        return bool(self.geocoding_api_key)

    # --- DO Spaces (fountain photos) ---
    # S3-compatible object storage for user-uploaded fountain photos. All default None ->
    # feature disabled (fails closed, same idiom as email/geocoding) until an operator
    # provisions a Space and sets all five.
    spaces_endpoint: str | None = None
    spaces_region: str | None = None
    spaces_bucket: str | None = None
    spaces_access_key: str | None = None
    spaces_secret_key: str | None = None
    # How long a presigned upload/download URL remains valid.
    spaces_presign_ttl_seconds: int = 600
    # How long a client-reserved (not-yet-confirmed) upload slot is held before expiring.
    upload_reservation_ttl_seconds: int = 120

    @field_validator("spaces_endpoint")
    @classmethod
    def _normalize_spaces_endpoint(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.rstrip("/")
        if not v.startswith("https://"):
            raise ValueError("spaces_endpoint must be https")
        return v

    @property
    def photos_enabled(self) -> bool:
        return all(
            [
                self.spaces_endpoint,
                self.spaces_region,
                self.spaces_bucket,
                self.spaces_access_key,
                self.spaces_secret_key,
            ]
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
