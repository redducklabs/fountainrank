# Kill "Anonymous" — name capture + display-name override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No public surface ever shows "Anonymous" for a signed-in account: capture a name on first sign-in (hard gate) and let users set/change a display name on web + mobile.

**Architecture:** Add a nullable `users.nickname` override column; resolve `nickname → display_name → "Anonymous"` in one backend helper used by every public surface and by a write-gate dependency. Expose `needs_name` on `GET /me` and a `PATCH /me` mutation. Web (server actions) and mobile (`useApi`) get a "Display name" field plus a required name-capture screen when `needs_name`.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + PostGIS (backend); Next.js App Router + server actions (web); Expo / React Native + React Query + openapi-fetch (mobile); shared `@fountainrank/api-client` (openapi-typescript).

## Global Constraints

- Spec: `docs/specs/2026-06-30-display-name-anonymous-design.md` — the source of truth.
- Conventional Commits; frequent commits; one PR across all surfaces; squash-merge.
- **No AI attribution** in commits/PRs; **no time estimates** anywhere.
- Windows host: file tools use **backslash** paths; the Bash tool is Git Bash (forward-slash, `/d/repos/fountainrank/...`).
- **Backend is fully CI-verifiable locally** with an isolated `UV_PROJECT_ENVIRONMENT`; PostGIS on `localhost:5436` via `docker compose -f docker/docker-compose.yml up -d db`.
- **Web/mobile: only pure-logic (vitest) + `tsc` + `prettier` run locally**; ESLint, `next build`, React render/mock tests, `expo-doctor`, and mobile device visuals are **CI/owner-verified** (memory `fountainrank-windows-wsl-local-check-workarounds`). Do not claim render tests pass locally.
- Validation for the name: trim; **min 1, max 80**; **≠ the Logto subject**; **not unique**. Never log the value.
- Backend write-gate rejection: HTTP **409** with `detail: "display_name_required"`.
- Never log secrets/PII/tokens; the chosen name is user-controlled text → never logged.
- `MeResponse.display_name` is `""` (never the raw Logto subject) when `needs_name` is true.
- **Command paths in this plan target the Windows Git Bash executor (this session): `/d/repos/...`.**
  Codex's WSL adapter sees the same files at `/mnt/d/repos/...`; translate if running there. All
  source paths are repo-relative regardless.

---

## File structure

**Backend (`backend/`)**
- `migrations/versions/0012_users_nickname.py` — new migration (add nullable `users.nickname`).
- `app/models.py` — add `User.nickname`.
- `app/display.py` — add `resolved_display_name`; extend `public_display_name` with `nickname`.
- `app/routers/leaderboard.py`, `app/routers/fountains.py`, `app/routers/admin.py` — pass `nickname` to `public_display_name`.
- `app/schemas.py` — `MeResponse` (resolved `display_name` + `needs_name`); new `UpdateMeRequest`; new `DisplayNameRequiredConflict`.
- `app/routers/users.py` — `me_response()` helper (`display_name = resolved or ""`); `PATCH /me`; use helper in `get_me`/`sync_me`.
- `app/auth.py` — `require_named_user` dependency.
- `app/routers/fountains.py` — swap the 5 write endpoints to `require_named_user` + document their 409 `responses`.
- `tests/test_display.py` (new), `tests/test_me.py`, `tests/test_gamification_api.py`, `tests/test_notes_api.py`, `tests/test_openapi.py`, `tests/test_add_fountain_conflict.py`, `tests/test_logto_auth.py` — tests.

**Shared client (`packages/api-client/`)**
- `openapi.json`, `src/schema.d.ts` — regenerated (PATCH /me, `needs_name`, the 409 conflict schema).

**Web (`web/`)**
- `app/actions/profile.ts` (new) + `app/actions/profile.test.ts` (new) — `setDisplayName`.
- `lib/display-name.ts` (new) + `lib/display-name.test.ts` (new) — pure validation/gate helpers.
- `app/actions/contribute.ts`, `lib/add-fountain.ts`, `app/actions/add-fountain.ts` (+ their tests) — map 409 `display_name_required` → `needs_name` (add-fountain branches on `detail` vs `fountain_id`).
- `components/account/DisplayNameForm.tsx` (new), `app/account/page.tsx` — field + gate.
- `lib/server/viewer.ts` (+ `viewer.test.ts`), `components/AuthControl.tsx`, `app/callback/route.ts` — viewer/header never expose the subject; sign-in callback routes to the gate (Task 10b).
- `components/map/AddFountainPanel.tsx` + rating/note UIs — surface the `needs_name` prompt.

**Mobile (`mobile/`)**
- `lib/auth/display-name.ts` (new) + `lib/auth/display-name.test.ts` (new) — pure validation/gate helpers.
- `lib/auth/profile.ts` — `needs_name` is part of `MeProfile` (regenerated type).
- `app/(tabs)/account.tsx` + `components/account/DisplayNameForm.tsx` (new) — field + capture gate.
- `lib/add-fountain/state.ts` (+ test), `app/(tabs)/index.tsx`, `components/add-fountain/AddFountainForm.tsx` — add-fountain 409 classify + route (the real add POST is `(tabs)/index.tsx`, **not** `(tabs)/add.tsx`).
- `lib/contributions/state.ts` (+ test), `app/fountains/[id].tsx` — detail-write 409 → `needs_name` route.

**Docs**
- `docs/style-guide.md` — name-capture screen + Display name field.

---

## Phase A — Backend (TDD, locally CI-verifiable)

### Task 1: `users.nickname` column + migration 0012

**Files:**
- Modify: `backend/app/models.py` (User)
- Create: `backend/migrations/versions/0012_users_nickname.py`

**Interfaces:**
- Produces: `User.nickname: str | None` column; DB column `users.nickname` (nullable text).

- [ ] **Step 1: Add the column to the model.** In `backend/app/models.py`, in `class User`, after the `avatar_url` line, add:

```python
    nickname: Mapped[str | None] = mapped_column(String, nullable=True)
```

- [ ] **Step 2: Write the migration.** Create `backend/migrations/versions/0012_users_nickname.py`:

```python
"""users.nickname (user-set display-name override) — kill "Anonymous"

Adds a nullable ``users.nickname``. When set it overrides the IdP-synced
``display_name`` on every public surface (leaderboard, notes); the synced
``display_name`` is kept intact as the fallback. No index (never queried by
nickname) and no CHECK (length/shape validated in the app, mirroring
``display_name``). No backfill.

Revision ID: 0012_users_nickname
Revises: 0011_fountains_geometry_gist
Create Date: 2026-06-30
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_users_nickname"
down_revision = "0011_fountains_geometry_gist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("nickname", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "nickname")
```

