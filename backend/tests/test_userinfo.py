import httpx
import pytest

from app.config import Settings
from app.userinfo import UserinfoError, fetch_userinfo


def _transport(handler):
    return httpx.MockTransport(handler)


async def test_fetch_userinfo_parses_claims():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer opaque-1"
        return httpx.Response(200, json={"sub": "logto|abc", "email": "a@b.com", "name": "A"})

    claims = await fetch_userinfo("opaque-1", Settings(), transport=_transport(handler))
    assert claims.sub == "logto|abc"
    assert claims.email == "a@b.com"
    assert claims.name == "A"


async def test_fetch_userinfo_non_200_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid"})

    with pytest.raises(UserinfoError):
        await fetch_userinfo("x", Settings(), transport=_transport(handler))


async def test_fetch_userinfo_missing_sub_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"email": "a@b.com"})

    with pytest.raises(UserinfoError):
        await fetch_userinfo("x", Settings(), transport=_transport(handler))


async def test_fetch_userinfo_blank_sub_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"sub": "   "})

    with pytest.raises(UserinfoError):
        await fetch_userinfo("x", Settings(), transport=_transport(handler))


async def test_fetch_userinfo_malformed_json_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    with pytest.raises(UserinfoError):
        await fetch_userinfo("x", Settings(), transport=_transport(handler))


async def test_fetch_userinfo_oversized_body_raises():
    big = {"sub": "logto|abc", "pad": "x" * 70000}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=big)

    with pytest.raises(UserinfoError):
        await fetch_userinfo("x", Settings(), transport=_transport(handler))


async def test_fetch_userinfo_network_error_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(UserinfoError):
        await fetch_userinfo("x", Settings(), transport=_transport(handler))


def test_userinfo_uri_derivation():
    assert Settings().logto_userinfo_uri == "https://auth.fountainrank.com/oidc/me"
    assert (
        Settings(logto_endpoint="https://auth.fountainrank.com/").logto_userinfo_uri
        == "https://auth.fountainrank.com/oidc/me"
    )
