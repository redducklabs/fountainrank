# Kill "Anonymous" — first-sign-in name capture + display-name override — design

**Status:** approved design (owner-approved 2026-06-30), pending Codex spec/plan review.
**Driver:** owner directive (handoff `handoffs/2026-06-29-leaderboard-shipped-handoff.md`, §"NEXT
SESSION") — the live leaderboard showed an **"Anonymous"** row for a real signed-in account.
**Issues:** folds in [#103](https://github.com/redducklabs/fountainrank/issues/103) (mobile
Apple/SSO shows an opaque id) — see §11 for disposition.

---

## 1. Goal

No public surface (leaderboard, notes) ever shows **"Anonymous"** for an account that has signed in
and used the app. Concretely:

1. **Capture a name on first sign-in.** When a signed-in account would still resolve to "Anonymous"
   (the IdP supplied no usable name and the user has set no name), the app **requires** the user to
   set a name before they can contribute — on **web and mobile**.
2. **Let users set/change their display name.** A single "Display name" field on the account screen
   (web and mobile) lets a user set or change the name shown publicly, overriding the IdP-provided
   name.

## 2. Why the IdP-name path alone is insufficient (root cause)

The "Anonymous" row on the live board is subject `4zsznfwtd8cx` (issue #103's exact id) — one real
account (1 fountain + 4 ratings, created 2026-06-30), almost certainly the owner's own mobile
Apple/SSO sign-in. It renders "Anonymous" because `public_display_name`
(`backend/app/display.py`) masks the raw subject when `display_name == logto_user_id`, which happens
when provisioning fell back to the subject (`backend/app/auth.py` —
`display_name = claims.get("name") or claims.get("username") or sub`).

**The masking is correct.** The real defect is that the account has no real name and **never can get
one from the IdP**: per #103, *"Apple returns the name only once, at first authorization … never in
the per-request resource JWT."* If that first capture is missed, Apple will not re-send the name, and
private-relay emails are synthetic — so re-signing-in cannot recover it. Therefore the app must be
able to **ask the user directly** and let them **set their own name**. The `/me/sync` path (#103)
handles "use the IdP name when it exists"; this directive adds "ask when it doesn't" + "let users
override".

## 3. What already exists (no rework)

- **`public_display_name(display_name, logto_user_id)`** (`backend/app/display.py`) masks the raw
  subject → "Anonymous". Callers: leaderboard `_global_board` + `_local_board`
  (`backend/app/routers/leaderboard.py`), notes add + list (`backend/app/routers/fountains.py`),
  admin note out (`backend/app/routers/admin.py`).
- **`User`** model (`backend/app/models.py`): `display_name` (NOT NULL), `email` (NOT NULL),
  `avatar_url` (nullable). Provisioned by `get_or_create_user`.
- **`GET /api/v1/me`** → `MeResponse { id, display_name, email, avatar_url, is_admin, created_at }`
  (`backend/app/routers/users.py`, `backend/app/schemas.py`). `POST /api/v1/me/sync` refreshes
  name/email/avatar from Logto userinfo.
- **Mobile `/me/sync` + scopes already coded** (commit `7ebb3ed`): `mobile/lib/auth/config.ts`
  requests `scopes: ["email","profile"]`; `mobile/lib/auth/sync.ts` `syncProfileOnSignIn` POSTs
  `/me/sync` on sign-in (wired in `mobile/providers/auth-provider.tsx`). **The IdP-name-when-present
  path is done.** #103 remains open only for physical-device verification of that slice (§11).
- **Web** calls `syncProfile` from `/account` already (`web/lib/server/sync.ts`).
- **Contribution-write endpoints** (all `Depends(get_current_user)`, in
  `backend/app/routers/fountains.py`): `POST /fountains` (add), `POST /fountains/{id}/ratings`,
  `POST /fountains/{id}/attributes`, `POST /fountains/{id}/conditions` (covers verify-working),
  `POST /fountains/{id}/notes`. These are the exact endpoints the §7 gate wraps.

## 4. Owner-approved decisions

1. **Hard gate.** When a signed-in account resolves to "Anonymous", the user **must** set a name
   before contributing. Public browsing and sign-out still work; reads and the name-setting endpoint
   are never gated.
2. **Single "Display name" field.** One editable field on the account screen (web + mobile),
   pre-filled with the current name (the IdP name if present, else blank), saved to a new nullable
   `users.nickname` column. Users never see two name concepts; the IdP-synced `display_name` is kept
   intact underneath as the fallback.
3. **One PR across all surfaces** (backend + web + mobile), like the #117 leaderboard, then one
   web+backend deploy and one mobile store release.

## 5. Data model

Add a **nullable** column `users.nickname` (`String`, no DB CHECK — mirrors `display_name`, which is
app-validated, not DB-constrained; no index — never queried by nickname).

- **Migration:** next sequential Alembic revision; `op.add_column("users", sa.Column("nickname",
  sa.String(), nullable=True))` + downgrade `drop_column`. Model gains
  `nickname: Mapped[str | None] = mapped_column(String, nullable=True)`. Must keep `alembic check`
  parity (no autogen drift) and `alembic upgrade head` green in CI.
- **No backfill.** Existing rows get `nickname = NULL`. The `4zsznfwtd8cx` account is fixed the
  moment the owner sets a name post-deploy (§12) — no hand DB mutation.

## 6. Name resolution + public masking (`backend/app/display.py`)

Single source of truth, used by both the public surfaces and the §7 gate:

```python
def resolved_display_name(display_name, logto_user_id, nickname=None) -> str | None:
    """The public-safe name, or None when the account still resolves to Anonymous."""
    name = (nickname or "").strip() or display_name
    return None if name == logto_user_id else name

def public_display_name(display_name, logto_user_id, nickname=None) -> str:
    return resolved_display_name(display_name, logto_user_id, nickname) or ANONYMOUS_DISPLAY_NAME
```

Resolution order: **nickname → IdP display_name → "Anonymous"**, masking only when the resolved value
still equals the raw subject. All callers pass the user's `nickname`:

- `leaderboard.py`: add `User.nickname` to the `_global_board` and `_local_board` selects; pass to
  `public_display_name(r.display_name, r.logto_user_id, r.nickname)`.
- `fountains.py`: add-note response uses `user.nickname`; list-notes select adds `User.nickname`,
  passes `r.nickname`.
- `admin.py`: admin-note out passes `author.nickname`.

`nickname` is validated at write (§8) to never equal the subject, so a set nickname can never mask.

## 7. Hard gate — defense in depth

**Backend is the enforcement backstop (guarantees the acceptance criterion regardless of client
version).** A new dependency in `backend/app/auth.py`:

```python
async def require_named_user(user: User = Depends(get_current_user)) -> User:
    if resolved_display_name(user.display_name, user.logto_user_id, user.nickname) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="display_name_required")
    return user
```

Swap `Depends(get_current_user)` → `Depends(require_named_user)` on the **five contribution-write
endpoints** in §3. Reads, `GET /me`, `POST /me/sync`, `PATCH /me`, and admin/moderation endpoints
are **not** gated (an admin setting a name is itself a `PATCH /me`, which must stay open). Log the
rejection (`user_id` only) so a gated write is diagnosable.

**Clients are the primary UX:**
- After sign-in, fetch `/me`; when `needs_name` is true, route to a **required** name-capture screen
  (cannot be dismissed back into the authed surface without setting a name; sign-out is the only
  escape). Public browsing remains available. See §10 for the per-surface gate points (web sign-in
  callback + header; mobile account tab + add-mode gate).
- Also catch a `409 display_name_required` from any write and route to the same screen (covers a
  race where state changed mid-session).

**OpenAPI contract (the 409 must not lie).** Add a `DisplayNameRequiredConflict { detail:
Literal["display_name_required"] }` schema and document it on all five gated endpoints'
`responses={409: …}`. `POST /fountains` already documents a 409 `DuplicateFountainConflict`; its 409
becomes a **union** of the two shapes (both are reachable: the gate dependency runs before the
duplicate check), so the regenerated client types both and the clients disambiguate by `detail`
vs `fountain_id`. The other four endpoints document 409 = `DisplayNameRequiredConflict` only.

**Client 409 handling — no `unwrap`/`ApiError` surgery needed.** The four detail writes
(ratings/conditions/attributes/notes) have **only** the gate 409, so a bare status 409 →
`needs_name` (the body is not needed; mobile's `unwrap` discarding it is fine here). `POST /fountains`
has two 409 shapes, but the mobile add mutation (`(tabs)/index.tsx`) and the web add action both read
the typed openapi-fetch `error` body directly, so they branch on `detail === "display_name_required"`
vs a valid `fountain_id` there.

## 8. Mutation endpoint — `PATCH /api/v1/me` (`backend/app/routers/users.py`)

- **Request** `UpdateMeRequest { display_name: str }` — the API speaks "display_name"; it is stored
  in the `nickname` column (preserving the IdP `display_name` as fallback). Validation via pydantic
  `StringConstraints(strip_whitespace=True, min_length=1, max_length=80)`. (80, not a tighter limit,
  so the account screen can pre-fill and re-save an existing long IdP name unchanged.)
- **Extra validation in the handler:** reject (`422`) a value equal to `current_user.logto_user_id`
  (would re-mask to Anonymous). **Not unique** — display names are not unique in this app (two
  Google users can share "John Smith"); a uniqueness check would create confusing failures.
- Writes `current_user.nickname = value`, commits, returns the updated `MeResponse` (§9).
- **Structured log:** `logger.info("display name set", extra={"user_id": str(current_user.id)})` —
  **never** the value (treat as user-controlled PII).
- **v1 is set/change only — no "clear back to IdP name."** YAGNI, and clearing would reopen the
  Anonymous hole for accounts whose IdP name is the subject. Documented out of scope (§13).
- **Conflict schema:** add `DisplayNameRequiredConflict { detail: Literal["display_name_required"] }`
  to `schemas.py`; wire it into the five gated endpoints' `responses={409: …}` (§7) so the OpenAPI /
  generated client reflect the real 409 body.

## 9. Self-view `MeResponse` (`backend/app/schemas.py`)

- `display_name` becomes the **resolved** self-view name: the nickname when set, else the IdP
  `display_name`. **When the account resolves to Anonymous (`needs_name` true), `display_name` is the
  empty string `""` — never the raw Logto subject.** The subject is an internal identity key that
  must never reach the client (a data-exposure rule); the only client use of `display_name` in the
  Anonymous state is a blank field pre-fill, so `""` is exactly right. Otherwise it is a
  backward-compatible improvement: existing clients reading `display_name` pick up a set nickname
  automatically. Concretely the helper returns `resolved or ""` (not `resolved or user.display_name`).
- Add **`needs_name: bool`** =
  `resolved_display_name(display_name, logto_user_id, nickname) is None` — drives the §7 client gate
  and the field pre-fill (pre-fill = current `display_name` when `needs_name` is false, else blank).
- **`email` must not leak the subject either.** Provisioning stores a synthetic
  `f"{sub}@users.noreply.fountainrank.com"` when the token carries no email (`auth.py`), so the raw
  subject is embedded in `User.email`. `me_response` returns `email = ""` when the stored email ends
  with the synthetic domain (`SYNTHETIC_EMAIL_DOMAIN` from `app/userinfo.py`); a real email passes
  through unchanged. The DB keeps the NOT-NULL synthetic value (storage is unaffected). Clients
  already hide synthetic emails (`isDisplayableEmail`/`displayEmail`), so `""` renders the same — but
  the subject no longer crosses the wire.
- `MeResponse` is built via one small helper (`me_response(user)`) reused by `get_me`, `sync_me`, and
  the new `PATCH /me`, so the three stay consistent.
- **Tests assert** `/me` and `/me/sync` never return the raw subject **anywhere** in the body —
  `display_name` is `""` when `needs_name` and `email` is `""` for the synthetic fallback — including
  the real Logto-JWT path with a token carrying no `name`/`username` **and** no `email` (and a
  separate real-email token still passes its email through).

## 10. Client UI

### 10.1 Web (`web/`)
The gate is enforced at three points so a nameless user is captured immediately and the raw subject
never surfaces:
1. **Sign-in callback** (`web/app/callback/route.ts`): after `syncProfileForRoute`, fetch `/me`; when
   `needs_name`, redirect to the capture surface (`/account`) instead of the stored return path —
   this is the "first-sign-in prompt". The gate lands on `/account`; once named the user continues
   from there (we do **not** thread the original return path through the gate — YAGNI).
2. **Header / viewer** (`web/lib/server/viewer.ts`, `web/components/AuthControl.tsx`): the `Viewer`
   type gains `needsName: boolean`; `getViewer` reads it from `/me`. Because the API now sends
   `display_name = ""` when `needs_name`, the header can never render the subject; additionally, when
   `needsName`, `AuthControl` shows a "Finish setup — set your name" link to `/account` (defense +
   persistent prompt). `viewer.test.ts` gains a case proving no subject leaks.
3. **`/account`** (`web/app/account/page.tsx`): when `needs_name`, render **only** the required
   `DisplayNameForm` (blank, no dismiss) as the gate; otherwise render the account body plus the form
   pre-filled for changing the name. The form calls the `setDisplayName` server action (→ `PATCH /me`).
- Contribution server actions already 409-gate (§7) and surface a "set a display name" prompt linking
  to `/account` (covers a write attempt by a nameless user).

### 10.2 Mobile (`mobile/`)
Sign-in can start from the **account tab** *or* the **map add button** (`(tabs)/index.tsx` calls
`auth.signIn()` from the add gate), so the first-sign-in capture cannot live only on the account tab.
- **Root gate** (`mobile/app/(tabs)/_layout.tsx`): a small mounted effect/component reads the `["me"]`
  query; when `auth.status === "authenticated"` **and** `me.needs_name` **and** the user is not already
  on the account route, it `router.navigate("/account")`. This catches sign-in from any surface. The
  decision is a pure helper (`shouldRouteToNameGate(status, needsName, onAccountRoute)`), unit-tested.
- **Account tab** (`mobile/app/(tabs)/account.tsx`): when `needs_name`, render **only** the required
  `DisplayNameForm` (no dismiss) as the gate; otherwise show the profile plus an "edit display name"
  affordance. The form calls `PATCH /me` via the authed `useApi` client and invalidates `["me"]`.
- **Add-fountain** (active inline `MapAddPanel` in `mobile/app/(tabs)/index.tsx`, **not** the dead
  `components/add-fountain/AddFountainForm.tsx`): the add mutation's 409 branch classifies the body
  (`classifyAddConflict`) → `needs_name`; the panel's `onSubmit` result handler routes to the account
  tab on `needs_name`. Entering add-mode while `needs_name` shows "Set a display name first".
- **Detail writes** (`mobile/app/fountains/[id].tsx` + `mobile/lib/contributions/state.ts`): map a 409
  on rate/condition/attribute/note (unambiguous → gate) to a `needs_name` outcome that routes to the
  account tab.
- Small pure helpers (`mobile/lib/auth/display-name.ts` for validation; `shouldRouteToNameGate`;
  `classifyAddConflict`; the contribution-error mapper) hold the logic so it is unit-tested without
  rendering.

### 10.3 Style guide
Document the **name-capture screen** and the **"Display name" form field** (states: default, saving,
error, validation message) in `docs/style-guide.md` before/with the UI work.

## 11. #103 disposition

#103's mobile-sync slice (scopes + `/me/sync`) is **already coded** (`7ebb3ed`) and stays open only
for **physical-iPhone verification** of the Apple-name-when-present case. This PR does **not**
re-implement it. The PR description links #103 and notes that this directive supersedes #103's
broader intent (the Anonymous fix); #103 stays open for its device-verification checkbox, or the
owner may close it as folded-in once this ships and is device-verified together.

## 12. Validation rules (summary)

| Field | Rule |
|---|---|
| `display_name` (→ `nickname`) | trim; **min 1**, **max 80** chars after trim; **≠ subject**; not unique |
| Empty / whitespace-only | `422` (pydantic min_length on the trimmed value) |
| Equals `logto_user_id` | `422` (handler check — would re-mask) |
| Logging | `user_id` only, never the value |

## 13. Out of scope (YAGNI)

- Clearing the nickname back to the IdP name (§8).
- Nickname uniqueness, profanity/moderation filtering, history/audit of name changes.
- Avatar editing; email editing.
- Surfacing category boards or time-window leaderboards (separate, already out of scope for #117).

## 14. Testing

**Backend (fully CI-verifiable locally per the env note):**
- `display.py`: `resolved_display_name` / `public_display_name` with nickname set / blank /
  whitespace / equal-to-subject; "Anonymous" only when both empty and `display_name == subject`.
- `PATCH /me`: happy path (sets nickname, `/me` reflects it, `needs_name` flips false); validation
  matrix (empty, whitespace, **>80**, equal-to-subject); auth required (401 unauth).
- `require_named_user`: a representative write (e.g. `POST /fountains/{id}/notes`) returns
  `409 display_name_required` for an Anonymous user and succeeds after a name is set; a named user is
  unaffected.
- `/me` `needs_name` true/false; **`display_name == "" when needs_name` (no subject leak)**, including
  the real Logto-JWT path (`test_logto_auth.py`) where the token carries no `name`/`username`.
- `/me/sync`: still returns a nickname-resolved response (extend `test_logto_auth.py`).
- leaderboard + notes show the nickname once set (masking interaction).
- OpenAPI: `PATCH /me` present with `UpdateMeRequest`; `POST /fountains` 409 documents both
  `DuplicateFountainConflict` and `DisplayNameRequiredConflict`; the four other gated endpoints
  document the 409 conflict schema (extend `test_openapi.py` + `test_add_fountain_conflict.py`).

**Web / mobile (pure-logic local; render/route CI-/owner-verified):**
- Pure helpers unit-tested locally: name validation (trim/1..80), the gate decision (`needs_name` →
  capture), web `setDisplayName` action status mapping, web `getViewer` never exposing a subject when
  `needs_name`, mobile add/detail 409 → `needs_name` error mapping (`add-fountain/state.ts`,
  `contributions/state.ts`).
- Render/route/gate-integration tests are CI-only per the env note. Regenerate the api-client
  (`export_openapi` → `openapi-typescript`) so `PATCH /me`, `needs_name`, and the 409 conflict schema
  are typed.

## 15. Logging & observability

- `PATCH /me`: info on success (`user_id` only).
- `require_named_user`: info/warning on a gated rejection (`user_id` only) so the gate is visible in
  logs.
- No new secrets/PII in logs; the chosen name is user-controlled text → never logged.

## 16. Delivery / process

One branch → PR (backend + web + mobile + migration + spec/plan + style-guide). Codex spec/plan
review before code, Codex PR review before merge (bypass mode, WSL `cwd`
`/mnt/d/repos/fountainrank`, repo-relative paths, loop to `VERDICT: APPROVED`). CI green + every PR
comment addressed → **squash-merge**. Then `gh workflow run deploy.yml --ref main` (web+backend) and
`gh workflow run mobile-store-release.yml --ref main -f platform=all` (mobile). No AI attribution, no
time estimates.

## 17. Acceptance criteria

- No public surface (leaderboard, notes) shows "Anonymous" for an account that has signed in and used
  the app.
- A first-time signed-in user whose name resolves to Anonymous is required to set a name before they
  can contribute (web + mobile); a contribution-write by such a user is rejected by the backend with
  `409 display_name_required`.
- A user can set/change their display name on web and mobile and see it reflected on the leaderboard
  and notes.
- The existing `4zsznfwtd8cx` account is fixed by the owner setting a name post-deploy, with no hand
  DB mutation.
- Backend CI (ruff + format + `alembic upgrade head` + `alembic check` + pytest) and web/mobile CI
  all green; Codex `VERDICT: APPROVED`.