- [ ] **Step 3: Apply + verify no drift.** Run (Git Bash, isolated env per the memory):

```bash
cd /d/repos/fountainrank/backend && uv run alembic upgrade head && uv run alembic check
```

Expected: `upgrade` runs `0012`; `alembic check` reports **no new upgrade operations** (model + migration agree).

- [ ] **Step 4: Commit.**

```bash
git add backend/app/models.py backend/migrations/versions/0012_users_nickname.py
git commit -m "feat(backend): add nullable users.nickname column (#103 / kill Anonymous)"
```

---

### Task 2: name resolution + public masking (`display.py`)

**Files:**
- Modify: `backend/app/display.py`
- Create: `backend/tests/test_display.py`

**Interfaces:**
- Produces:
  - `resolved_display_name(display_name: str, logto_user_id: str, nickname: str | None = None) -> str | None` — public-safe name, or `None` when the account resolves to Anonymous.
  - `public_display_name(display_name: str, logto_user_id: str, nickname: str | None = None) -> str` — the above, or `"Anonymous"`.

- [ ] **Step 1: Write failing tests.** Create `backend/tests/test_display.py`:

```python
from app.display import ANONYMOUS_DISPLAY_NAME, public_display_name, resolved_display_name

SUB = "4zsznfwtd8cx"


def test_resolved_prefers_nickname():
    assert resolved_display_name(display_name="Real Name", logto_user_id=SUB, nickname="Nick") == "Nick"


def test_resolved_falls_back_to_display_name():
    assert resolved_display_name(display_name="Real Name", logto_user_id=SUB, nickname=None) == "Real Name"
    assert resolved_display_name(display_name="Real Name", logto_user_id=SUB, nickname="   ") == "Real Name"


def test_resolved_none_when_anonymous():
    # display_name fell back to the subject and no nickname -> Anonymous (None).
    assert resolved_display_name(display_name=SUB, logto_user_id=SUB, nickname=None) is None
    assert resolved_display_name(display_name=SUB, logto_user_id=SUB, nickname="") is None


def test_resolved_nickname_rescues_anonymous():
    assert resolved_display_name(display_name=SUB, logto_user_id=SUB, nickname="Nick") == "Nick"


def test_public_masks_to_anonymous():
    assert public_display_name(SUB, SUB, None) == ANONYMOUS_DISPLAY_NAME
    assert public_display_name("Real Name", SUB, None) == "Real Name"
    assert public_display_name(SUB, SUB, "Nick") == "Nick"
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_display.py -v
```

Expected: FAIL (`resolved_display_name` not defined).

- [ ] **Step 3: Implement.** Replace the body of `backend/app/display.py` below the module docstring with:

```python
ANONYMOUS_DISPLAY_NAME = "Anonymous"


def resolved_display_name(
    display_name: str, logto_user_id: str, nickname: str | None = None
) -> str | None:
    """The public-safe author name, or None when the account still resolves to the raw
    Logto subject (i.e. would show "Anonymous"). Resolution order: nickname (when set and
    non-blank) → IdP display_name → None. A set nickname is validated to never equal the
    subject, so it can never mask."""
    name = (nickname or "").strip() or display_name
    return None if name == logto_user_id else name


def public_display_name(
    display_name: str, logto_user_id: str, nickname: str | None = None
) -> str:
    """Return a public-safe author name — never the raw Logto subject. Masks to a generic
    label when the account has no real name (no nickname and display_name fell back to the
    subject)."""
    return resolved_display_name(display_name, logto_user_id, nickname) or ANONYMOUS_DISPLAY_NAME
```

- [ ] **Step 4: Run to verify pass.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_display.py -v
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add backend/app/display.py backend/tests/test_display.py
git commit -m "feat(backend): resolved_display_name + nickname-aware public_display_name"
```

---

### Task 3: wire nickname into the public callers

**Files:**
- Modify: `backend/app/routers/leaderboard.py` (`_global_board`, `_local_board`)
- Modify: `backend/app/routers/fountains.py` (`submit_note`, `list_notes`)
- Modify: `backend/app/routers/admin.py` (`_serialize_admin_note`)
- Modify: `backend/tests/test_gamification_api.py`, `backend/tests/test_notes_api.py`

**Interfaces:**
- Consumes: `public_display_name(display_name, logto_user_id, nickname)` (Task 2).

- [ ] **Step 1: Leaderboard — add `User.nickname` to both selects.** In `backend/app/routers/leaderboard.py`:
  - `_global_board`: add `User.nickname,` to the `select(...)` column list (after `User.logto_user_id,`), and change the row build to `display_name=public_display_name(r.display_name, r.logto_user_id, r.nickname)`.
  - `_local_board`: add `User.nickname,` to `select_cols` (after `User.logto_user_id,`), and change the row build to `display_name=public_display_name(r.display_name, r.logto_user_id, r.nickname)`.

- [ ] **Step 2: Notes — pass nickname.** In `backend/app/routers/fountains.py`:
  - `submit_note` return: `author_display_name=public_display_name(user.display_name, user.logto_user_id, user.nickname)`.
  - `list_notes` select: add `User.nickname,` (after `User.logto_user_id,`); return build: `author_display_name=public_display_name(r.display_name, r.logto_user_id, r.nickname)`.

- [ ] **Step 3: Admin note — pass nickname.** In `backend/app/routers/admin.py`, `_serialize_admin_note`: `author_display_name=public_display_name(author.display_name, author.logto_user_id, author.nickname)`.

- [ ] **Step 4: Add a regression test (notes show nickname).** Append to `backend/tests/test_notes_api.py` (uses the existing `client`/`test_user`/`session` fixtures — adapt to the file's helpers for creating a fountain + note):

```python
async def test_note_author_uses_nickname(client, test_user, session):
    # Set a nickname; the note author name must reflect it (override the IdP display_name).
    test_user.nickname = "Fountain Fan"
    await session.commit()
    fountain_id = await _create_fountain(client)  # reuse the file's existing fountain helper
    await client.post(f"/api/v1/fountains/{fountain_id}/notes", json={"body": "Cold and clean"})
    resp = await client.get(f"/api/v1/fountains/{fountain_id}/notes")
    assert resp.status_code == 200
    assert resp.json()[0]["author_display_name"] == "Fountain Fan"
```

> If `test_notes_api.py` has no reusable fountain-create helper, inline the existing add-fountain POST the other tests in that file use (match their pattern exactly).

- [ ] **Step 5: Add a leaderboard nickname test.** In `backend/tests/test_gamification_api.py`, find the test(s) asserting a leaderboard row's `display_name`; add a case that sets `user.nickname` and asserts the row's `display_name` equals the nickname (match the file's fixture/seed pattern for creating a ranked contributor).

- [ ] **Step 6: Run the affected tests.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_notes_api.py tests/test_gamification_api.py -v
```

