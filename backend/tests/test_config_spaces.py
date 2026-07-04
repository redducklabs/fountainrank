from app.config import Settings


def _base(**kw):
    return Settings(
        database_url="postgresql+asyncpg://x/y",
        logto_endpoint="https://l",
        logto_audience="a",
        **kw,
    )


def test_photos_disabled_without_creds():
    assert _base().photos_enabled is False


def test_photos_enabled_with_full_creds():
    s = _base(
        spaces_endpoint="https://nyc3.digitaloceanspaces.com",
        spaces_region="nyc3",
        spaces_bucket="fr-photos",
        spaces_access_key="k",
        spaces_secret_key="s",
    )
    assert s.photos_enabled is True


def test_endpoint_trailing_slash_normalized():
    s = _base(spaces_endpoint="https://nyc3.digitaloceanspaces.com/")
    assert s.spaces_endpoint == "https://nyc3.digitaloceanspaces.com"
