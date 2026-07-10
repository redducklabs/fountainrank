import logging
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.config import Settings

logger = logging.getLogger("app.logto_management")


class LogtoManagementError(Exception):
    """Raised when a required Logto Management API operation cannot complete."""


IDENTITY_ERROR_DETAIL_MAX_LEN = 500


def identity_error_detail(exc: LogtoManagementError) -> str:
    """Compact description for `deleted_accounts.identity_delete_error`, so an operator can
    tell a misconfiguration from a 5xx without a debugger. Safe to persist: every
    LogtoManagementError message is static text plus an HTTP status — never a credential."""
    return f"{type(exc).__name__}: {exc}"[:IDENTITY_ERROR_DETAIL_MAX_LEN]


@dataclass(frozen=True)
class LogtoManagementClient:
    settings: Settings
    transport: httpx.AsyncBaseTransport | None = None

    async def delete_user(self, logto_user_id: str) -> None:
        if not self.settings.logto_management_configured:
            raise LogtoManagementError("logto management api is not configured")

        try:
            async with httpx.AsyncClient(timeout=5.0, transport=self.transport) as client:
                token = await self._fetch_access_token(client)
                resource = self.settings.logto_management_api_base.rstrip("/")
                user_path = quote(logto_user_id, safe="")
                response = await client.delete(
                    f"{resource}/users/{user_path}",
                    headers={"Authorization": f"Bearer {token}"},
                )
        except httpx.HTTPError as exc:
            raise LogtoManagementError("logto management request failed") from exc
        if response.status_code in (204, 404):
            if response.status_code == 404:
                logger.warning("logto user already missing during account deletion")
            return
        raise LogtoManagementError(f"logto user delete failed with status {response.status_code}")

    async def _fetch_access_token(self, client: httpx.AsyncClient) -> str:
        # `client_secret_basic` — the auth method Logto registers M2M apps with, and the shape
        # every Logto doc shows. Keeping the secret out of the form body also keeps it out of
        # anything that logs request bodies. Per RFC 6749 §2.3.1 the id and secret are
        # form-urlencoded before base64; Logto's oidc-provider decodeURIComponent()s them back.
        app_id = self.settings.logto_management_app_id or ""
        app_secret = self.settings.logto_management_app_secret or ""
        response = await client.post(
            self.settings.logto_token_uri,
            auth=(quote(app_id, safe=""), quote(app_secret, safe="")),
            data={
                "grant_type": "client_credentials",
                "resource": self.settings.logto_management_api_resource,
                "scope": "all",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code < 200 or response.status_code >= 300:
            raise LogtoManagementError(
                f"logto management token failed with status {response.status_code}"
            )
        try:
            token = response.json()["access_token"]
        except (KeyError, TypeError, ValueError) as exc:
            raise LogtoManagementError(
                "logto management token response missing access_token"
            ) from exc
        if not isinstance(token, str) or not token:
            raise LogtoManagementError("logto management token response missing access_token")
        return token