Expected: PASS (including the two new cases).

- [ ] **Step 7: Commit.**

```bash
git add backend/app/routers/leaderboard.py backend/app/routers/fountains.py backend/app/routers/admin.py backend/tests/test_notes_api.py backend/tests/test_gamification_api.py
git commit -m "feat(backend): public surfaces resolve user nickname over IdP name"
```

---

### Task 4: `MeResponse` resolved name + `needs_name`

**Files:**
- Modify: `backend/app/schemas.py` (`MeResponse`)
- Modify: `backend/app/routers/users.py` (`me_response` helper; `get_me`, `sync_me`)
- Modify: `backend/tests/test_me.py`

**Interfaces:**
- Produces:
  - `MeResponse` fields: `id`, `display_name` (resolved), `email`, `avatar_url`, `is_admin`, `created_at`, **`needs_name: bool`**.
  - `me_response(user: User) -> MeResponse` in `app/routers/users.py`.

- [ ] **Step 1: Write failing tests.** Append to `backend/tests/test_me.py`:

```python
async def test_me_includes_needs_name_false_for_named(client, test_user):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 200
    assert resp.json()["needs_name"] is False  # "Dev One" != subject


async def test_me_needs_name_true_when_anonymous(client, test_user, session):
    # display_name fell back to the subject and no nickname -> needs_name; the subject must NOT leak.
    test_user.display_name = test_user.logto_user_id
    test_user.nickname = None
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["needs_name"] is True
    assert body["display_name"] == ""  # never the raw Logto subject
    assert test_user.logto_user_id not in str(body)  # belt-and-suspenders: subject nowhere in /me


async def test_me_display_name_prefers_nickname(client, test_user, session):
    test_user.nickname = "Nick"
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["display_name"] == "Nick"
    assert body["needs_name"] is False
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_me.py -v
```

Expected: FAIL (`needs_name` missing).

- [ ] **Step 3: Add the schema field.** In `backend/app/schemas.py`, `MeResponse`, add after `created_at`:

```python
    needs_name: bool = False
```

(Keep `model_config = ConfigDict(from_attributes=True)`; the helper constructs it explicitly.)

- [ ] **Step 4: Add the helper + use it.** In `backend/app/routers/users.py`:
  - Add import: `from app.display import resolved_display_name`.
  - Add near the top (after `router = ...`):

```python
def me_response(user: User) -> MeResponse:
    """Self-view profile: display_name is the resolved name (nickname → IdP name); needs_name
    is True when the account still resolves to "Anonymous" (drives the client name-capture gate)."""
    resolved = resolved_display_name(user.display_name, user.logto_user_id, user.nickname)
    return MeResponse(
        id=user.id,
        # "" (never the raw subject) when the account resolves to Anonymous — the client pre-fill in
        # that state is blank, and the subject must never reach the client (data-exposure rule).
        display_name=resolved or "",
        email=user.email,
        avatar_url=user.avatar_url,
        is_admin=user.is_admin,
        created_at=user.created_at,
        needs_name=resolved is None,
    )
```

  - `get_me`: `return me_response(current_user)`.
  - `sync_me`: change the final `return current_user` to `return me_response(current_user)`.

- [ ] **Step 5: Run to verify pass.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_me.py -v
```

Expected: PASS (existing + 3 new). The pre-existing `test_me_returns_profile` still passes (`display_name == "Dev One"`, `needs_name` absent from its assertions).

- [ ] **Step 6: Regression-test the real Logto path + /me/sync (no subject leak).** In `backend/tests/test_logto_auth.py` (which already exercises the real bearer path and `/me/sync`), add assertions that:
  - a `/me` (or `/me/sync`) response for a token carrying **no** `name`/`username` has `needs_name is True` and `display_name == ""` (the subject must not appear anywhere in the body — `assert sub not in str(body)`);
  - after a `/me/sync` that resolves a real name (existing test), `needs_name is False` and `display_name` equals that name.
  Match the file's existing fixtures/fake-userinfo helpers — do not invent new auth scaffolding. Run:

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_logto_auth.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/tests/test_me.py backend/tests/test_logto_auth.py
git commit -m "feat(backend): /me returns resolved display_name + needs_name"
```

---

### Task 5: `PATCH /me` mutation

**Files:**
- Modify: `backend/app/schemas.py` (`UpdateMeRequest`)
- Modify: `backend/app/routers/users.py` (`update_me`)
- Modify: `backend/tests/test_me.py`, `backend/tests/test_openapi.py`

**Interfaces:**
- Produces: `PATCH /api/v1/me` accepting `{ "display_name": str }` → stores to `nickname`, returns `MeResponse`.
  - `UpdateMeRequest { display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] }`.

- [ ] **Step 1: Write failing tests.** Append to `backend/tests/test_me.py`:

```python
async def test_patch_me_sets_display_name(client, test_user, session):
    resp = await client.patch("/api/v1/me", json={"display_name": "  Aron  "})
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Aron"  # trimmed
    assert body["needs_name"] is False
    await session.refresh(test_user)
    assert test_user.nickname == "Aron"
    assert test_user.display_name == "Dev One"  # IdP name preserved


async def test_patch_me_rejects_blank(client):
    assert (await client.patch("/api/v1/me", json={"display_name": "   "})).status_code == 422


async def test_patch_me_rejects_too_long(client):
    assert (await client.patch("/api/v1/me", json={"display_name": "x" * 81})).status_code == 422


async def test_patch_me_rejects_value_equal_to_subject(client, test_user):
    resp = await client.patch("/api/v1/me", json={"display_name": test_user.logto_user_id})
    assert resp.status_code == 422


async def test_patch_me_requires_auth():
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.patch("/api/v1/me", json={"display_name": "Aron"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_me.py -k patch_me -v
```

Expected: FAIL (405/404 — no PATCH route).

- [ ] **Step 3: Add the request schema.** In `backend/app/schemas.py` (near `SyncProfileRequest`):

```python
class UpdateMeRequest(BaseModel):
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]
```

- [ ] **Step 4: Add the endpoint.** In `backend/app/routers/users.py`:
  - Import `UpdateMeRequest` in the `from app.schemas import (...)` block.
  - Add after `get_me`:

```python
@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MeResponse:
    # The user-set display name is stored in `nickname` (the IdP `display_name` stays intact as
    # fallback). Reject a value equal to the subject — it would re-mask to "Anonymous".
    if body.display_name == current_user.logto_user_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid display name")
    current_user.nickname = body.display_name
    await session.commit()
    await session.refresh(current_user)
    logger.info("display name set", extra={"user_id": str(current_user.id)})  # never the value
    return me_response(current_user)
```

