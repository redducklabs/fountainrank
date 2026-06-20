# User Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On login, have the backend learn the user's real `email`/`name`/`avatar` from Logto (via the opaque token → Logto userinfo) and store them on the `User` record, replacing the synthetic Phase-2a fallbacks, so `/account` shows real data.

**Architecture:** The `/account` server component (force-dynamic, the page every login lands on) best-effort-forwards the **opaque** Logto access token to a new backend `POST /api/v1/me/sync`; the backend calls Logto **userinfo** with it (backend-authoritative), enforces a `sub` cross-check, and upserts the profile with strict normalization. The opaque token never reaches the browser.

**Tech Stack:** FastAPI · SQLAlchemy 2 async · Pydantic · httpx · pytest (backend). Next.js 16 App Router · `@logto/next@4.2.10` · TypeScript · vitest (web). pnpm + turbo.

**Spec:** `docs/specs/2026-06-19-user-profile-sync-design.md` (Codex Loop A `VERDICT: APPROVED`).

## Global Constraints

- **Backend-authoritative only:** the backend obtains the profile by calling Logto userinfo with the forwarded **opaque** token — it NEVER trusts client-supplied decoded claims. The opaque-token path is a **proven pre-merge gate** (Task 6 probe), not an assumption.
- **`sub` cross-check (security-critical):** `userinfo.sub` MUST equal the authenticated resource-JWT `sub` (`current_user.logto_user_id`), checked BEFORE any mutation, else `403` with the row unchanged.
- **Email acceptance:** accept a userinfo email ONLY if (after `.strip()`) it has no whitespace, is exactly one `@` with non-empty local + domain, is NOT the synthetic `@users.noreply.fountainrank.com` domain, and (when `email_verified` is present) it is `True`. Otherwise preserve the existing email. Never overwrite a real email with blank/invalid/synthetic/unverified.
- **display_name:** first non-empty-after-trim of `name` → `username` → existing → `sub`.
- **avatar_url:** set only a non-whitespace `https://` URL (validated with `urlparse`: `scheme=="https"` + non-empty netloc) ≤ 2048 chars; otherwise preserve existing (do not clear).
- **userinfo httpx client:** explicit `timeout=5.0`, `follow_redirects=False`, **streamed** read aborted past **65536 bytes** (`502` if exceeded); the token never appears in exceptions or logs.
- **Token boundary:** the web sync helper carries `import "server-only"` and uses `getAccessTokenRSC` (RSC context); the opaque token travels only server-to-server (web BFF → backend); never logged, never to the browser. Web posts via plain server-side `fetch`, not the api-client.
- **No new backend deps** (httpx/pydantic/stdlib already present). **No new web deps.** Generated `packages/api-client/{openapi.json,src/schema.d.ts}` are gitignored — never commit them.
- **No `.env` files. No AI attribution in commits/PRs. No time estimates.**
- **Runtime paths/commands:** prefer **repo-relative** commands (`cd backend && ...`) so they work for Claude-on-Windows (Git Bash, `/d/...`) AND Codex-in-WSL (`/mnt/d/...`). The PowerShell runner `run.ps1` is Windows-only.
- **Local gate:** `powershell.exe -NoProfile -File run.ps1 check` (full) / `run.ps1 check -Backend`. The DB container must be up (`run.ps1 up`). Codex (WSL) can corrupt `backend/.venv` — if `uv` fails, `cd backend && rm -rf .venv && uv sync`.
- **Source control:** branch `feat/user-profile-sync` (created) → **pre-merge probe gate (Task 6)** → PR → CI green + Codex Loop B `VERDICT: APPROVED` + all comments addressed → squash-merge → owner-gated `v*.*.*` deploy.

---

## File Structure

**Backend**
- Modify `backend/app/config.py` — add `logto_userinfo_uri` property.
- Create `backend/app/userinfo.py` — `UserinfoClaims` model (with a non-blank `sub` validator), `UserinfoError`, `fetch_userinfo` (streamed, guarded httpx GET), `get_userinfo_fetcher` dependency, and the pure normalization helpers `accept_email`/`pick_display_name`/`accept_avatar`.
- Create `backend/tests/test_userinfo.py` — fetch + normalization unit tests (no network; httpx MockTransport).
- Modify `backend/app/schemas.py` — add `SyncProfileRequest`.
- Modify `backend/app/routers/users.py` — add `POST /api/v1/me/sync`.
- Modify `backend/tests/test_logto_auth.py` — sync endpoint integration tests (reuse the synthetic-bearer fixtures there).
- Modify `backend/tests/test_openapi.py` — assert the new endpoint/schema/response.

