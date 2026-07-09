import httpx
import pytest

from app.config import Settings
from app.logto_management import LogtoManagementClient, LogtoManagementError


def _settings() -> Settings:
    return Settings(
        logto_endpoint="https://auth.example.com",
        logto_management_app_id="m2m-app",
        logto_management_app_secret="secret",
        logto_management_resource="https://default.logto.app/api",
        logto_management_api_base_url="https://auth.example.com/api",
    )


@pytest.mark.asyncio
async def test_delete_user_fetches_token_and_deletes_user():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url == "https://auth.example.com/oidc/token":
            return httpx.Response(200, json={"access_token": "token"})
        if request.url == "https://auth.example.com/api/users/logto%7Cabc":
            assert request.headers["authorization"] == "Bearer token"
            return httpx.Response(204)
        return httpx.Response(404)

    client = LogtoManagementClient(_settings(), transport=httpx.MockTransport(handler))

    await client.delete_user("logto|abc")

    assert [request.method for request in requests] == ["POST", "DELETE"]
    assert b"client_secret=secret" in requests[0].content
    assert b"resource=https%3A%2F%2Fdefault.logto.app%2Fapi" in requests[0].content
    assert b"scope=all" in requests[0].content
    assert requests[1].url == "https://auth.example.com/api/users/logto%7Cabc"


@pytest.mark.asyncio
async def test_delete_user_treats_missing_logto_user_as_deleted():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "token"})
        return httpx.Response(404)

    client = LogtoManagementClient(_settings(), transport=httpx.MockTransport(handler))

    await client.delete_user("already-missing")


@pytest.mark.asyncio
async def test_delete_user_fails_when_not_configured():
    client = LogtoManagementClient(Settings())

    with pytest.raises(LogtoManagementError):
        await client.delete_user("logto|abc")


@pytest.mark.asyncio
async def test_delete_user_fails_when_logto_delete_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "token"})
        return httpx.Response(500, json={"error": "down"})

    client = LogtoManagementClient(_settings(), transport=httpx.MockTransport(handler))

    with pytest.raises(LogtoManagementError):
        await client.delete_user("logto|abc")


@pytest.mark.asyncio
async def test_delete_user_wraps_token_network_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    client = LogtoManagementClient(_settings(), transport=httpx.MockTransport(handler))

    with pytest.raises(LogtoManagementError):
        await client.delete_user("logto|abc")


@pytest.mark.asyncio
async def test_delete_user_wraps_delete_network_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "token"})
        raise httpx.ConnectError("down", request=request)

    client = LogtoManagementClient(_settings(), transport=httpx.MockTransport(handler))

    with pytest.raises(LogtoManagementError):
        await client.delete_user("logto|abc")