- [ ] **Step 5: Run to verify pass.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_me.py -v
```

Expected: PASS (all `patch_me` cases + earlier tests).

- [ ] **Step 6: Add the OpenAPI assertion.** In `backend/tests/test_openapi.py`, mirror the existing `/me/sync` check with one asserting `schema["paths"]["/api/v1/me"]["patch"]` exists and its request body references `UpdateMeRequest` (match the file's existing assertion style). Run:

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_openapi.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add backend/app/schemas.py backend/app/routers/users.py backend/tests/test_me.py backend/tests/test_openapi.py
git commit -m "feat(backend): PATCH /me to set display name (nickname override)"
```

---

### Task 6: `require_named_user` write-gate

**Files:**
- Modify: `backend/app/auth.py` (`require_named_user`)
- Modify: `backend/app/schemas.py` (`DisplayNameRequiredConflict`)
- Modify: `backend/app/routers/fountains.py` (5 write endpoints + their `responses={409: …}`)
- Create: `backend/tests/test_name_gate.py`
- Modify: `backend/tests/test_add_fountain_conflict.py`, `backend/tests/test_openapi.py`

**Interfaces:**
- Produces:
  - `require_named_user(user: User = Depends(get_current_user)) -> User` — 409 `display_name_required` when the user resolves to Anonymous, else the user.
  - `DisplayNameRequiredConflict { detail: Literal["display_name_required"] }` — the documented 409 body for all five gated endpoints.

- [ ] **Step 1: Write failing test.** Create `backend/tests/test_name_gate.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import get_current_user
from app.main import app
from app.models import User


async def _add_fountain_via(ac) -> str:
    resp = await ac.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 37.0, "longitude": -122.0}, "is_working": True},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_anonymous_user_blocked_from_contributing(clean_db, session):
    # A user whose display_name fell back to the subject and who has no nickname is "Anonymous".
    anon = User(logto_user_id="anon-sub-1", email="anon@x", display_name="anon-sub-1", nickname=None)
    session.add(anon)
    await session.commit()
    await session.refresh(anon)

    async def override() -> User:
        return anon

    app.dependency_overrides[get_current_user] = override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # A write (note needs a fountain; add_fountain itself is gated, so assert on it directly).
            resp = await ac.post(
                "/api/v1/fountains",
                json={"location": {"latitude": 1.0, "longitude": 1.0}, "is_working": True},
            )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "display_name_required"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_named_user_can_contribute(client):
    # The default `client` fixture user ("Dev One") is named -> add succeeds.
    fountain_id = await _add_fountain_via(client)
    assert fountain_id
```

- [ ] **Step 2: Run to verify failure.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_name_gate.py -v
```

Expected: `test_anonymous_user_blocked...` FAILS (gets 201, not 409) since the gate doesn't exist yet; `test_named_user_can_contribute` PASSES.

- [ ] **Step 3: Add the dependency.** In `backend/app/auth.py`:
  - Add import: `from app.display import resolved_display_name`.
  - Add after `require_admin`:

```python
async def require_named_user(user: User = Depends(get_current_user)) -> User:
    """Gate contribution-write endpoints: a user whose name resolves to "Anonymous" (no nickname
    and display_name == subject) must set a display name first (#103 / kill Anonymous). Reads,
    GET/PATCH /me, and admin endpoints are intentionally NOT gated."""
    if resolved_display_name(user.display_name, user.logto_user_id, user.nickname) is None:
        logger.warning("contribution blocked: no display name", extra={"user_id": str(user.id)})
        raise HTTPException(status.HTTP_409_CONFLICT, detail="display_name_required")
    return user
```

- [ ] **Step 4: Add the documented 409 conflict schema.** In `backend/app/schemas.py`, near `DuplicateFountainConflict`, add:

```python
class DisplayNameRequiredConflict(BaseModel):
    detail: Literal["display_name_required"] = "display_name_required"
```

(`Literal` is already imported in `schemas.py`.)

- [ ] **Step 5: Apply the gate + document the 409 on the 5 write endpoints.** In `backend/app/routers/fountains.py`:
  - Add `require_named_user` to the `from app.auth import (...)` line; add `DisplayNameRequiredConflict` to the `from app.schemas import (...)` line.
  - Change `user: User = Depends(get_current_user)` → `user: User = Depends(require_named_user)` in `add_fountain`, `submit_ratings`, `submit_attributes`, `submit_condition`, `submit_note`.
  - **Document the 409 so the OpenAPI/client don't lie:**
    - `add_fountain`'s decorator already has `responses={status.HTTP_409_CONFLICT: {"model": DuplicateFountainConflict}}`. Change it to a union so both 409 shapes are typed:

```python
    responses={
        status.HTTP_409_CONFLICT: {"model": DuplicateFountainConflict | DisplayNameRequiredConflict}
    },
