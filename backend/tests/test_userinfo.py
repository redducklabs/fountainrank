import httpx
import pytest

from app.config import Settings
from app.userinfo import UserinfoError, UserinfoClaims, fetch_userinfo


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


from app.userinfo import accept_avatar, accept_email, pick_display_name


def _claims(**kw):
    return UserinfoClaims(sub="logto|abc", **kw)


def test_accept_email_takes_valid_verified():
    assert accept_email(_claims(email="Real@Gmail.com", email_verified=True), current="old@x.com") == "Real@Gmail.com"


def test_accept_email_accepts_absent_verified():
    assert accept_email(_claims(email="real@gmail.com"), current="old@x.com") == "real@gmail.com"


def test_accept_email_preserves_on_unverified():
    assert accept_email(_claims(email="real@gmail.com", email_verified=False), current="old@x.com") == "old@x.com"


def test_accept_email_preserves_on_blank_or_invalid():
    cur = "old@x.com"
    assert accept_email(_claims(email="  "), current=cur) == cur
    assert accept_email(_claims(email="not-an-email"), current=cur) == cur
    assert accept_email(_claims(email="a b@x.com"), current=cur) == cur
    assert accept_email(_claims(email="a@b@c.com"), current=cur) == cur
    assert accept_email(_claims(email="@x.com"), current=cur) == cur
    assert accept_email(_claims(email="a@"), current=cur) == cur
    assert accept_email(_claims(email=None), current=cur) == cur


def test_accept_email_rejects_synthetic_domain():
    cur = "old@x.com"
    assert accept_email(_claims(email="logto|abc@users.noreply.fountainrank.com", email_verified=True), current=cur) == cur


def test_pick_display_name_prefers_name_then_username_then_current_then_sub():
    assert pick_display_name(_claims(name="N", username="U"), current="C", sub="logto|abc") == "N"
    assert pick_display_name(_claims(name="  ", username="U"), current="C", sub="logto|abc") == "U"
    assert pick_display_name(_claims(name=None, username=None), current="C", sub="logto|abc") == "C"
    assert pick_display_name(_claims(name="", username=""), current="  ", sub="logto|abc") == "logto|abc"


def test_accept_avatar_only_valid_https_capped():
    assert accept_avatar(_claims(picture="https://img.example/x.png"), current=None) == "https://img.example/x.png"
    assert accept_avatar(_claims(picture="http://img.example/x.png"), current="https://old/a.png") == "https://old/a.png"
    assert accept_avatar(_claims(picture="https://"), current="https://old/a.png") == "https://old/a.png"
    assert accept_avatar(_claims(picture="https://bad host/x"), current="https://old/a.png") == "https://old/a.png"
    assert accept_avatar(_claims(picture="  "), current="https://old/a.png") == "https://old/a.png"
    assert accept_avatar(_claims(picture="https://img.example/" + "x" * 3000), current=None) is None
    assert accept_avatar(_claims(picture=None), current="https://old/a.png") == "https://old/a.png"