**Web**
- Modify `web/lib/logto.ts` — add `scopes: ["email","profile"]`.
- Modify `web/lib/logto.test.ts` — assert the scopes.
- Create `web/lib/server/sync.ts` — server-only `syncProfile(requestId)` helper (`getAccessTokenRSC`).
- Create `web/lib/server/sync.test.ts`.
- Modify `web/app/account/page.tsx` — best-effort `syncProfile` before the existing `GET /api/v1/me`. (The callback is unchanged.)

---

## Task 1: Backend userinfo client (`app/userinfo.py` fetch + model + config URI)

**Files:**
- Modify: `backend/app/config.py` (add `logto_userinfo_uri`)
- Create: `backend/app/userinfo.py` (model + `fetch_userinfo` + `get_userinfo_fetcher`)
- Test: `backend/tests/test_userinfo.py`

**Interfaces:**
- Produces: `UserinfoClaims` (Pydantic: `sub: str` required + non-blank, `email`/`email_verified`/`name`/`username`/`picture` optional), `UserinfoError(reason)`, `MAX_USERINFO_BYTES = 65536`, `async fetch_userinfo(token, settings, *, transport=None) -> UserinfoClaims`, `UserinfoFetcher = Callable[[str], Awaitable[UserinfoClaims]]`, `get_userinfo_fetcher(settings) -> UserinfoFetcher`. Consumed by Tasks 2, 3.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_userinfo.py`:

```python
import httpx
import pytest

from app.config import Settings
from app.userinfo import UserinfoClaims, UserinfoError, fetch_userinfo


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_userinfo.py -v`
Expected: FAIL — `app.userinfo` does not exist / `logto_userinfo_uri` missing.

- [ ] **Step 3: Add the config property**

In `backend/app/config.py`, after the `logto_jwks_uri` property (lines ~81-83):

```python
    @property
    def logto_userinfo_uri(self) -> str:
        return f"{self.logto_issuer}/me"
```

- [ ] **Step 4: Create the userinfo module**

Create `backend/app/userinfo.py`:

```python
"""Logto userinfo client + profile normalization.

The backend learns a user's real profile (email/name/avatar) by calling Logto's
userinfo endpoint with the OPAQUE access token forwarded by the web BFF (a resource
JWT is rejected at userinfo). The token is used only for this call and never logged.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

import httpx
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from app.config import Settings, get_settings

logger = logging.getLogger("app.userinfo")

MAX_USERINFO_BYTES = 65536
_MAX_AVATAR_LEN = 2048
SYNTHETIC_EMAIL_DOMAIN = "@users.noreply.fountainrank.com"


class UserinfoError(Exception):
    """Userinfo could not be fetched/parsed. The endpoint maps this to HTTP 502.
    `reason` is a short machine code for logging — never contains token material."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class UserinfoClaims(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sub: str
    email: str | None = None
    email_verified: bool | None = None
    name: str | None = None
    username: str | None = None
    picture: str | None = None

    @field_validator("sub")
    @classmethod
    def _sub_non_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("blank sub")
        return v