```

    - `submit_ratings`, `submit_attributes`, `submit_condition`, `submit_note` have no `responses=`; add one to each decorator:

```python
@router.post(
    "/fountains/{fountain_id}/ratings",
    response_model=FountainDetail,
    responses={status.HTTP_409_CONFLICT: {"model": DisplayNameRequiredConflict}},
)
```

  (Apply the same `responses=` to the attributes/conditions/notes decorators, keeping each existing `response_model`.)

- [ ] **Step 6: Update the contract tests.**
  - `backend/tests/test_add_fountain_conflict.py`: assert the OpenAPI 409 for `POST /api/v1/fountains` now references **both** `DuplicateFountainConflict` and `DisplayNameRequiredConflict` (an `anyOf`/`oneOf` of the two component schemas). Match the file's existing assertion style.
  - `backend/tests/test_openapi.py`: assert a gated endpoint (e.g. `/api/v1/fountains/{fountain_id}/notes` `post`) documents a 409 with `DisplayNameRequiredConflict`.

- [ ] **Step 7: Run to verify pass.**

```bash
cd /d/repos/fountainrank/backend && uv run pytest tests/test_name_gate.py tests/test_add_fountain_conflict.py tests/test_openapi.py -v
```

Expected: PASS.

- [ ] **Step 8: Guard against regressions in existing write tests.** The existing fountains/ratings/notes/conditions/attributes API tests authenticate as the named `test_user` ("Dev One"), so they remain unaffected. Run the broad suite:

```bash
cd /d/repos/fountainrank/backend && uv run pytest -q
```

Expected: all green.

- [ ] **Step 9: Commit.**

```bash
git add backend/app/auth.py backend/app/schemas.py backend/app/routers/fountains.py backend/tests/test_name_gate.py backend/tests/test_add_fountain_conflict.py backend/tests/test_openapi.py
git commit -m "feat(backend): gate contribution writes behind require_named_user (409 display_name_required)"
```

---

### Task 7: regenerate the shared api-client

**Files:**
- Modify: `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`

- [ ] **Step 1: Export the OpenAPI doc + regenerate types** (per the env memory):

```bash
cd /d/repos/fountainrank/backend && uv run python -m app.export_openapi ../packages/api-client/openapi.json
cd /d/repos/fountainrank && node node_modules/openapi-typescript/bin/cli.js packages/api-client/openapi.json -o packages/api-client/src/schema.d.ts
```

- [ ] **Step 2: Sanity-check the diff** — `MeResponse` gains `needs_name`; a `patch` operation appears under `/api/v1/me` with an `UpdateMeRequest` body:

```bash
git -C /d/repos/fountainrank diff --stat packages/api-client && grep -n "needs_name" packages/api-client/src/schema.d.ts | head
```

Expected: `needs_name` present; `/api/v1/me` has a `patch`.

- [ ] **Step 3: Format + commit.**

```bash
cd /d/repos/fountainrank && node node_modules/prettier/bin/prettier.cjs --write packages/api-client/src/schema.d.ts packages/api-client/openapi.json
git add packages/api-client/openapi.json packages/api-client/src/schema.d.ts
git commit -m "chore(api-client): regenerate types for PATCH /me + needs_name"
```

---

## Phase B — Web (pure-logic local; render/build CI-verified)

### Task 8: `setDisplayName` server action + pure helpers

**Files:**
- Create: `web/lib/display-name.ts`, `web/lib/display-name.test.ts`
- Create: `web/app/actions/profile.ts`, `web/app/actions/profile.test.ts`

**Interfaces:**
- Produces:
  - `validateDisplayName(raw: string): { ok: true; value: string } | { ok: false }` (trim; 1..80).
  - `setDisplayName(name: string): Promise<SetNameResult>` where `SetNameResult = { ok: true } | { ok: false; error: "unauthenticated" | "validation" | "server" }`.

- [ ] **Step 1: Write the pure-helper test.** Create `web/lib/display-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateDisplayName } from "./display-name";

