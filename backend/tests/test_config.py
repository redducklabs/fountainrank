from app.config import Settings


def test_default_url_is_async_postgres():
    settings = Settings()
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert ":5436/" in settings.database_url


def test_env_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    settings = Settings()
    assert settings.database_url == "postgresql+asyncpg://u:p@h:5432/d"
