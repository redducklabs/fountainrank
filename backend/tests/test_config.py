from app.config import Settings


def test_default_url_is_async_postgres():
    settings = Settings()
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert ":5436/" in settings.database_url


def test_env_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    settings = Settings()
    assert settings.database_url == "postgresql+asyncpg://u:p@h:5432/d"


def test_cors_origins_default_is_list():
    # Exact list equality (not `"url" in settings...`, which CodeQL flags as
    # incomplete-URL-substring-sanitization even though this is list membership).
    settings = Settings()
    assert settings.cors_allow_origins == [
        "https://fountainrank.com",
        "https://www.fountainrank.com",
        "http://localhost:3020",
    ]


def test_cors_origins_parses_comma_separated_env(monkeypatch):
    # The natural ops form must NOT crash startup (a bare list[str] would — see
    # claude_help/testing-ci.md). Whitespace around each origin is trimmed.
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://a.com, https://b.com")
    settings = Settings()
    assert settings.cors_allow_origins == ["https://a.com", "https://b.com"]


def test_cors_origins_parses_json_array_env(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", '["https://c.com"]')
    settings = Settings()
    assert settings.cors_allow_origins == ["https://c.com"]


def test_cors_origins_empty_env_is_empty_list(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "")
    settings = Settings()
    assert settings.cors_allow_origins == []


def test_logto_defaults_and_derived_urls():
    s = Settings()
    assert s.logto_endpoint == "https://auth.fountainrank.com"
    assert s.logto_audience == "https://api.fountainrank.com"
    assert s.logto_jwks_cache_ttl_seconds == 3600
    # Derived from the endpoint — never read from the (pre-fix http) discovery doc.
    assert s.logto_issuer == "https://auth.fountainrank.com/oidc"
    assert s.logto_jwks_uri == "https://auth.fountainrank.com/oidc/jwks"


def test_logto_derived_urls_strip_trailing_slash():
    s = Settings(logto_endpoint="https://auth.example.com/")
    assert s.logto_issuer == "https://auth.example.com/oidc"
    assert s.logto_jwks_uri == "https://auth.example.com/oidc/jwks"


def test_email_defaults_are_unset_and_not_configured():
    s = Settings()
    assert s.google_service_account_json is None
    assert s.google_delegated_user is None
    assert s.from_email is None
    assert s.logto_email_webhook_token is None
    assert s.email_configured is False


def test_email_configured_requires_token_json_and_delegated_user():
    s = Settings(
        google_service_account_json='{"client_email":"x"}',
        google_delegated_user="noreply@fountainrank.com",
        logto_email_webhook_token="t",
    )
    assert s.email_configured is True
    # Missing any one of the three -> not configured.
    assert (
        Settings(
            google_service_account_json='{"client_email":"x"}',
            google_delegated_user="noreply@fountainrank.com",
        ).email_configured
        is False
    )


def test_max_results_pinned():
    from app.config import Settings

    # Pinned contract: mirrored in web/lib/map/constants.ts MAX_BBOX_RESULTS.
    assert Settings().max_results == 500


def test_cors_allows_prod_web_origins():
    # Guard: prod web origins must always be present in the default config,
    # regardless of other default origins that may be added or removed.
    origins = set(Settings().cors_allow_origins)
    assert {"https://fountainrank.com", "https://www.fountainrank.com"} <= origins


def test_cors_exposes_response_headers():
    from app.main import app

    cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert {"X-Request-ID", "X-FountainRank-Truncated"} <= set(cors.kwargs["expose_headers"])


def test_admin_subjects_default_is_empty(monkeypatch):
    monkeypatch.delenv("ADMIN_SUBJECTS", raising=False)
    assert Settings().admin_subjects == []


def test_admin_subjects_parses_comma_separated(monkeypatch):
    monkeypatch.setenv("ADMIN_SUBJECTS", " sub-a , sub-b ")
    assert Settings().admin_subjects == ["sub-a", "sub-b"]


def test_admin_subjects_parses_json_array(monkeypatch):
    monkeypatch.setenv("ADMIN_SUBJECTS", '["sub-c"]')
    assert Settings().admin_subjects == ["sub-c"]


def test_admin_subjects_empty_env_is_empty_list(monkeypatch):
    monkeypatch.setenv("ADMIN_SUBJECTS", "")
    assert Settings().admin_subjects == []


def test_admin_subjects_not_lowercased(monkeypatch):
    # Logto sub is opaque/case-sensitive — must NOT be normalized.
    monkeypatch.setenv("ADMIN_SUBJECTS", "AbC-123")
    assert Settings().admin_subjects == ["AbC-123"]