describe("validateDisplayName", () => {
  it("trims and accepts", () => {
    expect(validateDisplayName("  Aron  ")).toEqual({ ok: true, value: "Aron" });
  });
  it("rejects blank", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: false });
  });
  it("rejects > 80 chars", () => {
    expect(validateDisplayName("x".repeat(81))).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Implement the helper.** Create `web/lib/display-name.ts`:

```ts
export const DISPLAY_NAME_MAX = 80;

export function validateDisplayName(raw: string): { ok: true; value: string } | { ok: false } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 1 || value.length > DISPLAY_NAME_MAX) return { ok: false };
  return { ok: true, value };
}
```

- [ ] **Step 3: Run the pure test** (vitest direct, per env memory):

```bash
cd /d/repos/fountainrank/web && node node_modules/vitest/vitest.mjs run lib/display-name.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write the action test.** Create `web/app/actions/profile.test.ts`, mirroring `web/app/actions/contribute.test.ts` (mock `../../lib/server/api`'s `getAuthedApiClientForAction` to return a fake client whose `PATCH` resolves `{ response: { status } }`). Cover: 200 → `{ ok: true }`; 422 → `validation`; 401 → `unauthenticated`; client-construct throw → `unauthenticated`; PATCH throw → `server`; local blank/too-long → `validation` without calling the client.

- [ ] **Step 5: Implement the action.** Create `web/app/actions/profile.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";
import { validateDisplayName } from "../../lib/display-name";

export type SetNameError = "unauthenticated" | "validation" | "server";
export type SetNameResult = { ok: true } | { ok: false; error: SetNameError };

export async function setDisplayName(name: string): Promise<SetNameResult> {
  const v = validateDisplayName(name);
  if (!v.ok) return { ok: false, error: "validation" };
  const requestId = crypto.randomUUID();
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "set-name auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  try {
    const { response } = await client.PATCH("/api/v1/me", { body: { display_name: v.value } });
    const status = response?.status ?? 0;
    if (status >= 200 && status < 300) {
      revalidatePath("/account");
      revalidatePath("/leaderboard");
      log("info", "set-name", { requestId, status });
      return { ok: true };
    }
    if (status === 401) return { ok: false, error: "unauthenticated" };
    if (status === 422) return { ok: false, error: "validation" };
    log("warn", "set-name failed", { requestId, status });
    return { ok: false, error: "server" };
  } catch (err) {
    log("warn", "set-name error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "server" };
  }
}
```

- [ ] **Step 6: Run the action test.**

```bash
cd /d/repos/fountainrank/web && node node_modules/vitest/vitest.mjs run app/actions/profile.test.ts
```

Expected: PASS.

- [ ] **Step 7: Type-check + format + commit.**

```bash
cd /d/repos/fountainrank/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/prettier/bin/prettier.cjs --write lib/display-name.ts lib/display-name.test.ts app/actions/profile.ts app/actions/profile.test.ts
git add web/lib/display-name.ts web/lib/display-name.test.ts web/app/actions/profile.ts web/app/actions/profile.test.ts
git commit -m "feat(web): setDisplayName server action + validation helper"
```

---

### Task 9: surface the write-gate (409 → needs_name) in web contributions

**Files:**
- Modify: `web/app/actions/contribute.ts`, `web/app/actions/contribute.test.ts`
- Modify: `web/lib/add-fountain.ts`, `web/app/actions/add-fountain.ts`, `web/app/actions/add-fountain.test.ts`

**Interfaces:**
- `ContributeError` gains `"needs_name"`; `AddFountainResult` error union gains `"needs_name"`.

- [ ] **Step 1: contribute.ts — map 409.** Add `"needs_name"` to the `ContributeError` union, and in `mapStatus` add (before the final `return fail("server")`):

```ts
  if (status === 409) return fail("needs_name");
```

(The rating/condition/note/attribute endpoints have no other 409, so this is unambiguous.) Add a `contribute.test.ts` case: a 409 response → `{ ok: false, error: "needs_name" }`.

- [ ] **Step 2: add-fountain — disambiguate 409.** In `web/lib/add-fountain.ts`, add `"needs_name"` to the `AddFountainResult` error union. In `web/app/actions/add-fountain.ts`, replace the `if (status === 409) { ... }` block with:

```ts
    if (status === 409) {
      const body = error as
        | components["schemas"]["DuplicateFountainConflict"]
        | { detail?: string }
        | undefined;
      const dup = body as components["schemas"]["DuplicateFountainConflict"] | undefined;
      if (dup && isUuid(dup.fountain_id)) {
        log("info", "add-fountain", { requestId, outcome: "duplicate", status });
        return { ok: false, error: "duplicate", fountainId: dup.fountain_id };
      }
      if ((body as { detail?: string })?.detail === "display_name_required") {
        log("info", "add-fountain", { requestId, outcome: "needs_name", status });
        return { ok: false, error: "needs_name" };
      }
      log("warn", "add-fountain", { requestId, outcome: "malformed-409", status });
      return { ok: false, error: "server" };
    }
```

Add an `add-fountain.test.ts` case: 409 with body `{ detail: "display_name_required" }` → `{ ok: false, error: "needs_name" }`; the existing duplicate-409 case still returns `duplicate`.

- [ ] **Step 3: UI surfacing.** In the components consuming these actions (`web/components/map/AddFountainPanel.tsx` and the rating/note UIs that call `contribute.ts`), add a branch for `error === "needs_name"` that shows a short prompt — "Add a display name to contribute" — linking to `/account`. (Render: CI/owner-verified; keep copy in the component, no new UI primitive — reuse existing message styling.)

- [ ] **Step 4: Run web pure/action tests + tsc.**

```bash
cd /d/repos/fountainrank/web && node node_modules/vitest/vitest.mjs run app/actions/contribute.test.ts app/actions/add-fountain.test.ts && node node_modules/typescript/bin/tsc --noEmit
```

Expected: PASS / no type errors.

- [ ] **Step 5: Format + commit.**

```bash
cd /d/repos/fountainrank/web && node node_modules/prettier/bin/prettier.cjs --write app/actions/contribute.ts app/actions/contribute.test.ts lib/add-fountain.ts app/actions/add-fountain.ts app/actions/add-fountain.test.ts components/map/AddFountainPanel.tsx
git add web/app/actions/contribute.ts web/app/actions/contribute.test.ts web/lib/add-fountain.ts web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts web/components/map/AddFountainPanel.tsx
git commit -m "feat(web): surface display_name_required (409) as a set-name prompt"
```

---

### Task 10: Display name field + first-sign-in gate on `/account`

**Files:**
- Create: `web/components/account/DisplayNameForm.tsx`
- Modify: `web/app/account/page.tsx`

**Interfaces:**
- Consumes: `setDisplayName` (Task 8); `profile.needs_name`, `profile.display_name` from `GET /me`.

> Render + build are **CI-verified** (memory). Keep logic minimal; reuse the page's existing
> Tailwind tokens (`shell`, `bg-white/10`, etc.). Document the new elements in the style guide (Task 13).

- [ ] **Step 1: Build the form (client component).** Create `web/components/account/DisplayNameForm.tsx`: a `"use client"` component with props `{ initialValue: string; required: boolean }`. It renders a labeled "Display name" `<input>` (default value `initialValue`, `maxLength={80}`), a Save button, and a status line. On submit it calls `setDisplayName(value)` (imported from `../../app/actions/profile`); on `{ ok: true }` it `router.refresh()`; on `validation`/`server`/`unauthenticated` it shows the matching message. When `required`, render a heading ("Choose a display name to continue") and omit any dismiss affordance.

- [ ] **Step 2: Wire the gate into the page.** In `web/app/account/page.tsx`, in the signed-in branch (after `profile` is loaded):
  - If `profile.needs_name`: render **only** `<DisplayNameForm initialValue="" required />` (plus header + sign-out), as the gate — do not show the normal account body.
  - Else: render the normal account body **and** `<DisplayNameForm initialValue={profile.display_name} required={false} />` so a named user can change it.
  - `MeResponse` now includes `needs_name` (regenerated type), so `profile` is typed accordingly.

- [ ] **Step 3: Type-check + format.**

```bash
cd /d/repos/fountainrank/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/prettier/bin/prettier.cjs --write components/account/DisplayNameForm.tsx app/account/page.tsx
```

Expected: no type errors.

- [ ] **Step 4: Commit.**

```bash
git add web/components/account/DisplayNameForm.tsx web/app/account/page.tsx
git commit -m "feat(web): display-name field + first-sign-in name-capture gate on /account"
```

> Render/interaction (form submit, gate hiding the account body) is verified in CI + by the owner in the browser — see the PR checklist (Task 14).

---

### Task 10b: Web viewer/header never leak the subject + sign-in callback gate

**Files:**
- Modify: `web/lib/server/viewer.ts`, `web/lib/server/viewer.test.ts`
- Modify: `web/components/AuthControl.tsx`
- Modify: `web/app/callback/route.ts`

**Interfaces:**
- `Viewer` authed state gains `needsName: boolean`.

> Why: `getViewer()` feeds `SiteHeader`/`AuthControl` on **every** page. Without this, a signed-in
> Anonymous-name account would render whatever `/me` sends. The backend now returns `display_name=""`
> when `needs_name` (Task 4), so the subject can't leak; this task additionally surfaces the gate in
> the header and forces the capture screen right after sign-in.

- [ ] **Step 1: `getViewer` carries `needsName`.** In `web/lib/server/viewer.ts`, add `needsName: boolean` to the authed `Viewer` variant and set it from `data.needs_name` in the `if (data)` branch (keep `displayName: data.display_name`, which is now `""` when `needs_name`).

- [ ] **Step 2: Test no-leak.** In `web/lib/server/viewer.test.ts`, add a case: a `/me` mock with `needs_name: true, display_name: ""` → `getViewer` returns `state: "authed", needsName: true, displayName: ""` and the result JSON contains no subject. Run:

```bash
cd /d/repos/fountainrank/web && node node_modules/vitest/vitest.mjs run lib/server/viewer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Header prompt.** In `web/components/AuthControl.tsx`, when `viewer.state === "authed" && viewer.needsName`, render a small "Finish setup — set your name" link to `/account` (reuse the existing button/menu styling). The `UserMenu` already falls back to initial `"?"` when `name` is empty, so an empty name renders no subject.

- [ ] **Step 4: Sign-in callback forces capture.** In `web/app/callback/route.ts`, after `syncProfileForRoute(requestId)` and before computing the return redirect, fetch the viewer (`getViewer(requestId)`); when `state === "authed" && needsName`, `redirect("/account")` (the gate) instead of the stored return path. Keep the existing return-path logic for the named case. Never log the name.

- [ ] **Step 5: Type-check + format + commit.**

```bash
cd /d/repos/fountainrank/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/prettier/bin/prettier.cjs --write lib/server/viewer.ts lib/server/viewer.test.ts components/AuthControl.tsx app/callback/route.ts
git add web/lib/server/viewer.ts web/lib/server/viewer.test.ts web/components/AuthControl.tsx web/app/callback/route.ts
git commit -m "feat(web): viewer/header hide subject + sign-in callback routes to name gate"
```

> Header render + the post-sign-in redirect are CI-/owner-verified in the browser (Task 14 checklist).

---

## Phase C — Mobile (type-check/lint CI; device visual owner-verified)

### Task 11: Display name field + capture gate on the account tab

**Files:**
- Create: `mobile/lib/auth/display-name.ts`, `mobile/lib/auth/display-name.test.ts`
- Create: `mobile/components/account/DisplayNameForm.tsx`
- Modify: `mobile/app/(tabs)/account.tsx`

**Interfaces:**
- Produces: `validateDisplayName(raw: string)` (same contract as web). `MeProfile` now has `needs_name`.

- [ ] **Step 1: Pure helper + test.** Create `mobile/lib/auth/display-name.ts` (identical contract to `web/lib/display-name.ts`) and `mobile/lib/auth/display-name.test.ts` (trim/blank/too-long). Run:

```bash
cd /d/repos/fountainrank/mobile && node node_modules/vitest/vitest.mjs run lib/auth/display-name.test.ts
```

Expected: PASS.

- [ ] **Step 2: Build the form component.** Create `mobile/components/account/DisplayNameForm.tsx`: props `{ initialValue: string; required: boolean; onSaved: () => void }`. A `TextInput` (maxLength 80), Save `Pressable`, status `Text`. On save: validate locally, then `await client.PATCH("/api/v1/me", { body: { display_name: value } })` via `useApi()`, `unwrap` it, then `queryClient.invalidateQueries({ queryKey: ["me"] })` and call `onSaved`. Reuse the screen's existing `styles`/`theme` tokens (no new primitives). Map a thrown `apiErrorStatus === 422` to an inline "Please enter 1–80 characters."

- [ ] **Step 3: Gate the account tab.** In `mobile/app/(tabs)/account.tsx`, `SignedInProfile`: when `profile.needs_name` is true, render **only** the `DisplayNameForm` (`required`, heading "Choose a display name to continue") instead of the normal profile body. When false, render the normal body plus an "Edit display name" affordance that shows the form (`required={false}`). The `["me"]` invalidation already drives a refetch so `needs_name` flips after save.

- [ ] **Step 4: Type-check.**

```bash
cd /d/repos/fountainrank/mobile && node node_modules/typescript/bin/tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 5: Format + commit.**

```bash
cd /d/repos/fountainrank/mobile && node node_modules/prettier/bin/prettier.cjs --write lib/auth/display-name.ts lib/auth/display-name.test.ts components/account/DisplayNameForm.tsx "app/(tabs)/account.tsx"
git add mobile/lib/auth/display-name.ts mobile/lib/auth/display-name.test.ts mobile/components/account/DisplayNameForm.tsx "mobile/app/(tabs)/account.tsx"
git commit -m "feat(mobile): display-name field + first-sign-in capture gate on account tab"
```

> The screen render, the gate, and sign-in→capture flow are **owner device-verified** (memory `fountainrank-verify-code-before-implementing-open-issue`): the PR ships them; the owner confirms on-device.

---

### Task 12: surface the write-gate (409) on mobile contributions

**Files (correct targets — `(tabs)/add.tsx` is only a `<Redirect href="/" />`; the real add POST lives in `(tabs)/index.tsx`):**
- Modify: `mobile/lib/add-fountain/state.ts`, `mobile/lib/add-fountain/state.test.ts` (add-fountain 409 classification + error text)
- Modify: `mobile/app/(tabs)/index.tsx` (add mutation 409 branch + add-mode `needs_name` guard)
- Modify: `mobile/components/add-fountain/AddFountainForm.tsx` (route to account on `needs_name`)
- Modify: `mobile/lib/contributions/state.ts`, `mobile/lib/contributions/state.test.ts` (detail-write 409 → `needs_name`)
- Modify: `mobile/app/fountains/[id].tsx` (route to account on `needs_name`)

**Why no `unwrap`/`ApiError` change:** the four detail writes have **only** the gate 409 (unambiguous → status alone suffices, even though `unwrap` drops the body). `POST /fountains` has two 409 shapes, but its mutation in `(tabs)/index.tsx` reads the openapi-fetch `result.error` body directly, so it can branch on `detail`.

**Interfaces:**
- `AddFountainError` gains `"needs_name"`. `classifyAddConflict(errorBody): { kind: "needs_name" } | { kind: "duplicate"; fountainId: string } | { kind: "server" }` (pure, in `state.ts`).
- `ContributionError` gains `"needs_name"`.

- [ ] **Step 1: Add-fountain — pure 409 classifier (TDD).** In `mobile/lib/add-fountain/state.test.ts` add:

```ts
it("classifies a display_name_required 409 body", () => {
  expect(classifyAddConflict({ detail: "display_name_required" })).toEqual({ kind: "needs_name" });
});
it("classifies a duplicate 409 body", () => {
  expect(classifyAddConflict({ fountain_id: UUID })).toEqual({ kind: "duplicate", fountainId: UUID });
});
it("classifies an unrecognized 409 body as server", () => {
  expect(classifyAddConflict({})).toEqual({ kind: "server" });
});
```

  Then in `mobile/lib/add-fountain/state.ts`: add `"needs_name"` to `AddFountainError`; add a `case "needs_name": return "Add a display name on the Account tab to contribute.";` to `addFountainErrorText`; and implement:

```ts
export function classifyAddConflict(
  errorBody: unknown,
): { kind: "needs_name" } | { kind: "duplicate"; fountainId: string } | { kind: "server" } {
  if ((errorBody as { detail?: unknown })?.detail === "display_name_required") {
    return { kind: "needs_name" };
  }
  const fountainId = duplicateFountainId(errorBody as DuplicateConflict | undefined);
  return fountainId ? { kind: "duplicate", fountainId } : { kind: "server" };
}
```

  Run: `cd /d/repos/fountainrank/mobile && node node_modules/vitest/vitest.mjs run lib/add-fountain/state.test.ts` → PASS.

- [ ] **Step 2: Wire the classifier into the add mutation.** In `mobile/app/(tabs)/index.tsx`, replace the `if (result.response.status === 409) { ... }` body of `addMutation.mutationFn` to use `classifyAddConflict(result.error)`: `needs_name` → `{ ok: false, error: "needs_name" }`; `duplicate` → `{ ok: false, error: "duplicate", fountainId }`; `server` → `{ ok: false, error: "server" }`. (`AddFountainResult` already allows `{ ok: false; error: AddFountainError }`, and `"needs_name"` is now in `AddFountainError`.)

- [ ] **Step 3: Add-mode entry guard + form routing.** In `mobile/app/(tabs)/index.tsx`, when the `["me"]` profile has `needs_name` (the screen already has a `client.GET("/api/v1/me/contributions")` query — add or reuse a `/me` read for `needs_name`), block entering add mode and show "Set a display name on the Account tab first" with a tap that routes to `/account`. In `mobile/components/add-fountain/AddFountainForm.tsx`, when a submit returns `error === "needs_name"`, route to the account tab (add an `onNeedsName` prop or `router.navigate("/account")`) instead of the generic error toast.

- [ ] **Step 4: Detail writes — pure 409 → needs_name (TDD).** In `mobile/lib/contributions/state.ts`: add `"needs_name"` to `ContributionError` and map a 409 to it in the existing error mapper (read the file for the mapper's real name — it is consumed via `handleMutationError` in `mobile/app/fountains/[id].tsx`). Add a test in `mobile/lib/contributions/state.test.ts`:

```ts
it("maps a 409 to needs_name", () => {
  expect(mapContributionError(new ApiError(409))).toBe("needs_name"); // use the real mapper name
});
```

  Run the file via vitest → PASS.

- [ ] **Step 5: Route detail writes to the account tab.** In `mobile/app/fountains/[id].tsx`, where a write outcome is `needs_name`, show "Add a display name on the Account tab to contribute" and route to `/account` (reuse the existing toast/message + an `expo-router` navigate). Keep all other error handling unchanged.

- [ ] **Step 6: Type-check + format + commit.**

```bash
cd /d/repos/fountainrank/mobile && node node_modules/typescript/bin/tsc --noEmit && node node_modules/prettier/bin/prettier.cjs --write lib/add-fountain/state.ts lib/add-fountain/state.test.ts "app/(tabs)/index.tsx" components/add-fountain/AddFountainForm.tsx lib/contributions/state.ts lib/contributions/state.test.ts "app/fountains/[id].tsx"
git add mobile/lib/add-fountain/state.ts mobile/lib/add-fountain/state.test.ts "mobile/app/(tabs)/index.tsx" mobile/components/add-fountain/AddFountainForm.tsx mobile/lib/contributions/state.ts mobile/lib/contributions/state.test.ts "mobile/app/fountains/[id].tsx"
git commit -m "feat(mobile): route to account when a contribution is blocked (display_name_required)"
```

> The routing + add-mode guard render are **owner device-verified**; the pure classifiers/mappers are unit-tested locally.

---

## Phase D — Docs + integration

### Task 13: Style guide

**Files:**
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Document the new UI elements.** Add entries for (a) the **Display name field** (label, input, Save, status/validation states: default, saving, error) and (b) the **first-sign-in name-capture screen / gate** (required variant: heading, no dismiss; reachable from web `/account` and the mobile account tab). Include purpose, structure, states, and accessibility (label association, button disabled/pending state), matching the file's existing entry format.

- [ ] **Step 2: Commit.**

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): display-name field + name-capture gate"
```

---

### Task 14: Full local CI mirror + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Backend full CI mirror** (the source of truth that runs green locally):

```bash
cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest -q
```

Expected: all green.

- [ ] **Step 2: Web local checks (what runs here):**

```bash
cd /d/repos/fountainrank/web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/prettier/bin/prettier.cjs --check .
```

Expected: clean. (ESLint + `next build` + render tests run in CI.)

- [ ] **Step 3: Mobile local checks:**

```bash
cd /d/repos/fountainrank/mobile && node node_modules/typescript/bin/tsc --noEmit && node node_modules/prettier/bin/prettier.cjs --check .
```

Expected: clean. (`expo-doctor` + render run in CI.)

- [ ] **Step 4: Push the branch + open the PR** (see CLAUDE.md / `claude_help/github-cli.md`). PR body must include: a summary, the link to the spec + plan, the #103 relationship (see spec §11), and an **owner verification checklist**:
  - **Web (browser):** sign in as an account with a real IdP name → no gate, name shows; the existing `4zsznfwtd8cx`-style account (or a name-less test account) → after sign-in you land on the `/account` name gate, the header never shows a raw id, setting a name reflects on `/leaderboard` and notes; a contribution attempt while name-less prompts to set a name.
  - **Mobile (device):** Apple sign-in with no name → account tab shows the required capture screen; setting a name unblocks add/rate and shows on the leaderboard; attempting add/rate while name-less routes to the Account tab.

  Then run the Codex PR review loop and address CI + every PR comment until `VERDICT: APPROVED` and green.

---

## Self-review (plan vs. spec)

- **Spec §5 (column/migration)** → Task 1. **§6 (resolution/masking + callers)** → Tasks 2–3. **§7 (gate + OpenAPI 409 contract)** → Task 6 (backend dependency + `DisplayNameRequiredConflict` + 409 docs) + Tasks 9/10b/12 (client surfacing). **§8 (PATCH /me + conflict schema)** → Tasks 5–6. **§9 (MeResponse, `display_name=""` when `needs_name`)** → Task 4. **§10.1 (web UI + viewer/header/callback gate)** → Tasks 10 + 10b. **§10.2 (mobile UI + gate)** → Tasks 11–12. **§10.3 (style guide)** → Task 13. **§11 (#103)** → Task 14 PR body. **§12 (validation, max 80)** → Tasks 5/8/11. **§14 (tests, incl. no-subject-leak on the Logto path + 409 contract)** → Tasks 2–6, 8–12. **§15 (logging)** → Tasks 5–6. **§16 (delivery)** → Tasks 7, 14. **§17 (acceptance)** → Task 14 checklist.
- **Type consistency:** `resolved_display_name`/`public_display_name(…, nickname)` identical across Tasks 2/3/4/6. `me_response` returns `display_name = resolved or ""` (Task 4). `needs_name` (snake_case) on the wire; web/mobile read `profile.needs_name`; web `Viewer.needsName` (camelCase) is internal (Task 10b). `setDisplayName`/`SetNameResult` consistent (Tasks 8/10). `"needs_name"` variant added to web `ContributeError` + `AddFountainResult` error union (Task 9) and mobile `AddFountainError` + `ContributionError` (Task 12); `classifyAddConflict` is the single add-fountain 409 brancher.
- **Blocker fixes from Codex review-1 folded in:** no raw-subject leak (Task 4 `""` + Task 10b viewer/header + Logto-path test in Task 6/4); app-wide first-sign-in gate (web callback Task 10b, mobile account tab + add guard Tasks 11–12); mobile 409 without `unwrap` surgery (unambiguous detail 409 + add-body branch, Task 12); correct mobile file targets (`(tabs)/index.tsx`, not `add.tsx`, Task 12); OpenAPI 409 truthful (Task 6).
- **Placeholders:** backend steps carry full code; client render tasks specify code + contract with render/route verification deferred to CI/owner per the env constraint (called out explicitly).
