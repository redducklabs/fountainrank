from unittest.mock import MagicMock, patch

from app import storage
from app.config import Settings


def _settings():
    return Settings(
        database_url="postgresql+asyncpg://x/y",
        logto_endpoint="https://l",
        logto_audience="a",
        spaces_endpoint="https://nyc3.digitaloceanspaces.com",
        spaces_region="nyc3",
        spaces_bucket="b",
        spaces_access_key="k",
        spaces_secret_key="s",
    )


def setup_function():
    storage.reset_storage_cache()


def test_disabled_returns_none():
    from app.config import Settings as S

    settings = S(
        database_url="postgresql+asyncpg://x/y",
        logto_endpoint="https://l",
        logto_audience="a",
    )
    assert storage.get_storage(settings) is None


@patch("app.storage.boto3")
def test_put_object_private(mock_boto3):
    client = MagicMock()
    mock_boto3.client.return_value = client
    st = storage.get_storage(_settings())
    st.put_object("fountains/a/b.jpg", b"x", "image/jpeg")
    kwargs = client.put_object.call_args.kwargs
    assert kwargs["ACL"] == "private"
    assert kwargs["Bucket"] == "b"
    assert kwargs["Key"] == "fountains/a/b.jpg"


@patch("app.storage.boto3")
def test_presign_get(mock_boto3):
    client = MagicMock()
    client.generate_presigned_url.return_value = "https://signed"
    mock_boto3.client.return_value = client
    assert storage.get_storage(_settings()).presign_get("k") == "https://signed"
