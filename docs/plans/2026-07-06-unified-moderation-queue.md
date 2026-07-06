# Unified Moderation Queue + Badge (#12 lean slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface **note** and **fountain** reports (already stored by #11) alongside photo reports in **one** admin moderation board on **web and mobile**, make the admin badge count **all** report types, and let admins Hide / Reject / (Delete) each item — reusing the existing action endpoints. The photo report/moderation path and the released mobile app's endpoints stay **byte-for-byte unchanged**.

**Architecture:** Additive, non-breaking. Three new admin endpoints on the existing `content_reports` spine (**no schema change / no migration**): `GET /api/v1/admin/reports` (heterogeneous, oldest-pending-first, paginated, optional `content_type` filter, per-type `EXISTS` existence predicate before pagination), `GET /api/v1/admin/reports/summary` (distinct pending items across types, same `EXISTS` predicate), `POST /api/v1/admin/reports/dismiss` (per-type existence-checked reject). `_resolve_pending_reports` is generalized to any `content_type` and wired into note-hide + fountain-hide + the generalized dismiss. The old photo endpoints (`/admin/photo-reports`, `/summary`, photo actions) are untouched for released clients.

**Tech Stack:** FastAPI + async SQLAlchemy 2 + PostGIS (backend), Next.js 16 (web), Expo SDK 56 / React Native (mobile), `packages/api-client` (openapi-typescript + openapi-fetch).

**Source spec:** `docs/specs/2026-07-06-unified-moderation-queue-design.md` (Codex-APPROVED). Section refs below (`spec §N`) point there.

## Global Constraints

