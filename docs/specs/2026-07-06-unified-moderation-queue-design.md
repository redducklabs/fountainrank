# Unified moderation queue + badge (#12, lean slice) — design

Design spec for the **read/triage half** of moderation — GitHub issue
**[#12](https://github.com/redducklabs/fountainrank/issues/12)**. It generalizes the
**photo-only** admin moderation queue and pending-report badge shipped by the
[fountain-photos design](2026-07-04-fountain-photos-design.md) and left photo-scoped by the
[generalized content-reporting design (#11)](2026-07-06-content-reporting-design.md) (which
explicitly deferred "generalizing the admin queue" to #12), so that **note** and **fountain**
reports surface and can be actioned from **one** moderation board — on web **and** mobile —
and the admin badge counts **all** report types.

This is a deliberately **lean slice of #12**: the unified queue + badge + per-type actions,
reusing the existing admin action endpoints. The heavier parts of #12 — a `moderation_actions`
audit table, soft-delete/tombstones beyond the existing `is_hidden`, rating removal + ranking
recompute, and account-ban escalation ([#13](https://github.com/redducklabs/fountainrank/issues/13))
— stay **out of scope** (§10) and are tracked on
[#216](https://github.com/redducklabs/fountainrank/issues/216) / #13.

## 1. Problem & scope

Content reporting shipped in two halves. The **write** half (#11, merged in PR #195) is done:
photos, notes, and fountains can all be reported, and every report lands in one polymorphic
`content_reports` table (`content_type ∈ {photo,note,fountain}`). The **read** half was left
photo-only: the admin queue (`GET /api/v1/admin/photo-reports`), the badge summary
(`GET /api/v1/admin/photo-reports/summary`), and their resolve-on-action logic all hard-filter
`content_type = 'photo'` (`admin.py:324`, `admin.py:429`). A note or fountain report is stored
correctly but is **invisible** to moderators and does **not** move the badge.

**In scope:**

- **New unified queue endpoint** `GET /api/v1/admin/reports` — one heterogeneous, paginated,
  oldest-pending-first list spanning photo/note/fountain, with an optional `content_type`
  triage filter.
- **New unified badge endpoint** `GET /api/v1/admin/reports/summary` — count of distinct
  reported items (across all three types) with ≥1 pending report.
- **New generalized dismiss** `POST /api/v1/admin/reports/dismiss` — reject an item's pending
  reports without hiding/deleting it, for any content type.
- **Generalize resolve-on-action** so hiding a **note** or **fountain** (and the new dismiss)
  resolves that item's pending `content_reports` — today only the photo hide/dismiss/delete
  paths do this.
- **Web** `/admin/reports` becomes the unified **Moderation queue** with per-type rows +
  actions; the header **badge** repoints to the unified summary.
- **Mobile** `admin/reports.tsx` becomes the unified queue with per-type rows + actions; the
  mobile admin badge repoints to the unified summary.
- **`docs/style-guide.md`** updated for the moderation-queue row variants + badge copy change.
- Tests mirroring CI across backend + web + mobile.

**Out of scope (explicitly) — tracked on #216/#13:**

- `moderation_actions` **audit table** (who/what/when/reason).
- **Soft-delete / tombstones** beyond the existing `is_hidden` visibility flag.
- **Rating removal** + `recompute_fountain_ranking` excluding removed ratings.
- **Account-ban escalation** (#13).
- A **note hard-delete** endpoint (notes have only upsert + admin *hide*; hide is the removal,
  and hiding retains the row so its reports and audit trail are preserved — see §4).

**No schema change.** `content_reports` (migration `0021`) already carries `content_type`,
`content_id`, `fountain_id`, `status`, `resolution`, `resolved_by_user_id`, `resolved_at`,
`category`, `note`, `created_at` — everything this slice needs. **No migration.**

**Platforms:** web **and** mobile, in this build.

## 2. Approach & backward compatibility

**Additive, non-breaking.** The released mobile app pins to `GET /api/v1/admin/photo-reports`,
`GET /api/v1/admin/photo-reports/summary`, `PATCH /api/v1/admin/photos/{id}`,
`POST /api/v1/admin/photos/{id}/dismiss-reports`, and `DELETE /api/v1/admin/photos/{id}`. Those
endpoints stay **byte-for-byte unchanged** so old installs keep working. The new unified
surface is **added alongside**; the new web + mobile boards consume it.

The rejected alternative — broadening `/admin/photo-reports` to return all types — is a
breaking change: the old mobile app would receive note/fountain rows it renders as
`ReportedPhotoOut` (missing `thumbnail_url`, etc.) and break. Adding a new endpoint is the
correct, safe call and matches the #11 posture of keeping the photo path stable.

The new queue query is a **direct generalization** of `admin_photo_reports` (`admin.py:300`):
the same two-part shape (a grouped aggregate for counts/categories/first-reported, then a
windowed fetch of the ≤3 newest truncated report notes), with the `content_type = 'photo'`
predicate widened to "all types" (or the requested filter) and a small **per-type** detail
fetch replacing the single `FountainPhoto` join.

## 3. Backend — new endpoints

All three live in `backend/app/routers/admin.py`, under the existing
`Depends(require_admin)` router prefix `/api/v1/admin`, and follow the existing structured
logging conventions (log ids/counts/actions; **never** the report free-text `note`, which is
admin-only PII).

### 3.1 `GET /api/v1/admin/reports` — the unified queue

Query params (mirroring `admin_photo_reports`): `limit` (1–200, default 50), `offset` (≥0),
and a new optional `content_type` (`photo`|`note`|`fountain`) triage filter (422 on any other
value). Returns `list[ReportedContentOut]` (§3.4), **oldest pending report first**,
page-bounded.

**Query (generalize the existing two-part photo query):**

1. **Grouped aggregate** over `content_reports WHERE status = 'pending'` (AND
   `content_type = :content_type` when the filter is set), grouped by
   `(content_type, content_id)`:
   `count(*) AS report_count`, `array_agg(DISTINCT category) AS categories`,
   `min(created_at) AS first_reported_at`, `bool_and`/`max` not needed. Order by
   `min(created_at) ASC, content_type, content_id` (the extra `content_type, content_id` keys
   make pagination deterministic when two items' oldest report share a timestamp — the same
   skip/dup guard the photo query uses). `LIMIT/OFFSET` applied here.

   Unlike the photo query, this grouped step cannot join a single content table (the table
   varies by `content_type`), so it **excludes orphaned reports before pagination** with a
   per-type `EXISTS` existence predicate in the `WHERE` (photo → `EXISTS (SELECT 1 FROM
   fountain_photos WHERE id = cr.content_id)`, note → `fountain_notes`, fountain → `fountains`).
   This reproduces the guarantee the photo query gets from its `FountainPhoto` join — an orphaned
   report never enters the count, the page, or the ordering — and, by using the **same predicate**
   as the badge summary (§3.2), keeps the queue and the badge consistent by construction. The #11
   invariants already make orphan pending reports impossible (photo hard-delete deletes its
   reports in-txn; fountain delete cascades all its reports via the `fk_content_reports_fountain`
   `ON DELETE CASCADE`; notes have no hard-delete), so the predicate is defensive. The per-type
   detail fetch below additionally **skips and logs at `warning`** any row that still resolves to
   a missing detail (never silently dropped), as a belt-and-suspenders backstop — but because the
   `EXISTS` predicate runs before `LIMIT/OFFSET`, that skip can no longer corrupt pagination.

2. **Windowed report-notes fetch** — identical to the photo query's step (2b): the ≤3 newest
   non-null report notes per page item, each `left(note, 200)` **truncated in SQL** so the
   untruncated free text never leaves the DB, keyed by `(content_type, content_id)` and bounded
   by a `row_number()` window. Never logged.

3. **Per-type detail fetch** — for the page's ids, grouped by `content_type`, fetch display
   details in one query per present type (≤3 queries):
   - **photo** → `FountainPhoto` + uploader `User`: `is_hidden`, `fountain_id`,
     `thumbnail_url`/`url` (the gated `/api/v1/photos/{id}` + `/thumb` paths, as today),
     `contributor = public_display_name(...)`.
   - **note** → `FountainNote` + author `User`: `is_hidden`, `fountain_id`,
     `excerpt = left(body, 200)` (truncated in SQL), `contributor = public_display_name(...)`.
   - **fountain** → `Fountain`: `is_hidden`, `fountain_id = id`,
     `fountain_label = placement_note` (nullable — a fountain has **no name**; the row also
     carries the always-present `fountain_id` for the "View fountain" link),
     `contributor = None` (fountain adder not surfaced in this slice).

   Hidden items are **included** (shown with an `is_hidden` chip) — reporting/moderating a
   hidden item is allowed and moderators still want the signal, matching the photo queue.

Assemble `ReportedContentOut` rows in the grouped order. Log `returned`/`limit`/`offset` and,
optionally, per-type counts — never the notes.

### 3.2 `GET /api/v1/admin/reports/summary` — the badge count

Returns `ReportsSummary { pending_count: int }` = the number of **distinct
`(content_type, content_id)` pairs** with ≥1 pending report, using the **same per-type `EXISTS`
existence predicate as the queue (§3.1)** so the badge and the queue agree by construction (an
orphan report — which the #11 invariants already preclude — is counted by neither):

```sql
SELECT count(*) FROM (
  SELECT DISTINCT content_type, content_id
  FROM content_reports cr WHERE status = 'pending'
    AND ( (cr.content_type = 'photo'    AND EXISTS (SELECT 1 FROM fountain_photos WHERE id = cr.content_id))
       OR (cr.content_type = 'note'     AND EXISTS (SELECT 1 FROM fountain_notes  WHERE id = cr.content_id))
       OR (cr.content_type = 'fountain' AND EXISTS (SELECT 1 FROM fountains       WHERE id = cr.content_id)) )
) t;
```

Same counting rule as today's photo badge (distinct reported items), un-filtered across types.
Chosen over "total pending reports" so the badge reflects **items needing attention** (the unit
of moderator action), consistent with the existing photo badge and the queue's one-row-per-item
shape.

### 3.3 `POST /api/v1/admin/reports/dismiss` — generalized reject

Body `ReportDismissRequest { content_type: str, content_id: uuid.UUID }` → **204**. Validates
`content_type ∈ {photo,note,fountain}` (422 else). It **validates the target still exists** per
content type (photo → `FountainPhoto`, note → `FountainNote`, fountain → `Fountain`) and returns
**404** if missing — matching the existing `admin_dismiss_photo_reports` existence check
(`admin.py:512`), so a dismiss never resolves reports for a nonexistent target. It then resolves
every still-pending report for that `(content_type, content_id)` as `resolution = 'rejected'`
(via the generalized resolver, §4), stamping `resolved_by_user_id`/`resolved_at`. Idempotent:
dismissing an existing item that has no pending reports is a no-op **204** (rowcount 0). The new
web + mobile boards use this for **all** types (including photo); the old
`POST /admin/photos/{id}/dismiss-reports` stays unchanged for old mobile. Logs the admin,
`content_type`, `content_id`, and resolved count.

### 3.4 `ReportedContentOut` schema (`backend/app/schemas.py`)

```python
class ReportedContentOut(BaseModel):
    content_type: str          # 'photo' | 'note' | 'fountain'
    content_id: uuid.UUID
    fountain_id: uuid.UUID
    is_hidden: bool
    report_count: int
    categories: list[str]
    notes: list[str]           # reporter free-text, <=3, truncated <=200 (admin-only PII)
    first_reported_at: datetime
    contributor: str | None    # uploader (photo) / author (note); None for fountain
    thumbnail_url: str | None = None   # photo only
    url: str | None = None             # photo only (gated full-image path)
    excerpt: str | None = None         # note body, truncated <=200 (note only)
    fountain_label: str | None = None  # fountain placement_note (fountain only; nullable)
```

A single flat, discriminated-by-`content_type` shape (optional per-type fields) is chosen over a
nested union so the generated api-client type is trivial for web/mobile to render and OpenAPI
stays clean. `ReportsSummary` and `ReportDismissRequest` are added alongside. The existing
`ReportedPhotoOut` / `PhotoReportsSummary` are **unchanged** (old mobile depends on them).

## 4. Generalized resolve-on-action

Today `_resolve_pending_reports(session, photo_id, admin, resolution)` (`admin.py:437`) is
photo-hardcoded (`content_type == 'photo'`). Generalize its signature to
`_resolve_pending_reports(session, content_type, content_id, admin, resolution)` and filter on
both. Wire-in:

| Trigger | File / handler | Resolution | Status |
|---|---|---|---|
| Photo hide | `admin_patch_photo` | `hidden` | exists — pass `content_type='photo'` |
| Photo dismiss (old endpoint) | `admin_dismiss_photo_reports` | `rejected` | exists — pass `content_type='photo'` |
| **Note hide** | `admin_patch_note` | `hidden` | **new** — resolve on hide (`is_hidden` true→) |
| **Fountain hide** | `admin_patch_fountain` (`is_hidden` false→true) | `hidden` | **new** |
| **Any dismiss** | `admin_dismiss_reports` (new, §3.3) | `rejected` | **new** |

Semantics mirror the photo path exactly:

- **Hide resolves; unhide does not re-open.** Hiding a note/fountain resolves its pending
  reports (`hidden`); a later unhide clears the visibility flag but leaves already-resolved
  reports resolved (no report re-open) — identical to `admin_patch_photo`.
- **Fountain hide resolves only `content_type='fountain'` reports** for that fountain — not the
  note/photo reports *under* it. Hiding a fountain moderates the fountain as an item; the
  individual notes/photos are separate queue items actioned separately (or swept when the
  fountain is deleted). Documented so a moderator isn't surprised a hidden fountain still has
  pending note reports in the queue.
- **Delete already cleans up.** Photo hard-delete (both paths) deletes its `content_reports`
  in-txn (existing, #11 §3.2). Fountain delete cascades all its reports via
  `content_reports.fountain_id ON DELETE CASCADE` (existing, **no change** — an earlier draft's
  "fountain-delete orphan fix" was a false alarm; the cascade already handles it, via the
  `fk_content_reports_fountain` FK in migration `0021` and `ContentReport`).

The photo-path behavior and payloads are unchanged; only the resolver's signature widens.

## 5. Report categories & per-type actions

Categories are unchanged from #11 (`app/reports.py::ALLOWED_CATEGORIES`) — this slice is
read/triage only. The board exposes these actions per type, all reusing existing endpoints
except the generalized dismiss:

| content_type | Hide / Unhide | Reject (dismiss) | Delete |
|---|---|---|---|
| **photo** | `PATCH /admin/photos/{id}` *(exists)* | `POST /admin/reports/dismiss` *(new, §3.3)* | `DELETE /admin/photos/{id}` *(exists)* |
| **note** | `PATCH /admin/notes/{id}` *(exists; now resolves reports)* | `POST /admin/reports/dismiss` *(new)* | — (hide **is** the removal; no note hard-delete in this slice) |
| **fountain** | `PATCH /admin/fountains/{id}` `{is_hidden}` *(exists; now resolves reports)* | `POST /admin/reports/dismiss` *(new)* | `DELETE /admin/fountains/{id}` *(exists)* |

Hiding removes the item from public view (retained + auditable); Delete is a hard-delete for
photo/fountain (both already reverse contribution points and clean up per their existing paths).
A destructive Delete is confirmed in the UI (web dialog / mobile `Alert`), as the photo queue
already does.

## 6. Web (`web/`)

- **`web/app/admin/reports/page.tsx`** → **"Moderation queue"** (heading + intro copy updated
  from "Photo reports"). Fetch the unified queue (new server helper, generalizing
  `web/lib/server/photo-reports.ts` → a `getContentReportsServer`), render **one list** of
  heterogeneous rows. Row rendering splits by `content_type`:
  - **photo row** — reuse the existing `ReportedPhotoRow` markup (thumbnail + report chips +
    reporter notes + `ReportedPhotoActions`).
  - **note row** — note `excerpt` + author (`contributor`) + report chips + reporter notes +
    Hide/Unhide · Reject actions, linking to the fountain.
  - **fountain row** — `fountain_label` (or "Fountain") + "View fountain" link + report chips +
    reporter notes + Hide/Unhide · Reject · Delete actions.
  - Each row keeps a "View fountain" link to `/fountains/{fountain_id}`.
- **Actions** — a per-type client actions component (generalize `ReportedPhotoActions` into a
  `ReportedContentActions` that switches on `content_type`), calling **server actions** in
  `web/app/actions/admin.ts`: reuse `adminHidePhoto`/`adminDeletePhoto`,
  `adminSetNoteHidden`, `adminSetFountainHidden`/`adminDeleteFountain`; **add** a generalized
  `adminDismissReport(contentType, contentId)` calling `POST /admin/reports/dismiss` (used for
  all three types) and revalidating `/admin/reports`. Every action revalidates the queue.
- **Badge** — repoint the server-side seed and `fetchPendingReportCount`
  (`web/app/actions/admin.ts`) to `GET /admin/reports/summary` (returns `pending_count`); update
  `ReportBadge` sr-text to "pending reports" (drop "photo"). `AuthControl` seed prop unchanged in
  shape (a number).
- **`web/app/admin/page.tsx`** — landing copy updated to point at the Moderation queue (it also
  keeps the note about inline per-fountain controls).

## 7. Mobile (`mobile/`)

- **`mobile/app/admin/reports.tsx`** — generalize to the unified queue: query
  `GET /admin/reports` (typed `ReportedContentOut[]`) + `GET /admin/reports/summary`, render a
  `FlatList` of per-type rows (photo row = today's `ReportRow`; add note + fountain rows). Add
  per-type action mutations: note Hide/Unhide (`PATCH /admin/notes/{id}`) + Reject; fountain
  Hide/Unhide (`PATCH /admin/fountains/{id}`) + Reject + Delete (`DELETE /admin/fountains/{id}`,
  behind an `Alert` confirm); Reject uses `POST /admin/reports/dismiss` for all types. Invalidate
  the queue + summary query keys after each action (as today).
- **Badge** — repoint the mobile admin pending-report count (the `["me"]`-gated summary query /
  `ProfileTabIcon` badge) to `GET /admin/reports/summary`; reuse the existing
  `mobile/lib/admin/reports.ts` `formatBadgeCount`/`shouldShowBadge` helpers unchanged.
- **Auth attachment (must-not-miss)** — `mobile/lib/api.ts::isAuthenticatedApiRequest`
  force-attaches a bearer token only for an allowlist of **exact** paths, and it currently lists
  only the **old** photo-report paths (`api.ts:121`). Non-GET admin actions attach auth
  automatically, but these new queue/summary reads are **GETs**, so add the two new admin GET
  paths (`/api/v1/admin/reports`, `/api/v1/admin/reports/summary`) to that allowlist — **retaining
  the old photo paths for released clients**. Without this the staff-only reads go out tokenless
  and 401/403. Covered by a unit test (§9).
- Reuses existing toast/`Alert`/`QueryStateView` patterns; **no new native deps**.

## 8. API client (`packages/api-client/`)

After the backend routes/schemas land: `pnpm run generate`; **commit** the regenerated
`openapi.json` + `src/schema.d.ts`. Web/mobile consume the generated `ReportedContentOut`,
`ReportsSummary`, and `ReportDismissRequest` types and the new endpoints. Run the **full** local
mirror so a regenerated client that web/mobile no longer typecheck against can't slip through.

## 9. Testing (mirrors CI)

- **Backend (pytest, in `tests/test_admin_moderation.py` + a new
  `tests/test_admin_reports_queue.py`):**
  - **Unified queue**: seed pending reports across all three types; assert the list returns all
    three, **oldest-pending-first**, with correct `report_count`/`categories`/`notes`/per-type
    detail fields; `limit`/`offset` pagination is stable across a shared-timestamp tiebreak;
    the optional `content_type` filter narrows correctly; an invalid `content_type` → 422.
  - **Hidden items appear** with `is_hidden = true` (not filtered out).
  - **Orphan exclusion**: a pending report whose content row does not exist (the soft `content_id`
    lets a test insert one directly, with a real `fountain_id`) is excluded from **both** the queue
    page (via the per-type `EXISTS` predicate — so pagination of the surviving rows is unaffected)
    **and** the summary count; the detail-skip backstop leaks no report notes if it ever fires.
  - **Summary**: distinct-item count across types; an item with N pending reports counts once;
    resolved reports don't count.
  - **Resolve-on-action**: `admin_patch_note` hide resolves that note's pending reports
    (`resolution='hidden'`, `resolved_by/at` stamped) and **only** that note's; fountain hide
    resolves only that fountain's `content_type='fountain'` reports and leaves note/photo
    reports under it pending; unhide does not re-open.
  - **Dismiss**: `POST /admin/reports/dismiss` rejects an item's pending reports for each type;
    idempotent no-op when none pending; 422 on bad `content_type`; **404 when the target
    (photo/note/fountain) does not exist** (existence check per §3.3).
  - **PII**: reporter `note` free-text is **never logged** (caplog assertion on the queue-read
    and dismiss records); notes truncated ≤200.
  - **Auth boundary**: non-admin → **403** on `GET /admin/reports`, `/admin/reports/summary`,
    and `POST /admin/reports/dismiss` (the `require_admin` router dep).
  - **Photo regression**: the existing photo queue/summary/hide/dismiss/delete tests
    (`test_admin_photos.py`, `test_admin_moderation.py`, `test_photos_delete_report.py`) stay
    green unchanged — the photo endpoints are untouched.
  - `alembic check` still clean (no schema change, so this is a guard that nothing drifted).
- **Web (vitest):** unified queue page renders a photo + note + fountain row with the right
  per-type actions; `adminDismissReport` posts the right endpoint; `ReportBadge`/
  `fetchPendingReportCount` count all types; empty state renders "No pending reports."
- **Mobile (vitest):** pure-helper tests for any new per-type helpers (e.g. action availability
  / label formatting) added to `mobile/lib/admin/reports.ts`; **`isAuthenticatedApiRequest`
  attaches auth for `/api/v1/admin/reports` and `/api/v1/admin/reports/summary`** (and still for
  the old photo paths); existing helper tests stay green.
- **Full local mirror** `./run.ps1 check` green before the PR and before each push.

## 10. #12 boundary after this slice

Shipped here: the unified queue + badge + per-type Hide/Reject/(Delete) reusing existing action
endpoints, with resolve-on-action generalized to notes/fountains. **Tracked on #216/#13:**
`moderation_actions` audit table; soft-delete/tombstones beyond `is_hidden`; rating removal +
ranking recompute; note hard-delete; account-ban escalation (#13). None are prerequisites for
this slice — it is independently useful and testable.

## 11. Open decisions for spec review

1. **Badge semantics** = distinct reported **items** with ≥1 pending report (not total pending
   reports). Confirmed in design; flag if "total reports" is wanted instead.
2. **Fountain hide resolves only fountain-type reports** (not note/photo reports under it).
   Confirmed; flag if hiding a fountain should sweep its children's reports too.
3. **No note hard-delete** in this slice (hide is the removal). Confirmed; a note Delete is a
   #12/future add.
4. **Generalized dismiss used for photos too** in the new UI (old photo dismiss endpoint
   retained only for old mobile). Confirm the two dismiss paths coexisting is acceptable.
5. **`content_type` triage filter** included on the queue (cheap, optional). Flag if you'd
   rather ship without it.