async def fetch_userinfo(
    token: str,
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> UserinfoClaims:
    """GET Logto userinfo with the opaque bearer token, streaming the body and aborting past
    MAX_USERINFO_BYTES. Raises UserinfoError (->502) on any network/timeout/non-200/oversized/
    malformed/missing-or-blank-sub condition; the token is never included in the error."""
    try:
        async with httpx.AsyncClient(
            timeout=5.0, follow_redirects=False, transport=transport
        ) as client:
            async with client.stream(
                "GET",
                settings.logto_userinfo_uri,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status_code != 200:
                    raise UserinfoError("userinfo_status")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_USERINFO_BYTES:
                        raise UserinfoError("userinfo_too_large")
                    chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise UserinfoError("userinfo_unreachable") from exc
    try:
        data = json.loads(b"".join(chunks))
    except ValueError as exc:
        raise UserinfoError("userinfo_malformed") from exc
    try:
        return UserinfoClaims.model_validate(data)
    except ValidationError as exc:
        raise UserinfoError("userinfo_invalid") from exc


UserinfoFetcher = Callable[[str], Awaitable[UserinfoClaims]]


def get_userinfo_fetcher(settings: Settings = Depends(get_settings)) -> UserinfoFetcher:
    """FastAPI dependency; overridden in endpoint tests with a fake fetcher (no network)."""

    async def fetcher(token: str) -> UserinfoClaims:
        return await fetch_userinfo(token, settings)

    return fetcher
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_userinfo.py -v`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/userinfo.py backend/tests/test_userinfo.py
git commit -m "feat(backend): add Logto userinfo client (streamed, guarded) + derived userinfo URI"
```

---

## Task 2: Backend profile normalization helpers (`app/userinfo.py`)

**Files:**
- Modify: `backend/app/userinfo.py` (add `accept_email`, `pick_display_name`, `accept_avatar`)
- Test: `backend/tests/test_userinfo.py` (add normalization cases)

**Interfaces:**
- Consumes: `UserinfoClaims`, `SYNTHETIC_EMAIL_DOMAIN`, `_MAX_AVATAR_LEN`, `urlparse`.
- Produces: `accept_email(claims, *, current: str) -> str`, `pick_display_name(claims, *, current: str, sub: str) -> str`, `accept_avatar(claims, *, current: str | None) -> str | None`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_userinfo.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_userinfo.py -k "accept_ or pick_" -v`
Expected: FAIL — helpers not defined.

- [ ] **Step 3: Implement the helpers**

Append to `backend/app/userinfo.py`:

```python
def accept_email(claims: UserinfoClaims, *, current: str) -> str:
    """Return the email to store: the userinfo email only if it is a valid, non-synthetic,
    non-unverified address; otherwise the existing value (never overwrite a real email with junk)."""
    email = (claims.email or "").strip()
    if not email:
        return current
    if claims.email_verified is False:
        return current
    if email.lower().endswith(SYNTHETIC_EMAIL_DOMAIN):
        return current
    if any(ch.isspace() for ch in email):
        return current
    local, sep, domain = email.partition("@")
    if not sep or not local or not domain or "@" in domain:
        return current
    return email


def pick_display_name(claims: UserinfoClaims, *, current: str, sub: str) -> str:
    for candidate in (claims.name, claims.username, current, sub):
        if candidate and candidate.strip():
            return candidate.strip()
    return sub


def accept_avatar(claims: UserinfoClaims, *, current: str | None) -> str | None:
    pic = (claims.picture or "").strip()
    if not pic or len(pic) > _MAX_AVATAR_LEN or any(ch.isspace() for ch in pic):
        return current
    parsed = urlparse(pic)
    if parsed.scheme != "https" or not parsed.netloc:
        return current
    return pic
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_userinfo.py -v`
Expected: PASS (all userinfo tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/userinfo.py backend/tests/test_userinfo.py
git commit -m "feat(backend): add profile normalization (email/name/avatar acceptance rules)"
```

---

## Task 3: Backend `POST /api/v1/me/sync` endpoint

**Files:**
- Modify: `backend/app/schemas.py` (add `SyncProfileRequest`)
- Modify: `backend/app/routers/users.py` (add the route)
- Test: `backend/tests/test_logto_auth.py` (integration, reusing the synthetic-bearer fixtures)
- Modify: `backend/tests/test_openapi.py`

**Interfaces:**
- Consumes: `get_current_user`, `get_session`, `User`, `MeResponse`, and from `app.userinfo`: `UserinfoError`, `UserinfoFetcher`, `get_userinfo_fetcher`, `accept_email`, `pick_display_name`, `accept_avatar`.
- Produces: `POST /api/v1/me/sync` → `MeResponse`.

**Test-design note:** these integration tests use the file's existing synthetic-bearer fixtures (`keypair`/`cache`/`_mint`) and override `get_jwks_cache`, so `get_current_user` runs for real and attaches `current_user` to the route's session (the mutation then persists — the detached `client` conftest fixture must NOT be used here). `_mint(priv)` defaults `sub="logto|abc"`, `email="u@example.com"`, `name="U"` — so a freshly provisioned row starts as `email="u@example.com"`, `display_name="U"`, `avatar_url=None`. Persistence is proven by a follow-up `GET /api/v1/me`.

- [ ] **Step 1: Write the failing integration tests**

At the top of `backend/tests/test_logto_auth.py`, add to the imports: `from app.userinfo import UserinfoClaims, get_userinfo_fetcher`. Then append:

```python
def _sync_overrides(cache, fetcher):
    from app.userinfo import get_userinfo_fetcher as _guf

    app.dependency_overrides[get_jwks_cache] = lambda: cache
    app.dependency_overrides[get_settings] = lambda: Settings(dev_auth_enabled=False)
    app.dependency_overrides[_guf] = lambda: fetcher


def _clear_sync_overrides():
    from app.userinfo import get_userinfo_fetcher as _guf

    for dep in (get_jwks_cache, get_settings, _guf):
        app.dependency_overrides.pop(dep, None)


async def test_me_sync_updates_profile_via_userinfo(keypair, cache, clean_db):
    priv, _ = keypair

    async def fetcher(token: str) -> UserinfoClaims:
        return UserinfoClaims(
            sub="logto|abc", email="real@gmail.com", email_verified=True,
            name="Real Name", picture="https://img.example/a.png",
        )

    _sync_overrides(cache, fetcher)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = {"Authorization": f"Bearer {_mint(priv)}"}
            resp = await ac.post("/api/v1/me/sync", json={"userinfo_token": "opaque"}, headers=headers)
            assert resp.status_code == 200
            body = resp.json()
            assert body["email"] == "real@gmail.com"
            assert body["display_name"] == "Real Name"
            assert body["avatar_url"] == "https://img.example/a.png"
            assert "logto_user_id" not in body
            me = await ac.get("/api/v1/me", headers=headers)  # persisted across requests
            assert me.json()["email"] == "real@gmail.com"
    finally:
        _clear_sync_overrides()


async def test_me_sync_sub_mismatch_is_403_and_no_change(keypair, cache, clean_db):
    priv, _ = keypair

    async def fetcher(token: str) -> UserinfoClaims:
        return UserinfoClaims(sub="logto|someone-else", email="evil@x.com", email_verified=True)

    _sync_overrides(cache, fetcher)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = {"Authorization": f"Bearer {_mint(priv)}"}
            before = (await ac.get("/api/v1/me", headers=headers)).json()["email"]
            resp = await ac.post("/api/v1/me/sync", json={"userinfo_token": "opaque"}, headers=headers)
            assert resp.status_code == 403
            after = (await ac.get("/api/v1/me", headers=headers)).json()["email"]
            assert after == before  # unchanged
    finally:
        _clear_sync_overrides()


async def test_me_sync_userinfo_failure_is_502_and_no_change(keypair, cache, clean_db):
    from app.userinfo import UserinfoError

    priv, _ = keypair

    async def fetcher(token: str) -> UserinfoClaims:
        raise UserinfoError("userinfo_status")

    _sync_overrides(cache, fetcher)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = {"Authorization": f"Bearer {_mint(priv)}"}
            before = (await ac.get("/api/v1/me", headers=headers)).json()["email"]
            resp = await ac.post("/api/v1/me/sync", json={"userinfo_token": "opaque"}, headers=headers)
            assert resp.status_code == 502
            after = (await ac.get("/api/v1/me", headers=headers)).json()["email"]
            assert after == before
    finally:
        _clear_sync_overrides()


async def test_me_sync_preserves_email_on_unverified_but_updates_name(keypair, cache, clean_db):
    priv, _ = keypair

    async def fetcher(token: str) -> UserinfoClaims:
        return UserinfoClaims(sub="logto|abc", email="evil@x.com", email_verified=False, name="New Name")

    _sync_overrides(cache, fetcher)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = {"Authorization": f"Bearer {_mint(priv)}"}
            before = (await ac.get("/api/v1/me", headers=headers)).json()["email"]  # u@example.com
            resp = await ac.post("/api/v1/me/sync", json={"userinfo_token": "opaque"}, headers=headers)
            assert resp.status_code == 200
            body = resp.json()
            assert body["email"] == before          # unverified email preserved
            assert body["display_name"] == "New Name"  # name still updated
    finally:
        _clear_sync_overrides()


async def test_me_sync_preserves_avatar_on_invalid_picture(keypair, cache, clean_db):
    priv, _ = keypair

    async def fetcher(token: str) -> UserinfoClaims:
        return UserinfoClaims(sub="logto|abc", picture="http://insecure/a.png")

    _sync_overrides(cache, fetcher)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = {"Authorization": f"Bearer {_mint(priv)}"}
            resp = await ac.post("/api/v1/me/sync", json={"userinfo_token": "opaque"}, headers=headers)
            assert resp.status_code == 200
            assert resp.json()["avatar_url"] is None  # non-https preserved (was None)
    finally:
        _clear_sync_overrides()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_logto_auth.py -k "me_sync" -v`
Expected: FAIL — `404` (route not defined) / import error.

- [ ] **Step 3: Add the request schema**

In `backend/app/schemas.py`, after `MeResponse`:

```python
class SyncProfileRequest(BaseModel):
    userinfo_token: str = Field(min_length=1)
```

- [ ] **Step 4: Add the endpoint**

In `backend/app/routers/users.py`, replace the file's imports/body to add the route (keep the existing `GET /me`):

```python
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import User
from app.schemas import MeResponse, SyncProfileRequest
from app.userinfo import (
    UserinfoError,
    UserinfoFetcher,
    accept_avatar,
    accept_email,
    get_userinfo_fetcher,
    pick_display_name,
)

logger = logging.getLogger("app.users")

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return current_user


@router.post("/me/sync", response_model=MeResponse)
async def sync_me(
    body: SyncProfileRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    fetch_userinfo: Annotated[UserinfoFetcher, Depends(get_userinfo_fetcher)],
) -> User:
    # Backend-authoritative: call Logto userinfo with the forwarded opaque token.
    try:
        claims = await fetch_userinfo(body.userinfo_token)
    except UserinfoError as exc:
        logger.warning("profile sync failed", extra={"reason": exc.reason})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="userinfo unavailable") from exc
    # Security: the userinfo subject MUST match the authenticated resource-JWT subject (no mutation before this).
    if claims.sub != current_user.logto_user_id:
        logger.warning("profile sync rejected", extra={"reason": "sub_mismatch"})
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="subject mismatch")
    current_user.email = accept_email(claims, current=current_user.email)
    current_user.display_name = pick_display_name(
        claims, current=current_user.display_name, sub=current_user.logto_user_id
    )
    current_user.avatar_url = accept_avatar(claims, current=current_user.avatar_url)
    await session.commit()
    await session.refresh(current_user)
    logger.info("profile synced", extra={"sub": current_user.logto_user_id})
    return current_user
```

- [ ] **Step 5: Extend the OpenAPI test**

In `backend/tests/test_openapi.py`, add:

```python
def test_openapi_exposes_me_sync_endpoint():
    schema = app.openapi()
    op = schema["paths"]["/api/v1/me/sync"]["post"]
    assert "SyncProfileRequest" in schema["components"]["schemas"]
    ref = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/MeResponse")
```

- [ ] **Step 6: Run the backend gate**

Run: `powershell.exe -NoProfile -File run.ps1 check -Backend`
Expected: PASS — the 5 new `me_sync` integration tests + `test_openapi` + all userinfo tests green; existing suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/tests/test_logto_auth.py backend/tests/test_openapi.py
git commit -m "feat(backend): add POST /api/v1/me/sync (userinfo profile sync + sub check)"
```

---

## Task 4: Web — request the profile scopes (`web/lib/logto.ts`)

**Files:**
- Modify: `web/lib/logto.ts`
- Test: `web/lib/logto.test.ts`

**Interfaces:**
- Produces: `getLogtoConfig().scopes` includes `"email"` and `"profile"`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("getLogtoConfig", ...)` block in `web/lib/logto.test.ts`:

```ts
  it("requests the email and profile scopes", () => {
    const cfg = getLogtoConfig({ ...base, NODE_ENV: "production" });
    expect(cfg.scopes).toContain("email");
    expect(cfg.scopes).toContain("profile");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/logto.test.ts`
Expected: FAIL — `cfg.scopes` is undefined.

- [ ] **Step 3: Add the scopes**

In `web/lib/logto.ts`, inside the object returned by `getLogtoConfig`, add the `scopes` line alongside `resources`:

```ts
    scopes: ["email", "profile"],
    resources: [API_RESOURCE],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run lib/logto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/logto.ts web/lib/logto.test.ts
git commit -m "feat(web): request email + profile scopes for userinfo"
```

---

## Task 5: Web — sync helper + `/account` wiring

**Files:**
- Create: `web/lib/server/sync.ts`
- Test: `web/lib/server/sync.test.ts`
- Modify: `web/app/account/page.tsx`

**Interfaces:**
- Consumes: `getAccessTokenRSC` (`@logto/next/server-actions`), `API_RESOURCE`/`getLogtoConfig` (`web/lib/logto.ts`), `resolveApiBaseUrl` (`web/lib/api.ts`), `log` (`web/lib/server/log.ts`).
- Produces: `syncProfile(requestId: string): Promise<void>` (never throws — best-effort).

- [ ] **Step 1: Write the failing test**

Create `web/lib/server/sync.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const { getAccessTokenRSC } = vi.hoisted(() => ({ getAccessTokenRSC: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getAccessTokenRSC }));

import { syncProfile } from "./sync";

const ENV = {
  LOGTO_ENDPOINT: "https://auth.fountainrank.com",
  LOGTO_APP_ID: "app123",
  LOGTO_APP_SECRET: "secret",
  LOGTO_BASE_URL: "https://fountainrank.com",
  LOGTO_COOKIE_SECRET: "x".repeat(32),
  NEXT_PUBLIC_API_BASE_URL: "https://api.fountainrank.com",
};

function stubEnv() {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("sync helper", () => {
  it("is guarded with server-only", () => {
    expect(readFileSync("lib/server/sync.ts", "utf8").trimStart()).toMatch(/^import "server-only"/);
  });

  it("POSTs the userinfo token to /api/v1/me/sync with the resource bearer", async () => {
    stubEnv();
    getAccessTokenRSC.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "resource-tok" : "opaque-tok",
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await syncProfile("rid-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fountainrank.com/api/v1/me/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resource-tok",
          "X-Request-ID": "rid-1",
        }),
        body: JSON.stringify({ userinfo_token: "opaque-tok" }),
      }),
    );
  });

  it("logs redacted warning on non-200 (no token in output)", async () => {
    stubEnv();
    getAccessTokenRSC.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "resource-tok" : "opaque-tok",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await syncProfile("rid-2");

    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("resource-tok");
    expect(out).not.toContain("opaque-tok");
  });

  it("swallows errors (best-effort, never throws; no token logged)", async () => {
    stubEnv();
    getAccessTokenRSC.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(syncProfile("rid-3")).resolves.toBeUndefined();
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("resource-tok");
    expect(out).not.toContain("opaque-tok");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/server/sync.test.ts`
Expected: FAIL — `./sync` not found.

- [ ] **Step 3: Implement the sync helper**

Create `web/lib/server/sync.ts`:

```ts
import "server-only";

import { getAccessTokenRSC } from "@logto/next/server-actions";

import { resolveApiBaseUrl } from "../api";
import { API_RESOURCE, getLogtoConfig } from "../logto";
import { log } from "./log";

// Best-effort profile sync from the /account RSC: forward the OPAQUE access token to the
// backend, which calls Logto userinfo. Never throws — a sync failure must not break /account.
// `server-only` guarantees the tokens cannot leak into a client bundle. Tokens are fetched
// sequentially (the SDK reads/refreshes session-cookie state).
export async function syncProfile(requestId: string): Promise<void> {
  try {
    const config = getLogtoConfig();
    const resourceToken = await getAccessTokenRSC(config, API_RESOURCE);
    const opaqueToken = await getAccessTokenRSC(config);
    const res = await fetch(`${resolveApiBaseUrl()}/api/v1/me/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resourceToken}`,
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
      },
      body: JSON.stringify({ userinfo_token: opaqueToken }),
    });
    if (res.ok) {
      log("debug", "profile synced", { requestId, status: res.status });
    } else {
      log("warn", "profile sync failed", { requestId, status: res.status });
    }
  } catch (err) {
    log("warn", "profile sync error", { requestId, reason: (err as Error).name });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run lib/server/sync.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into `/account`**

In `web/app/account/page.tsx`, add the import and call `syncProfile` right after the `requestId` is generated, before the existing `/api/v1/me` fetch:

```ts
import { syncProfile } from "../../lib/server/sync";
```

and (inside the authenticated branch, immediately after `const requestId = crypto.randomUUID();`):

```ts
  // Best-effort: refresh the stored profile from Logto before reading it (never throws).
  await syncProfile(requestId);
```

- [ ] **Step 6: Typecheck + build-safety**

Run: `pnpm --filter web exec tsc --noEmit` (expect clean), then with NO `LOGTO_*` set `pnpm exec turbo run build --filter=web` (expect success; `/account`+`/callback` still Dynamic). Restore build-mutated files: `git checkout -- web/next-env.d.ts web/tsconfig.json`.

- [ ] **Step 7: Commit**

```bash
git add web/lib/server/sync.ts web/lib/server/sync.test.ts web/app/account/page.tsx
git commit -m "feat(web): best-effort profile sync on /account load (server-only opaque-token forward)"
```

---

## Task 6: PRE-MERGE opaque-token probe (owner-assisted gate)

This is a **gate before opening the PR** — it proves the central assumption (the no-resource `getAccessTokenRSC` opaque token is accepted by Logto userinfo in our live setup). The code (Tasks 1–5) is done; now prove the path end-to-end against **live** Logto from the local stack. **If it fails, STOP** — do not open the PR; escalate to a Management-API follow-up spec (spec §8).

- [ ] **Step 1: Run the local stack against live Logto (owner-assisted)**

Bring up the DB + local backend (`run.ps1 up`, then run the backend locally so it reaches live Logto userinfo at `https://auth.fountainrank.com/oidc/me`). In a PowerShell session, with the real `LOGTO_*` exported and `NEXT_PUBLIC_API_BASE_URL` pointed at the local backend (or the prod backend `https://api.fountainrank.com`), run `pnpm --filter web dev` (port 3020). Sign in at `http://localhost:3020/account` (Google or email).

- [ ] **Step 2: Confirm + record the probe result**

Confirm: the backend log shows `POST /api/v1/me/sync 200` for the caller's `sub`, `/account` shows the **real** email/name/avatar, and the **browser network panel shows NO `Authorization`-bearing call to the API and no `userinfo_token` in any browser-visible payload**. Record the result in a handoff note (Logto endpoint, `@logto/next` version = `4.2.10`, observed `sub` match, userinfo `200`). **If userinfo rejects the no-resource token, STOP and escalate** (do not ship a workaround).

---

## Task 7: Full gate, PR, Codex Loop B, deploy

- [ ] **Step 1: Full local mirror**

Run: `powershell.exe -NoProfile -File run.ps1 check` (runs `generate` first, picking up `/api/v1/me/sync`). Fix any prettier finding (`pnpm exec prettier --write <file>`) and re-run. The only tolerated local skip is the known Windows `eslint-config-next` → `next/dist/compiled/babel/eslint-parser` resolution failure; everything else green, CI's `workspace-js` authoritative.

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin feat/user-profile-sync
gh pr create --base main --title "feat: user profile sync (real email/name/avatar via Logto userinfo)" --body-file <pr-body>
```

- [ ] **Step 3: CI green, then Codex Loop B**

Get CI green, then run the Codex PR review loop (`claude_help/codex-review-process.md`) until `VERDICT: APPROVED`; address every PR comment. Squash-merge when CI is green, Codex approved, and all comments addressed.

- [ ] **Step 4: Deploy + live verification**

After the owner-gated `v*.*.*` deploy, sign in at `https://fountainrank.com/account` and confirm the real email/name/avatar render and the backend log shows `POST /api/v1/me/sync 200` — the prod confirmation of the Task 6 probe.

---

## Self-Review

**Spec coverage:** §3.1 scopes → Task 4. §3.2 `/account` sync helper (server-only, `getAccessTokenRSC`, sequential) → Task 5. §3.3 endpoint (sub-check before mutation, normalization, commit/refresh) → Tasks 2+3. §3.5 config URI → Task 1. §4 error handling (502/403/timeout/no-redirect/streamed byte-cap) → Tasks 1+3. §5 testing (fetch, normalization guards, integration incl. row-unchanged, openapi, server-only, redaction, scopes) → Tasks 1–5. §6.1 pre-merge probe gate → Task 6. §6.3 browser-network proof → Task 6 Step 2. §8 contingency = escalate, not implement → Task 6. No gaps.

**Type consistency:** `UserinfoClaims`/`UserinfoError`/`fetch_userinfo`/`get_userinfo_fetcher`/`UserinfoFetcher` (Tasks 1,3), `accept_email`/`pick_display_name`/`accept_avatar` (Tasks 2,3), `SyncProfileRequest` ↔ `{ userinfo_token }` ↔ the web `body` (Tasks 3,5), `logto_userinfo_uri` (Tasks 1,3), `syncProfile(requestId)` via `getAccessTokenRSC` (Task 5) — all consistent. `_mint(priv)` defaults `sub="logto|abc"`, `email="u@example.com"`, `name="U"` — the integration tests assert against those exact provisioned values (capture-before/compare-after for unchanged cases).