- **Windows host, backslash paths** in file tools; **Bash tool is Git Bash** (forward slashes). Backend runs under **`uv`** (`cd backend && uv run …`); DB container on **port 5436** (`./run.ps1 up`; fresh container needs `uv run alembic upgrade head`).
- **`run.ps1` aborts on tool stderr** — run CI-mirror commands via the **Bash tool**: backend `cd backend && uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`; JS `pnpm exec turbo run lint typecheck test --filter=<pkg>`.
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution**, **no time estimates** anywhere.
- **Backend endpoint/schema change → `pnpm run generate`** (repo root) and **commit** regenerated `packages/api-client/{openapi.json,src/schema.d.ts}`.
- **No migration** in this slice — but `alembic check` must stay drift-free (guard that nothing drifted).
- **Logging**: structured, no bare `print`, no secrets/PII/**raw report notes** in logs; a 500 is never silent.
- **Auth**: all new endpoints under the existing `require_admin` router dependency. Never self-mint tokens.
- **Byte-for-byte photo parity**: do NOT change `/admin/photo-reports`, `/admin/photo-reports/summary`, `PATCH/DELETE /admin/photos/{id}`, or `POST /admin/photos/{id}/dismiss-reports`. The existing photo tests are the safety net.
- **Every PR**: CI green **AND** Codex `VERDICT: APPROVED` **AND** every PR comment addressed → squash-merge. Codex `cwd` = the WSL path **derived from the current repo root** (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`; never hardcode), bypass mode (`sandbox: danger-full-access`, `approval-policy: never`).

---

## PR / branch strategy

**Single PR** off `feat/unified-moderation-queue` bundling backend + api-client + web + mobile — the change is cohesive (three endpoints + generalized UI on both platforms). Order of commits: backend (B1→B2), api-client (C1), web (W1→W2), mobile (M1), style guide (S1); the PR opens after the full local mirror is green. Spec + this plan are already committed on the branch. After merge: dispatch the **web/backend deploy** and the **mobile store release** (see "Deployment").

---

## File Structure

**Backend (modified):** `backend/app/routers/admin.py` (generalize `_resolve_pending_reports`; wire note/fountain hide; add the three endpoints), `backend/app/schemas.py` (`ReportedContentOut`, `ReportsSummary`, `ReportDismissRequest`).
**Backend (new tests):** `backend/tests/test_admin_reports_queue.py` (unified queue + summary + dismiss + orphan + auth). Extend `backend/tests/test_admin_moderation.py` for note/fountain resolve-on-action.

**api-client (regenerated):** `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`.

**Web (modified):** `web/app/admin/reports/page.tsx` (→ unified board), `web/components/admin/ReportedPhotoActions.tsx` → generalized `ReportedContentActions` (per-type), `web/lib/server/photo-reports.ts` → `getContentReportsServer`, `web/app/actions/admin.ts` (`adminDismissReport` + repoint `fetchPendingReportCount`), `web/components/admin/ReportBadge.tsx` (sr-text), `web/app/admin/page.tsx` (landing copy), plus their `.test.tsx`.

**Mobile (modified):** `mobile/app/admin/reports.tsx` (→ unified screen), `mobile/lib/api.ts` (`isAuthenticatedApiRequest` — add the two new admin GET paths), `mobile/lib/admin/reports.ts` (per-type helpers), the mobile admin badge summary query, plus their tests (`mobile/lib/**/*.test.ts`, `mobile/lib/api.test.ts`).

**Docs:** `docs/style-guide.md` (S1).

*(Exact mobile badge-query file is pinned in M1 Step 1 by grepping for the existing `photo-reports/summary` consumer.)*

---

# Backend

### Task B1: Generalize `_resolve_pending_reports` + wire note/fountain hide

**Files:** Modify `backend/app/routers/admin.py`; extend `backend/tests/test_admin_moderation.py`.

**Interfaces — Produces:** `_resolve_pending_reports(session, content_type: str, content_id: uuid.UUID, admin: User, resolution: str) -> int` (widened signature). **Consumes:** existing `ContentReport`, `require_admin`.

- [ ] **Step 1: Write failing tests** in `test_admin_moderation.py` (seed a user + fountain + a note + pending reports):
  - Hiding a note (`PATCH /admin/notes/{id}` `{is_hidden: true}`) resolves that note's pending reports (`status='resolved'`, `resolution='hidden'`, `resolved_by_user_id`/`resolved_at` set) and **only** that note's — an unrelated note's/photo's pending reports stay `pending`.
  - Hiding a fountain (`PATCH /admin/fountains/{id}` `{is_hidden: true}`) resolves that fountain's pending `content_type='fountain'` reports and **leaves** pending note/photo reports under the same fountain untouched (spec §4).
  - Unhiding does **not** re-open resolved reports.
  - Photo regression: existing `admin_patch_photo` hide / `admin_dismiss_photo_reports` tests still pass.
- [ ] **Step 2: Run — expect FAIL.** `cd backend && uv run pytest tests/test_admin_moderation.py -v`
- [ ] **Step 3: Implement.** Widen `_resolve_pending_reports` to take `content_type` + `content_id` and filter on both. Update the two existing photo callers (`admin_patch_photo` hide, `admin_dismiss_photo_reports`) to pass `content_type="photo"`. In `admin_patch_note`: on a false→true `is_hidden` transition, call the resolver with `("note", note_id, admin, "hidden")` in the same txn. In `admin_patch_fountain`: on a false→true `is_hidden` transition, call `("fountain", fountain_id, admin, "hidden")`. Add the `resolved_reports` count to each mutation's structured log (no note text).
- [ ] **Step 4: Run — expect PASS.** Full backend mirror (ruff + format + alembic upgrade + alembic check + pytest).
- [ ] **Step 5: Commit** `feat(backend): resolve pending reports on note/fountain hide (#12)`.

### Task B2: Unified queue + summary + dismiss endpoints

**Files:** Modify `backend/app/routers/admin.py`, `backend/app/schemas.py`; create `backend/tests/test_admin_reports_queue.py`.

**Interfaces — Produces:** `GET /api/v1/admin/reports` → `list[ReportedContentOut]`; `GET /api/v1/admin/reports/summary` → `ReportsSummary`; `POST /api/v1/admin/reports/dismiss` (`ReportDismissRequest`) → 204. **Consumes:** B1's generalized resolver, `public_display_name`, existing photo-queue query patterns.

- [ ] **Step 1: Add schemas** (`schemas.py`): `ReportedContentOut` (spec §3.4), `ReportsSummary { pending_count: int }`, `ReportDismissRequest { content_type: str, content_id: uuid.UUID }`. Leave `ReportedPhotoOut`/`PhotoReportsSummary` untouched.
- [ ] **Step 2: Write failing tests** in `test_admin_reports_queue.py` (seed pending reports across photo+note+fountain on ≥2 fountains):
  - **Queue**: returns all three types, oldest-pending-first; correct `report_count`/`categories`/`notes`(≤3, ≤200)/per-type detail (`thumbnail_url`/`url`+`contributor` for photo; `excerpt`+`contributor` for note; `fountain_label` for fountain); `limit`/`offset` stable across a shared-timestamp tiebreak (order by `min(created_at), content_type, content_id`); `content_type` filter narrows; bad filter → 422; hidden items appear with `is_hidden=true`.
  - **Orphan exclusion**: a `content_reports` row with a `content_id` that has no content row (soft ref — insert directly, real `fountain_id`) is excluded from the queue page **and** the summary; the surviving rows' order/pagination is unaffected; no report note is logged if the detail-skip backstop fires.
  - **Summary**: distinct-item count across types; N reports on one item count once; resolved reports don't count.
  - **Dismiss**: rejects an item's pending reports for each type (`resolution='rejected'`); idempotent no-op when none pending; **404** when the target doesn't exist; **422** on bad `content_type`.
  - **PII**: reporter `note` never logged (caplog on the queue-read + dismiss records).
  - **Auth**: non-admin → **403** on all three endpoints.
- [ ] **Step 3: Run — expect FAIL.** `cd backend && uv run pytest tests/test_admin_reports_queue.py -v`
- [ ] **Step 4: Implement** in `admin.py` (spec §3):
  - `admin_reports`: grouped aggregate over `content_reports WHERE status='pending'` (+ optional `content_type`), grouped by `(content_type, content_id)`, with the per-type `EXISTS` predicate (photo→`fountain_photos`, note→`fountain_notes`, fountain→`fountains`) in the `WHERE` **before** `LIMIT/OFFSET`; order `min(created_at) ASC, content_type, content_id`. Then the windowed ≤3-newest report-notes fetch (`left(note,200)` in SQL, keyed by the pair). Then per-type detail fetch (one query per present type). Assemble `ReportedContentOut` in grouped order; skip+`warning`-log any missing detail (backstop). Log `returned`/`limit`/`offset`; never the notes.
  - `admin_reports_summary`: the distinct-pair count with the same `EXISTS` predicate (spec §3.2).
  - `admin_dismiss_reports`: validate `content_type`; per-type existence check → 404; call the B1 resolver with `"rejected"`; commit; 204. Log admin/type/id/resolved-count.
- [ ] **Step 5: Run — expect PASS.** Full backend mirror.
- [ ] **Step 6: Commit** `feat(backend): unified admin moderation queue + summary + dismiss (#12)`.

---

# API client

### Task C1: Regenerate + commit the client

**Files:** `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`.

- [ ] **Step 1:** From repo root, `pnpm run generate`.
- [ ] **Step 2:** Confirm the new `ReportedContentOut`/`ReportsSummary`/`ReportDismissRequest` types and the three endpoints appear in `schema.d.ts`.
- [ ] **Step 3:** `pnpm exec turbo run lint typecheck test --filter=@fountainrank/api-client`.
- [ ] **Step 4: Commit** `build(api-client): regenerate for unified moderation queue (#12)`.

---

# Web

### Task W1: Unified moderation board + per-type actions

**Files:** Modify `web/app/admin/reports/page.tsx`, `web/lib/server/photo-reports.ts` → `getContentReportsServer`, `web/components/admin/ReportedPhotoActions.tsx` → `ReportedContentActions`, `web/app/actions/admin.ts` (add `adminDismissReport`); tests `web/app/admin/page.test.tsx` (or a new `reports/page.test.tsx`), `web/app/actions/admin.test.ts`.

**Interfaces — Consumes:** C1 types + the three endpoints, existing `adminHidePhoto`/`adminDeletePhoto`/`adminSetNoteHidden`/`adminSetFountainHidden`/`adminDeleteFountain`.

- [ ] **Step 1: Server fetch.** Generalize `photo-reports.ts` to `getContentReportsServer(requestId)` calling `GET /admin/reports` → `ReportedContentOut[]`.
- [ ] **Step 2: Dismiss action.** Add `adminDismissReport(contentType, contentId)` to `admin.ts` calling `POST /admin/reports/dismiss`, revalidating `/admin/reports` (mirrors `adminDismissPhotoReports`).
- [ ] **Step 3: Actions component.** Generalize `ReportedPhotoActions` → `ReportedContentActions` switching on `content_type`: photo → Hide/Unhide · Reject · Delete; note → Hide/Unhide · Reject; fountain → Hide/Unhide · Reject · Delete. Reject calls `adminDismissReport`; Delete confirmed via a dialog.
- [ ] **Step 4: Page.** Rewrite `page.tsx` heading/intro to "Moderation queue"; render one list with a row-per-`content_type` (reuse the photo row markup; add note row = `excerpt`+`contributor`; fountain row = `fountain_label`/"Fountain"); every row links to `/fountains/{fountain_id}`; empty state "No pending reports."
- [ ] **Step 5: Tests.** vitest: a photo + note + fountain row render with the right actions; `adminDismissReport` posts the right endpoint; empty state. `pnpm exec turbo run lint typecheck test --filter=web`.
- [ ] **Step 6: Commit** `feat(web): unified moderation board with per-type actions (#12)`.

### Task W2: Badge repoint + landing copy

**Files:** Modify `web/app/actions/admin.ts` (`fetchPendingReportCount`), the `AuthControl` server seed source, `web/components/admin/ReportBadge.tsx` (sr-text), `web/app/admin/page.tsx`; tests `web/components/admin/ReportBadge.test.tsx`, `web/components/AuthControl.test.tsx`, `web/app/actions/admin.test.ts`.

- [ ] **Step 1: Repoint** `fetchPendingReportCount` to `GET /admin/reports/summary` (returns `pending_count`); repoint the server-rendered initial-count seed (grep the `photo-reports/summary` caller feeding `AuthControl`'s `pendingReportCount`). Update `ReportBadge` sr-text "pending reports" (drop "photo").
- [ ] **Step 2: Landing copy** in `admin/page.tsx` → point at the Moderation queue (keep the inline-per-fountain note).
- [ ] **Step 3: Tests + mirror.** Update the affected tests; `pnpm exec turbo run lint typecheck test --filter=web`.
- [ ] **Step 4: Commit** `feat(web): count all report types in the admin badge (#12)`.

---

# Mobile

### Task M1: Unified moderation screen + auth helper + badge repoint

**Files:** Modify `mobile/app/admin/reports.tsx`, `mobile/lib/api.ts` (`isAuthenticatedApiRequest`), `mobile/lib/admin/reports.ts` (per-type helpers), the mobile admin badge summary query; tests `mobile/lib/api.test.ts`, `mobile/lib/admin/reports.test.ts`.

**Interfaces — Consumes:** C1 types + endpoints; existing `PATCH /admin/notes/{id}`, `PATCH/DELETE /admin/fountains/{id}`.

- [ ] **Step 1: Auth helper (must-not-miss, spec §7).** In `isAuthenticatedApiRequest` add the two new exact GET paths `"/api/v1/admin/reports"` and `"/api/v1/admin/reports/summary"` to the allowlist (`api.ts:121`), **retaining** the old photo paths. Grep for the mobile badge summary consumer to pin its file.
- [ ] **Step 2: Failing helper tests.** `mobile/lib/api.test.ts`: `isAuthenticatedApiRequest` returns `true` for both new paths (and still the old photo paths). Add any per-type helper (action availability / label) to `mobile/lib/admin/reports.ts` with tests.
- [ ] **Step 3: Screen.** Generalize `reports.tsx`: query `GET /admin/reports` (`ReportedContentOut[]`) + `GET /admin/reports/summary`; render per-type rows (photo row = today's `ReportRow`; note row = `excerpt`+`contributor`; fountain row = `fountain_label`). Per-type mutations: note Hide/Unhide (`PATCH /admin/notes/{id}`) + Reject; fountain Hide/Unhide (`PATCH /admin/fountains/{id}`) + Reject + Delete (`DELETE /admin/fountains/{id}` behind an `Alert` confirm); Reject = `POST /admin/reports/dismiss` for all types. Invalidate queue + summary keys after each action.
- [ ] **Step 4: Badge.** Repoint the mobile admin pending-report summary query to `GET /admin/reports/summary`; keep `formatBadgeCount`/`shouldShowBadge` unchanged.
- [ ] **Step 5: Run.** `pnpm exec turbo run lint typecheck test --filter=mobile` + `expo-doctor` (via the mirror). (React-Compiler eslint is CI-only/stricter — see the mobile lint note; avoid `useRef().current` in render + unconditional `setState` in `useEffect`.)
- [ ] **Step 6: Commit** `feat(mobile): unified moderation screen + all-type badge (#12)`.

---

# Docs & finalize

### Task S1: Style guide

- [ ] Document the moderation-queue row variants (photo/note/fountain) + per-type action buttons + the badge copy change in `docs/style-guide.md`. Commit `docs: style guide for unified moderation queue (#12)`.

### Task F1: Full mirror + PR + Codex + merge

- [ ] **Full local mirror green:** `./run.ps1 check` (backend + web + mobile + api-client). Fix anything red before pushing.
- [ ] **Open PR**, get CI green (push only when the local mirror is green).
- [ ] **Codex PR-review loop** (`claude_help/codex-review-process.md`) until `VERDICT: APPROVED`; address every PR comment (Codex/Copilot/other).
- [ ] **Squash-merge** once CI green + Codex approved + all comments addressed.

---

## Deployment

- [ ] **Backend + web:** after merge to `main`, dispatch `gh workflow run deploy.yml --ref main` and monitor to success (deploy is **manual dispatch** — merge alone does not deploy). Verify the badge + unified board on the deployed web app with a test note report.
- [ ] **Mobile store release:** dispatch the mobile store-release workflow per project process (production env; confirm with the owner). Verify the unified screen + badge on a build.

## Out of scope (stays on #12/#13)

`moderation_actions` audit table; soft-delete/tombstones beyond `is_hidden`; rating removal + ranking recompute; note hard-delete; account-ban escalation (#13). See spec §10.
