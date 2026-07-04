"""Private DigitalOcean Spaces (S3-compatible) storage wrapper for fountain photos.

Lazily builds and caches a single boto3 S3 client. The cache key includes a hash
of the secret key (never the secret itself) so a credential rotation transparently
rebuilds the client without ever logging the secret.

Presigned GET URLs use the configured TTL directly. Window-snapped, stable-within-
window URLs are a deferred optimization (spec §4) -- SigV4 embeds the signing time,
so a stable URL string isn't simple to produce with boto3 alone.
"""

from __future__ import annotations

import boto3

from app.config import Settings

_cache: Storage | None = None
_cache_key: tuple | None = None


class Storage:
    """Thin wrapper around a boto3 S3 client bound to one DO Spaces bucket."""

    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.spaces_bucket
        self._ttl = settings.spaces_presign_ttl_seconds
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.spaces_endpoint,
            region_name=settings.spaces_region,
            aws_access_key_id=settings.spaces_access_key,
            aws_secret_access_key=settings.spaces_secret_key,
        )

    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        """Upload an object as private, with a long-lived immutable cache header."""
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            ACL="private",
            CacheControl="public, max-age=31536000, immutable",
        )

    def delete_object(self, key: str) -> None:
        """Delete an object. Raises on failure (boto3 raises ClientError)."""
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def presign_get(self, key: str) -> str:
        """Return a time-limited signed GET URL for a private object."""
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=self._ttl,
        )


def get_storage(settings: Settings) -> Storage | None:
    """Return the cached Storage instance, or None when photos are disabled.

    Fails closed: any Spaces setting unset -> photos_enabled is False -> None.
    """
    global _cache, _cache_key
    if not settings.photos_enabled:
        return None
    # Cache key includes BOTH keys so a credential rotation rebuilds the client
    # (hash the secret so it never lands in a repr/log).
    k = (
        settings.spaces_endpoint,
        settings.spaces_region,
        settings.spaces_bucket,
        settings.spaces_access_key,
        hash(settings.spaces_secret_key),
    )
    if _cache is None or _cache_key != k:
        _cache, _cache_key = Storage(settings), k
    return _cache


def reset_storage_cache() -> None:
    """Test hook: clear the module-level cache so a new Storage is built next call."""
    global _cache, _cache_key
    _cache, _cache_key = None, None
