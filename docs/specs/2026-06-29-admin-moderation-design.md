# Admin moderation (web + mobile) — design (2026-06-29)

**Status:** approved design → implementation. Bundled in one branch/PR with two ready follow-ups
(#113, #114). This doc is the design of record **and** the implementation brief Codex builds the
admin feature from.

## 1. Context & goals

FountainRank already has an **admin identity** (`User.is_admin`, reconciled per-request from the
`admin_subjects` allowlist — see §3) and a **moderation-ready data model** (`is_hidden` /
`hidden_by_user_id` / `hidden_at` columns on `FountainNote`, `ConditionReport`,
`AttributeObservation`; `Fountain.is_hidden`). What is missing is the **admin write surface**: there
are no admin-only endpoints, no `require_admin` dependency, and no UI. The web `/admin` page is a stub
that literally promises "Hide / unhide fountains and notes."

**Goal:** let an admin/moderator, from **both web and mobile**, (a) **moderate comments** (hide/unhide
`FountainNote`s), and (b) **edit fountains** — correct core fields, soft-hide/unhide, and (guarded)
hard-delete spam. Built for a near-future world of **multiple moderators working primarily in the
mobile app**.

## 2. Scope

**In scope**
- Backend: `require_admin` gate + a dedicated `/api/v1/admin` router (fountain read/edit/hide/delete,
  note hide/unhide) + tests.
- Web: inline admin controls on the fountain **detail** page (gated on `viewer.isAdmin`); turn the
  `/admin` stub into a short landing.
- Mobile: inline admin controls on `app/fountains/[id].tsx` (gated on the viewer's `is_admin`).
- Regenerate the typed `@fountainrank/api-client` from the updated OpenAPI so web/mobile call the new
  endpoints with types.

**Out of scope (track, do not build now)**
- A standalone moderation **console / queue / search** (v1 is inline-on-detail).
- A reporting/flagging flow ("Review reported content").
- A dedicated **audit table** (v1 uses the `hidden_by_*`/`hidden_at` columns + structured logs;
  see §4.5). Revisit if a formal audit trail for edits/deletes is needed.
- Moderating `ConditionReport` / `AttributeObservation` (model supports it; not requested now).

## 3. Admin identity (existing — DO NOT rebuild)

- `User.is_admin` (bool, default false) is set request-time by `app/auth.py::_reconcile_admin`:
  `is_admin == (sub in settings.admin_subjects)`, exact/case-sensitive, write-if-changed. Grant and
  demotion both take effect on the next authenticated request.
- `GET /api/v1/me` returns `is_admin`. Web reads it via `lib/server/viewer.ts::getViewer` →
  `viewer.isAdmin`. Mobile reads it in `app/(tabs)/account.tsx` today.
- Admins are configured by `admin_subjects` (Logto subjects). **No new identity mechanism.**

## 4. Backend design

### 4.1 `require_admin` dependency (`app/auth.py`)
Add alongside `get_current_user`:

```python
async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin required")
    return user
```

- Anonymous → 401 (from `get_current_user`); authenticated non-admin → **403**; admin → `User`.
- Log a single WARNING on the 403 (admin endpoint reached by non-admin) with the subject — a
  security-relevant event — but never log the token/JWT.

### 4.2 Admin router (`app/routers/admin.py`, `prefix="/api/v1/admin"`, every route `Depends(require_admin)`)
Register in `app/main.py` next to the other routers.

| Method & path | Purpose | Body | Returns |
|---|---|---|---|
| `GET /admin/fountains/{id}` | Admin view of one fountain: includes `is_hidden` **and ALL notes incl. hidden** (each with `id`, `body`, `author_display_name`, `is_hidden`, `created_at`, `updated_at`). Lets a moderator find what to unhide. | — | `AdminFountainDetail` |
| `PATCH /admin/fountains/{id}` | Partial edit. Any subset of: `location` (`Coordinates`), `is_working`, `placement_note`, `comments`, `is_hidden`. | `AdminFountainPatch` | `AdminFountainDetail` |
| `DELETE /admin/fountains/{id}` | **Hard delete** (cascades — see §4.3). | — | `204` |
| `PATCH /admin/notes/{note_id}` | Moderate a comment: `{ "is_hidden": bool }`. Hide sets `hidden_by_user_id`+`hidden_at`; unhide clears both. | `AdminNotePatch` | `AdminNoteOut` |

Notes:
- `GET /admin/fountains/{id}` and edits operate on the row **regardless of `is_hidden`** (admins must
  reach hidden fountains); public reads in `routers/fountains.py` keep their `is_hidden.is_(False)`
  filters unchanged.
- Editing `location` writes geography via the existing `point_geography(lat, lng)` helper.
- Use `with_for_update()` on the fountain row in mutations (matches the existing note-upsert pattern).
- `404` when the id does not exist (admin or not); a **403 must not leak existence** (gate runs first).

### 4.3 Soft-hide vs hard-delete semantics
- **Soft-hide (`is_hidden = true`) is the everyday "remove from public" action.** Reversible;
  preserves ratings/notes/history. Public list/bbox/detail/notes reads already exclude hidden rows.
- **Hard-delete is destructive and irreversible.** Per the FK graph it **cascades**:
  `ratings`, `attribute_observations`, `fountain_attribute_consensus`, `condition_reports`,
  `fountain_notes`, `fountain_provenances` are **deleted**; `contribution_events.fountain_id` and
  `fountain_import_events.fountain_id` are **SET NULL** (points/audit survive). The UI MUST require an
  explicit confirmation before calling `DELETE`. Reserve for spam/junk.

### 4.4 Recompute & consistency
- If an edit changes an input to a **derived** field (notably `is_working`), recompute the affected
  denormalized fields via the **existing** recompute path (`app/ranking.py`) rather than hand-setting
  them. `current_status` stays derived from `condition_reports` — do not let an edit fabricate it.
- Hiding/unhiding a **note** does not touch rating/consensus aggregates (notes are independent).

### 4.5 Observability (mandatory — project rule)
Every admin mutation emits a structured **INFO** log with: admin `sub`/user id, action
(`hide`/`unhide`/`edit`/`delete`), target type + id, and the changed fields (before→after for edits;
**never** log secrets/PII beyond the already-public note body length). The 403 path logs WARNING.
Unhandled errors already flow through the centralized 500 handler — keep it that way.

### 4.6 Schemas (`app/schemas.py`)
- `AdminFountainPatch`: all fields optional — `location: Coordinates | None`, `is_working: bool | None`,
  `placement_note: str | None`, `comments: str | None`, `is_hidden: bool | None`. Reject an empty patch
  (422) so a no-op can't masquerade as success.
- `AdminFountainDetail`: `FountainDetail` fields **plus** `is_hidden: bool` and
  `notes: list[AdminNoteOut]`.
- `AdminNoteOut`: `NoteOut` fields **plus** `is_hidden: bool`.
- `AdminNotePatch`: `{ is_hidden: bool }`.

### 4.7 Tests (`backend/tests/test_admin_*.py`)
- **Authz matrix** on each route: anonymous → 401, authenticated non-admin → 403, admin → 2xx.
- Soft-hide a fountain → disappears from public list/bbox/detail; admin GET still returns it.
- Hide a note → excluded from public `GET /fountains/{id}/notes`; visible (with `is_hidden=true`) in
  admin GET; unhide restores it.
- Edit persists each field; editing `is_working` triggers a ranking recompute.
- Hard-delete removes the fountain + cascaded children; a `contribution_events` row for it survives
  with `fountain_id IS NULL`.
- Empty `PATCH` → 422.

## 5. Web design
- **Inline controls on the fountain detail page**, rendered only when `viewer.isAdmin`. Reuse the
  `viewer` already fetched in `web/app/fountains/[id]/page.tsx` (and the `@modal` interception route).
- A new client component (e.g. `web/components/admin/FountainAdminControls.tsx`) with: an **Edit** form
  (location lat/lng, is_working toggle, placement_note, comments), **Hide/Unhide**, **Delete** (with a
  confirm step), and a **Hide/Unhide** button per note.
- Admin writes go through **server actions** (mirror `app/actions/contribute.ts`) that call the new
  admin endpoints with the viewer's token; `router.refresh()` after success. New UI elements get a
  `docs/style-guide.md` entry.
- The `/admin` page (`web/app/admin/page.tsx`) stops saying "coming soon": short text + a note that
  moderation lives inline on each fountain. (Full console is out of scope.)

## 6. Mobile design
- **Inline controls on `mobile/app/fountains/[id].tsx`**, gated on the viewer's `is_admin`. The screen
  must learn `is_admin` — add a small `/me` query (or extend the auth/viewer provider) rather than
  prop-drilling; follow the existing react-query patterns in this file.
- New components mirroring web: an admin edit form + hide/unhide/delete for the fountain, and a
  hide/unhide affordance per note. Use `useMutation` like the existing contribution mutations;
  invalidate `["fountain", id, …]`, `["fountain", id, "notes"]`, and `["fountains","bbox"]` on success.
- **Auth gate:** `isAuthenticatedApiRequest` in `mobile/lib/api.ts` already returns `true` for every
  non-GET, so admin `PATCH`/`DELETE` carry the token automatically. **Only** the admin **GET**
  (`/api/v1/admin/fountains/{id}`, used to see hidden notes) needs a new boundary-safe match added
  there (same boundary-safe pattern as the #88/#65 entries). Add a `mobile/lib/api.test.ts` case.

## 7. Security requirements (explicit — Codex review focus)
1. **Every** `/api/v1/admin/*` route depends on `require_admin`. No admin logic in public routers.
2. Non-admin authenticated callers get **403**, anonymous **401**; neither response leaks whether a
   given fountain/note exists (gate before lookup).
3. Public reads (`/fountains`, `/fountains/bbox`, `/fountains/{id}`, `/fountains/{id}/notes`) keep
   excluding `is_hidden` rows — hidden content must never appear to anonymous/non-admin users.
4. A user editing their own note via the existing `POST /fountains/{id}/notes` must **not** be able to
   self-unhide (the current code already leaves moderation fields untouched on upsert — preserve that).
5. Mobile must never emit the dev-auth seam; the existing sanitizer/facade in `createApiClient` stays
   intact (admin calls go through the same client).
6. Hard-delete is gated behind explicit UI confirmation; the endpoint itself stays admin-only.

## 8. #113 — functional GiST index on `(location::geometry)` (mine; backend-only)
Hand-written Alembic migration adding a functional GiST index on `(location::geometry)` so the
near-global / full-latitude bbox fallback in `routers/fountains.py::fountains_in_bbox` (the planar
`geometry` intersection guarded by `_GEOGRAPHY_SAFE_LAT_SPAN_DEG`) can use an index instead of a seq
scan. `alembic check` does not flag expression indexes as drift; verify the index name appears in
`pg_indexes` and (where feasible) that the planner picks it for the geometry path. No model change.

## 9. #114 — web rating-form parity (mine; web-only)
SSR-authenticate the web detail fetch so `your_rating` flows to the form:
- Add a `server-only` `getAccessTokenRSC` helper returning the viewer token or `null` when anonymous;
  pass it into `getFountainDetailServer` (in `web/lib/fountains.ts`) from both the standalone
  `app/fountains/[id]/page.tsx` and the `@modal` interception route. Fall back to anonymous on any
  session/token error so public detail never breaks.
- Pre-fill `web/components/fountain/RatingForm.tsx` stars from `dimensions[].your_rating`; show an
  "already rated — update to change it" state with an **Update rating** label (mirror of #65 mobile).
- Update the two `page.test.tsx` mocks for the new server import; add a test that the token is
  forwarded **only** when authenticated.

## 10. Orchestration, sequencing, cross-review, PR gate
1. **I land #113 + #114 first** on `feat/admin-moderation` and commit. This puts the SSR-auth plumbing
   (`getAccessTokenRSC`) in place before the web admin controls need it.
2. **Codex then implements §4–§7** on the same branch, from this spec (bypass mode, derived `cwd`).
3. **Cross-review:** Codex reviews my #113/#114 commits; I review Codex's admin commits against §7.
   Address (fix or justify) every finding.
4. **One PR** for the whole branch → mandatory gate: **CI green AND a full Codex `VERDICT: APPROVED`
   loop AND every PR comment addressed** → **squash-merge** (only on the owner's go-ahead).

## 11. Acceptance criteria
- Admin (web + mobile) can hide/unhide a fountain, edit its core fields, hard-delete it (after
  confirm), and hide/unhide any note. A non-admin/anonymous user can do none of these and sees no
  hidden content.
- Backend authz matrix tests pass; soft-hide/hide-note/edit/delete behaviors are covered by tests.
- `@fountainrank/api-client` regenerated; web + mobile type-check against the new endpoints.
- #113 migration applies and the index exists; #114 web form pre-fills from `your_rating` and forwards
  the token only when authenticated.
- All local checks mirror-green; CI green; Codex `VERDICT: APPROVED`; all PR comments addressed.

## 12. Follow-ups (track, not now)
- Moderation console/queue + reporting flow.
- Dedicated admin audit table (if edit/delete history is later required).
- Moderation for conditions/attributes.
