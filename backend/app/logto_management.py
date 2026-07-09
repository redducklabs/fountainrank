import logging
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.config import Settings

logger = logging.getLogger("app.logto_management")


class LogtoManagementError(Exception):
    """Raised when a required Logto Management API operation cannot complete."""


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
        response = await client.post(
            self.settings.logto_token_uri,
            data={
                "grant_type": "client_credentials",
                "client_id": self.settings.logto_management_app_id,
                "client_secret": self.settings.logto_management_app_secret,
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
