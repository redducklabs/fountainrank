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
    settings = Settings()
    assert "https://fountainrank.com" in settings.cors_allow_origins


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
