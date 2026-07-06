# Generalized content reporting (#11) — design

Design spec for GitHub issue **#11** (report content into a moderation queue). It
**generalizes** the photos-scoped reporting slice already shipped by the
[fountain-photos design](2026-07-04-fountain-photos-design.md) (which explicitly implemented
"a photos-scoped slice of #11 and #12") so that **notes** (review/comment text) and
**user-visible fountains** become reportable too, on a single polymorphic reporting spine.

This is the **reporting (write) half** of the moderation story. The **admin queue / triage /
content-removal half** — generalizing the admin UI to notes & fountains, the
`moderation_actions` audit table, and rating removal + ranking recompute — is
[#12](https://github.com/redducklabs/fountainrank/issues/12) and is deliberately **out of
scope here** (§13). Ships as its own branch/PR.

## 1. Problem & scope

Today only **photos** can be reported (`photo_reports` + `POST …/photos/{id}/report` + the
photo admin queue). Notes and user-added fountains — both user-generated content on a public
repo — have **no report path**. #11 adds one, and rather than bolt a second parallel report
table next to `photo_reports`, it replaces `photo_reports` with a single **polymorphic
`content_reports`** table that covers photos, notes, and fountains. That gives #12 exactly
one queue to generalize instead of a `UNION` of two tables.

**In scope:**

- A polymorphic **`content_reports`** table (`content_type` ∈ {`photo`,`note`,`fountain`} +
  soft `content_id`), replacing `photo_reports`, with a reversible Alembic migration that
  **data-migrates the existing photo reports** into it and drops `photo_reports`.
- A shared backend **report chokepoint** (`backend/app/reports.py`) and three nested report
  endpoints (photo — repointed; note — new; fountain — new), all rate-limited, idempotent,
  and returning **204**.
- **Repointing** the existing photo report machinery (rate limiter, photo report endpoint,
  photo owner-delete cleanup, and the photo admin queue/hide/dismiss/delete reads) onto
  `content_reports` so photo reporting/moderation behaves **identically** — the photo admin
  queue stays photo-only; generalizing it is #12.
- A user-facing **report affordance** on notes and on the fountain itself, on **web** and
  **mobile**, mirroring the existing photo report dialog/button (generalized, not duplicated).
- Tests mirroring the photo report suite across all three content types, plus a migration
  data-integrity test.

**Out of scope (explicitly):**

- The **admin queue generalization** to notes/fountains, per-type resolution actions, the
  `moderation_actions` audit table, and rating removal + ranking recompute — **all #12**
  (§13). This release keeps the admin surface **photo-only**; it only repoints it onto the
  new table so it keeps working.
- **Ratings are not reportable.** A rating is a 1–5 star value shown only in aggregate
  (`average_rating`, per-dimension counts) — no other user's individual rating is displayed
  anywhere, so there is no surface to report one from. Admin-initiated rating *removal*
  (vote-manipulation cleanup) is a #12 concern.
- **Condition reports** and **attribute observations** are not reportable in v1 (not
  individually surfaced as free-text content). The polymorphic table makes adding them later
  a one-line `content_type` + category-matrix change — noted, not built.
- Notifying reporters, report analytics/history UI, and any auto-moderation.

**Platforms:** report affordance for notes + fountains = web **and** mobile.

## 2. Approach & relationship to the photo slice

The chosen shape (confirmed in design) is a **single polymorphic table, unified now** —
`content_reports` replaces `photo_reports` in this same PR, rather than living alongside it.

This is idiomatic for this codebase: `contribution_events` already carries a **soft
polymorphic target** (`target_type` ∈ {`rating`,`note`,`photo`,…} + `target_id`, "Not a hard
FK (targets span many tables); integrity enforced in the chokepoint" — `app/models.py`).
`content_reports` follows the same precedent, with the report-creation chokepoint
(`app/reports.py`) as the integrity boundary.

The two alternatives were rejected: **(a)** a `content_reports` table *alongside* a retained
`photo_reports` leaves two report systems and forces #12 to `UNION` or migrate anyway;
**(b)** per-content-type tables (`note_reports`, `fountain_reports`, …) multiply endpoints and
queue queries. Unifying now costs a bounded, well-tested refactor of the photo path and
yields one spine.

## 3. Data model

One new table replaces one existing table. Deterministic constraint/index names per the
repo's `NAMING_CONVENTION` (short explicit CHECK names so `alembic check` and the
constraint-name verification in `claude_help/testing-ci.md` stay actionable). New migration
`backend/migrations/versions/0021_content_reports.py` (head is currently
`0020_condition_award_window`), reversible.

### 3.1 `ContentReport` (`content_reports`) — replaces `PhotoReport`/`photo_reports`

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `content_type` | text | CHECK in (`photo`,`note`,`fountain`) — the polymorphic discriminator |
| `content_id` | UUID | **soft** reference to the reported row (no hard FK; integrity in the chokepoint) |
| `fountain_id` | UUID FK → `fountains.id` | `ondelete=CASCADE` — the owning fountain (always known); cascade cleanup + queue grouping key |
| `reporter_user_id` | UUID FK → `users.id` | `ondelete=CASCADE` |
| `category` | text | CHECK in the **superset** (`spam`,`abuse`,`inappropriate`,`not_a_fountain`,`inaccurate`,`other`) — see §6 for the per-type subset enforced by the chokepoint |
| `note` | varchar(500) nullable | optional short free-text |
| `status` | text | CHECK in (`pending`,`resolved`); `server_default 'pending'` |
| `resolution` | text nullable | CHECK in (`hidden`,`rejected`) when set |
| `resolved_by_user_id` | UUID FK → `users.id` nullable | admin who resolved (#12 sets it for non-photo types; photo hide/dismiss already do) |
| `resolved_at` | timestamptz nullable | |
| `created_at` | timestamptz | `server_default now()` |

Indexes (mirror the three `photo_reports` indexes, re-keyed onto the polymorphic pair; all
explicit `Index(...)` in the model **and** `op.create_index` in the migration so names match):

- **Partial unique** `uq_content_reports_target_reporter_pending` on
  `(content_type, content_id, reporter_user_id) WHERE status = 'pending'` — one *pending*
  report per user per content item (re-report allowed after resolution). Backs the idempotent
  `ON CONFLICT DO NOTHING` insert (§7).
- `ix_content_reports_target_pending` on `(content_type, content_id) WHERE status = 'pending'`
  — per-item pending count for the queue/badge.
- `ix_content_reports_reporter_created` on `(reporter_user_id, created_at)` — backs the report
  **rate-limit** count (§8). **Non-partial** (unlike the photo version's pending-only index),
  because the rate-limit query counts a reporter's reports across all statuses in a rolling
  window — a small, deliberate improvement over `ix_photo_reports_reporter_pending_created`.

FK/CHECK names: `pk_content_reports`, `fk_content_reports_fountain`,
`fk_content_reports_reporter`, `fk_content_reports_resolved_by`, and CHECK names
`content_type` / `category` / `status` / `resolution` (short — the `ck` convention renders
`ck_content_reports_<name>`; passing the full name double-prefixes — the `stars_range` trap).

### 3.2 Referential integrity — the one real trade-off

`content_id` is a **soft** reference (no per-type FK), so referential cleanup moves to the
chokepoints (matching `contribution_events`):

- **Fountain deleted** → `fountain_id` FK `ON DELETE CASCADE` removes all of that fountain's
  reports across every content type. ✓ (Admin fountain hard-delete already cascades broadly.)
- **Individual note/photo removed** (owner-delete, or admin hide-then-delete) → the delete
  path must **explicitly delete that item's rows**:
  `DELETE FROM content_reports WHERE content_type = :t AND content_id = :id`. Today the photo
  owner-delete (`photos.py`, `DELETE …/photos/{id}`) relies on the DB `ON DELETE CASCADE` from
  `fountain_photos → photo_reports`; dropping that hard FK means this delete becomes explicit.
  This is the **only** place the refactor adds logic rather than repointing (§5).

Rejected alternative: keeping per-type nullable FK columns (`photo_id`/`note_id`) to preserve
hard integrity — it defeats the polymorphic simplicity and makes the #12 queue a per-column
mess. Soft ref + explicit chokepoint cleanup is the right call and matches the codebase.

## 4. Migration `0021_content_reports` (reversible, drift-free)

**upgrade():**
1. `create_table("content_reports", …)` with the columns, CHECKs, FKs, and PK above.
2. `create_index` for the three indexes in §3.1.
3. **Data-migrate** existing photo reports (raw SQL, joins `fountain_photos` for `fountain_id`):
   ```sql
   INSERT INTO content_reports
     (id, content_type, content_id, fountain_id, reporter_user_id, category, note,
      status, resolution, resolved_by_user_id, resolved_at, created_at)
   SELECT pr.id, 'photo', pr.photo_id, fp.fountain_id, pr.reporter_user_id, pr.category,
      pr.note, pr.status, pr.resolution, pr.resolved_by_user_id, pr.resolved_at, pr.created_at
   FROM photo_reports pr JOIN fountain_photos fp ON fp.id = pr.photo_id;
   ```
   (Reuses the original `id`s so nothing dangling references them — none do; reports are
   leaf rows.)
4. `drop_table("photo_reports")` (and its indexes drop with it).

**downgrade():** recreate `photo_reports` (+ its three indexes, verbatim from
`0019_photo_reports`), copy the `content_type = 'photo'` rows back
(`INSERT INTO photo_reports … SELECT … FROM content_reports WHERE content_type='photo'`),
then `drop_table("content_reports")`. **Documented data loss on downgrade:** `note`/`fountain`
reports have no home in `photo_reports` and are dropped — acceptable for a down-migration.

`alembic upgrade head` + `alembic check` must be clean; both directions tested (§12). CHECK
names verified against `pg_constraint` (alembic check ignores CHECK definitions).

## 5. Repoint surface — keep the photo path green

The photo report/moderation behavior must be **byte-for-byte unchanged** (the existing photo
tests are the safety net). What moves from `PhotoReport`/`photo_reports` to
`ContentReport`/`content_reports`:

- **`app/models.py`** — replace `PhotoReport` with `ContentReport` (§3.1).
- **`app/locks.py`** — rename `PHOTO_REPORT_LOCK_NS` → `CONTENT_REPORT_LOCK_NS` (keep the
  numeric value `0x50525054`; a report is no longer photo-specific).
- **`app/rate_limit.py`** — `_count_reports_since` counts `ContentReport` (content-agnostic:
  a per-user report budget spanning all content types, which is the correct semantics);
  `check_report_rate` uses the renamed lock namespace. Limits unchanged (`REPORTS_PER_MIN=20`,
  `REPORTS_PER_DAY=100`).
- **`app/routers/photos.py`** — the photo report endpoint delegates to the new chokepoint
  (§7) with `content_type='photo'`; the photo **owner-delete** adds the explicit report
  cleanup (§3.2).
- **`app/routers/admin.py`** — the photo-reports **queue**, **summary badge**, **hide**
  (resolve pending reports), **dismiss-reports**, and **delete** read/write
  `content_reports WHERE content_type = 'photo'`. Behavior and payloads are identical; it stays
  photo-only. (Generalizing this queue to notes/fountains is **#12**.)
- **`app/schemas.py`** — `ReportPhotoRequest` becomes the shared `ReportContentRequest`
  (§7); the admin `ReportedPhotoOut` is unchanged (still photo-only).

## 6. Report categories

DB `CHECK` allows the **superset** `('spam','abuse','inappropriate','not_a_fountain',
'inaccurate','other')` — backward-compatible with existing photo rows (whose four categories
are a subset). The **chokepoint** (`app/reports.py`) enforces a **per-type subset** (422 with
the allowed set on mismatch); the frontends offer exactly that subset:

| content_type | allowed categories |
|---|---|
| `photo` | `inappropriate`, `not_a_fountain`, `spam`, `other` *(unchanged)* |
| `note` | `spam`, `abuse`, `inappropriate`, `inaccurate`, `other` |
| `fountain` | `not_a_fountain`, `spam`, `inappropriate`, `inaccurate`, `other` |

`status`/`resolution` keep the photo vocabulary exactly (`pending`/`resolved` +
`hidden`/`rejected`) — no churn; the richer "reviewing/actioned" states are unneeded until (if
ever) #12.

## 7. Reporting API

A shared chokepoint plus three **nested** endpoints (consistent with the existing photo
report route and the app's fountain-scoped routing). Request body is one shared schema:

```python
class ReportContentRequest(BaseModel):
    category: str                                   # validated per content_type in the chokepoint
    note: str | None = Field(default=None, max_length=500)
```
(A single `str` category + server-side per-type validation is chosen over per-type `Literal`
schemas because the allowed set varies by type; the frontend controls which categories it
offers, and the DB CHECK + chokepoint are the backstops. Trade-off: OpenAPI doesn't encode the
per-type enum — accepted.)

**Chokepoint** `backend/app/reports.py`:
```
create_content_report(session, *, content_type, content_id, fountain_id,
                      reporter_user_id, category, note) -> None
```
1. Validate `category ∈ ALLOWED[content_type]` → **422** else.
2. Acquire the per-user report advisory lock (`CONTENT_REPORT_LOCK_NS`) and
   `check_report_rate` → **429** with `Retry-After` else (identical to the photo path).
3. Idempotent insert:
   `pg_insert(ContentReport).values(…).on_conflict_do_nothing(index_elements=
   ["content_type","content_id","reporter_user_id"], index_where=(ContentReport.status=="pending"))`
   `.returning(id)`; a duplicate **pending** report is a silent **204** (never an
   `IntegrityError` that would poison the async session).
4. Structured log records ids/`content_type`/`category`/`inserted` only — **never the raw
   note** (PII).

**Endpoints** (all `get_current_user` — any signed-in user; display name **not** required;
reporting a *hidden* item is allowed — moderators still want the signal; unknown/mis-scoped
target → **404**; success → **204**):

| endpoint | file | content_type | target validation |
|---|---|---|---|
| `POST /fountains/{fid}/photos/{pid}/report` | `photos.py` (repointed) | `photo` | photo exists & scoped to `fid` |
| `POST /fountains/{fid}/notes/{nid}/report` | `fountains.py` (new) | `note` | note exists & `note.fountain_id == fid` |
| `POST /fountains/{fid}/report` | `fountains.py` (new) | `fountain` | fountain exists (any `created_source`) |

The fountain report targets **any** existing fountain — the report is only a signal; #12
decides the action. Self-reporting one's own content is allowed (harmless; matches the photo
path).

## 8. Rate limiting & dedupe (unchanged semantics)

- **Rate limit:** `check_report_rate` counts the reporter's `content_reports` in rolling
  60s/24h windows under the per-user advisory lock → **429** (`REPORTS_PER_MIN=20`,
  `REPORTS_PER_DAY=100`). The budget is now shared across all content types a user reports —
  correct (it's an anti-spam gate on the person, not the target).
- **Dedupe:** the partial-unique index (§3.1) + `ON CONFLICT DO NOTHING` → one pending report
  per (item, reporter); a duplicate is an idempotent 204. As in the photo path, a
  `DO NOTHING` duplicate adds no row and so doesn't consume the rate count — accepted (a cheap
  authenticated upsert; a dedicated attempt ledger is deferred unless report spam is observed).

## 9. Web (`web/`)

Generalize the existing photo report UI rather than duplicate it:

- **`ReportPhotoDialog.tsx` → `ReportContentDialog.tsx`** — takes
  `{ contentType, fountainId, contentId, categories }`, renders the category select + optional
  note, and calls a generalized `reportContent` **server action** (from the existing
  `reportPhoto` action in `web/app/actions/…`) that POSTs the right nested endpoint. Shows
  "Reported / Already reported"; auth-gated.
- **Note report affordance** — a flag/"Report" control on each note row where notes render on
  the detail page (the notes list in `web/components/fountain/…`). `NoteOut` already carries
  the note `id`.
- **Fountain report affordance** — a "Report this fountain" control on the detail page
  (`FountainDetail.tsx`).
- **Style guide** — document the generalized report dialog + report/flag control in
  `docs/style-guide.md` before implementing (the photo report dialog is already documented;
  this generalizes that entry).

## 10. Mobile (`mobile/`)

- **`ReportPhotoButton.tsx` → `ReportContentButton.tsx`** — takes the same content descriptor
  and POSTs the right nested endpoint via `client.POST(...)`; reuses `mobile/lib/admin/reports`
  patterns where applicable.
- **Note report affordance** on each note row in the mobile detail
  (`mobile/components/fountain/…`), and a **"Report this fountain"** action on the fountain
  detail (`mobile/app/fountains/[id].tsx`).
- Reuses the existing report dialog/toast patterns; no new native deps.

## 11. API client (`packages/api-client/`)

After the backend routes/schema land: `pnpm run generate`; **commit** the regenerated
`openapi.json` + `src/schema.d.ts` per repo convention. Web/mobile consume the generated
`ReportContentRequest` type and the new endpoints. Run the full mirror so a regenerated client
that web/mobile no longer typecheck against can't slip through.

## 12. Testing (mirrors CI)

- **Backend (pytest):**
  - **Chokepoint / endpoints**, for **each** content type (photo, note, fountain): any
    signed-in user reports → 204; category **outside the per-type set** → 422; note >500 →
    422; **duplicate pending → idempotent 204 and the session still commits** (ON CONFLICT DO
    NOTHING, no poisoned txn); report **rate limit → 429**; **concurrent** reports from one
    user cannot commit past the quota; report on a **hidden** item allowed; unknown target or
    wrong `{fountain_id}` scoping → 404; note **never logged**.
  - **Migration:** `alembic upgrade head` + `alembic check` clean; existing `photo_reports`
    rows land in `content_reports` **intact** (ids, category, status, resolution, timestamps,
    and the joined `fountain_id`); downgrade recreates `photo_reports` and round-trips the
    photo rows.
  - **Photo regression (repoint):** the existing photo report + admin queue/hide/dismiss/
    delete tests continue to pass against `content_reports` — their fixtures/assertions that
    reference the `PhotoReport` model or `photo_reports` table (in `tests/conftest.py`,
    `test_rate_limit.py`, `test_photos_delete_report.py`, `test_admin_photos.py`) are updated
    to `ContentReport` / `content_reports`; the photo **owner-delete now explicitly removes**
    that photo's `content_reports` rows (was cascade).
  - **Referential integrity:** deleting a fountain cascades its `content_reports`; deleting a
    note/photo removes only that item's reports.
- **Web/mobile:** `pnpm exec turbo run lint typecheck test --filter=web|mobile`;
  `ReportContentDialog` / `ReportContentButton` render + submit tests (category subset per
  type, success/already-reported); web build clean.
- Full local mirror `./run.ps1 check` green before the PR and before each push.

## 13. #11 / #12 boundary (explicit)

- **#11 (this spec):** the `content_reports` spine; report **writes** for photo/note/fountain
  + the shared chokepoint; the `photo_reports` → `content_reports` migration; **repoint** the
  existing photo admin queue so it keeps working (photo-only); web + mobile report affordances
  for notes & fountains.
- **#12 (next):** generalize the admin **queue/triage UI** to display & action note/fountain
  reports (per-type resolution: hide the note, hide/delete the fountain); the
  **`moderation_actions` audit table**; **rating removal** + `recompute_fountain_ranking`
  excluding removed ratings; the profile **badge** count broadening beyond photos.

## 14. Out-of-scope / open decisions for spec review

1. **Ratings not reportable** (no per-user surface) — confirmed in design.
2. **Fountain report target = any fountain** (report is signal-only; #12 acts). Flag if you'd
   rather restrict to `created_source='user'`.
3. **Category matrix (§6)** — the per-type subsets; easy to adjust.
4. **Unify photos now** (replace `photo_reports`) vs. additive — confirmed "unify now".
5. **Rate limits reused as-is** (20/min, 100/day, shared across content types) — confirm the
   shared-budget semantics are intended.
