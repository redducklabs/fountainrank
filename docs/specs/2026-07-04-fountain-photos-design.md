# Fountain photo uploads + image carousel + report/moderation — design

Design spec for GitHub issue **#167** (support fountain photo uploads and an image
carousel on detail pages, web + mobile). Because it accepts user-uploaded images on a
public repo, this release also ships a **photo report → admin moderation queue** flow,
which implements a **photos-scoped slice of #11 (report content) and #12 (admin
moderation queue)**. Ships as its own branch/PR.

## 1. Problem & scope

Users can rate, comment on, and report the condition of a fountain, but they cannot
**show** it. #167 adds user-contributed photos: a signed-in user uploads a picture of a
fountain, the picture is stored durably, and every fountain-detail page (web + mobile)
displays that fountain's photos in a carousel. Because this is a **public, open-source
repo accepting arbitrary user-uploaded images**, storage, permissions, validation, abuse
controls, and moderation — including a user-facing report path — are designed here
**before** any code.

**In scope:**

- A `FountainPhoto` table (child of fountain), mirroring `FountainNote`'s shape incl. the
  moderation triple, plus a `PhotoReport` table.
- **Private** DigitalOcean **Spaces** object storage + a **backend-proxied** upload
  endpoint that validates, strips EXIF, re-encodes, and thumbnails each image, and
  **backend-gated presigned-redirect** read endpoints (so a hidden image stops resolving).
- Public list endpoint + a carousel on **web** (overlaid left/right arrows) and **mobile**
  (native swipe).
- **Post-moderation**: photos are visible immediately; only authenticated (non-anonymous)
  users may upload, subject to per-user quotas + rate limits.
- A user-facing **report** button on every photo → a `PhotoReport` record.
- An admin **moderation queue** (reported photos) reachable from a **"Reports" link on the
  profile page** on **both web and mobile**, where an admin can **hide the photo** or
  **reject the report(s)**.
- A **badge on the profile icon** (web header + mobile tab) whenever the pending report
  queue is non-empty.
- A **first-photo-per-fountain** contribution point (reversed on hide/delete, re-awarded
  on unhide).
- A representative **thumbnail + photo count on the web city fountain list** (web only).

**Out of scope (explicitly):**

- Pre-moderation approval queue and automated/AI content scanning (post-moderation +
  user-report queue only).
- **New-account pre-upload review / trust tiers.** Deferred — post-moderation + per-user
  quotas + the report queue + fast admin removal are the v1 controls; a trust-tier system
  is a future enhancement noted in §6.
- Reporting/moderation of non-photo content (notes, fountains) — the broader #11/#12 work;
  this release covers **photos only**.
- HEIC decoding server-side (mobile picker emits JPEG; web input accepts JPEG/PNG/WebP).
- Photo thumbnails on the **map/bbox** pins or the **mobile** city list, or in the
  `FountainDetail` payload — web city list only.
- Points transferring to the "next" photo when an awarded photo is removed.
- Presigned direct-to-Spaces *uploads* (backend proxy only). Reads use presigned redirects.

**Platforms:** upload, carousel, report button, moderation queue, badge = web **and**
mobile. City-list thumbnail = web only.

## 2. Moderation posture, storage privacy & threat model

The animating risk of accepting user images on a public repo is illegal or abusive
content becoming publicly hosted under our domain, and staying reachable after removal.
Mitigations:

1. **Private storage, gated reads.** Objects are stored in a **private** Spaces bucket
   (no public-read ACL, no public CDN). Every image is served through a backend read
   endpoint (§8.5) that checks `is_hidden` and issues a **short-TTL presigned redirect**.
   **Hiding a photo makes its read endpoint return 404 immediately**, and any
   already-issued presigned URL expires within the TTL (≤10 min). This is what makes hide
   a real moderation primitive rather than a display filter.
2. **Hard removal for the worst content.** Admin **delete** hard-deletes the Spaces
   objects and the row; it **fails loudly (5xx)** if the object delete fails, so an admin
   never sees "removed" while bytes remain (§10.5). Hide (instant read gate) + delete
   (hard purge) are layered.
3. **Authenticated uploaders + accountability.** `require_named_user` (the contribution
   gate): the account exists and has a non-"Anonymous" display name, so every photo has an
   accountable owner.
4. **Server-side validation before publish.** The backend proxies the bytes, verifies they
   decode as a real raster image (Pillow, decompression-bomb guard), **re-encodes to JPEG**
   (stripping EXIF incl. GPS), and generates a thumbnail. Arbitrary bytes never reach
   storage; SVG/polyglot/scripted formats are rejected (only JPEG/PNG/WebP decode paths).
5. **Abuse controls.** Per-user quotas + rate limits on upload and report, a hard upload
   body cap, and an ingress body-size limit (§6).
6. **User report path + badge.** Any signed-in user can flag a photo; reports feed an admin
   queue with a visible badge, so bad content is surfaced by the community.
7. **Point disincentive.** Only the *first* photo on a fountain earns a point (§7), so
   there is no volume-farming incentive.

Post-moderation still means a short exposure window before an admin acts; the private
storage + report queue + fast hide/delete minimize and bound it.

## 3. Data model

Two new tables. Deterministic constraint/index names per the repo's `NAMING_CONVENTION`
(short explicit names so `alembic check` and the constraint-name verification in
`claude_help/testing-ci.md` stay actionable). Migrations
`backend/migrations/versions/0017_fountain_photos.py` and `0018_photo_reports.py`
(mirroring `0008_fountain_notes.py`), both reversible.

### 3.1 `FountainPhoto` (`fountain_photos`)

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `fountain_id` | UUID FK → `fountains.id` | `ondelete=CASCADE`, indexed |
| `user_id` | UUID FK → `users.id` | `ondelete=CASCADE` (uploader) |
| `storage_key` | text | Spaces object key of the full image |
| `thumbnail_key` | text | Spaces object key of the thumbnail |
| `content_type` | text | CHECK `= 'image/jpeg'` |
| `width` / `height` | int | CHECK `> 0` |
| `byte_size` | int | CHECK `> 0` |
| `is_hidden` | bool | `server_default false` |
| `hidden_by_user_id` | UUID FK → `users.id` nullable | set on admin hide |
| `hidden_at` | timestamptz nullable | set on admin hide |
| `created_at` / `updated_at` | timestamptz | `server_default now()` |

- Partial index `WHERE is_hidden = false` on `(fountain_id, created_at DESC)` — serves the
  public list and the city-list "most recent visible photo" lookup.
- Index on `(user_id, created_at)` — powers the per-user rate/quota counts (§6).
- **No** `unique(fountain_id, user_id)` — many photos per fountain; a user may add more
  than one (bounded by caps, §6).
- Store **keys**, not URLs (private bucket; presigned at read time).

### 3.2 `PhotoReport` (`photo_reports`)

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `photo_id` | UUID FK → `fountain_photos.id` | `ondelete=CASCADE`, indexed |
| `reporter_user_id` | UUID FK → `users.id` | `ondelete=CASCADE` |
| `category` | text | CHECK in (`inappropriate`,`not_a_fountain`,`spam`,`other`) |
| `note` | varchar(500) nullable | optional short free-text |
| `status` | text | CHECK in (`pending`,`resolved`); `server_default 'pending'` |
| `resolution` | text nullable | CHECK in (`hidden`,`rejected`) when set |
| `resolved_by_user_id` | UUID FK → `users.id` nullable | admin who resolved |
| `resolved_at` | timestamptz nullable | |
| `created_at` | timestamptz | `server_default now()` |

- **Partial unique** index `unique(photo_id, reporter_user_id) WHERE status = 'pending'` —
  one *pending* report per user per photo (a user may re-report after resolution).
- Partial index `WHERE status = 'pending'` on `(photo_id)` and on `(reporter_user_id,
  created_at)` — power the queue, badge count, and report rate limit (§6).

### 3.3 `storage_cleanup` (`storage_cleanup`)

Durable record of Spaces objects whose deletion failed and must be retried — needed so an
orphan is tracked **even when no `fountain_photos` row exists** (e.g. an upload that
uploaded objects but then failed the step-3 quota/cap re-check before any row was
inserted). Created in the `0017_fountain_photos.py` migration alongside `fountain_photos`.

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `object_key` | text | the Spaces key needing deletion |
| `reason` | text | CHECK in (`upload_orphan`,`moderation_delete`) |
| `status` | text | CHECK in (`pending`,`done`); `server_default 'pending'` |
| `attempts` | int | `server_default 0` |
| `created_at` / `last_attempt_at` | timestamptz | |

Index `WHERE status = 'pending'` on `(created_at)`. A future janitor (out of scope here)
drains it; this row is what guarantees "never a silent orphan."

### 3.4 `upload_attempt` (`upload_attempts`) — pre-work reservation ledger

Bounds **expensive** upload work per user *before* any Pillow/S3 cost, so a parallel burst
from one account cannot consume CPU/bandwidth ahead of the quota check (§6, §8.1). Created
in the `0017_fountain_photos.py` migration. (Reports need no reservation — they do only a
cheap DB insert, gated at commit time.)

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `user_id` | UUID FK → `users.id` | `ondelete=CASCADE` |
| `status` | text | CHECK in (`reserved`,`completed`,`failed`); `server_default 'reserved'` |
| `created_at` | timestamptz | `server_default now()` |
| `finalized_at` | timestamptz nullable | set when completed/failed |

Index on `(user_id, status, created_at)`. Counting (§6): `completed` and `failed` rows
always count in their rolling window (so failures still cost budget); only a `reserved`
row older than the reservation TTL (`upload_reservation_ttl_seconds`, default 120) is
**expired** and excluded — so a crashed request never permanently consumes quota.

## 4. Object storage (`backend/app/storage.py`, new)

A small module wrapping a `boto3` S3 client pointed at DO Spaces (S3-compatible). New
`Settings` fields in `backend/app/config.py` (fail-closed `*_enabled` idiom used by
`geocoding_enabled`/`email_configured`):

- `spaces_endpoint`, `spaces_region`, `spaces_bucket`, `spaces_access_key`,
  `spaces_secret_key`, `spaces_presign_ttl_seconds` (default 600), plus
  `@property photos_enabled` (true only when bucket + creds + endpoint all set).
- `spaces_endpoint` is normalized (must be `https://`, no trailing slash; non-HTTPS
  rejected in production). Access/secret keys are **never logged**; startup config logging
  redacts them (per the Logging & Observability standard).

Surface:

- `put_object(key, data, content_type)` — uploads **private** (`ACL="private"`) with a
  `Cache-Control` (informational; objects are only reached via presigned URLs).
- `delete_object(key)` — deletes one object; raises on failure (callers decide policy).
- `presign_get(key, ttl)` — returns a presigned GET URL. To stay cache-friendly the expiry
  is snapped to a fixed window boundary so the URL is stable within a window.
- Keys are **server-generated only** (`fountains/{fountain_id}/{photo_id}.jpg` and
  `..._thumb.jpg`, all UUIDs); presign never takes untrusted input.

`boto3` is **synchronous**; every storage call is invoked from async endpoints via
Starlette's `run_in_threadpool` (`anyio.to_thread`) so it never blocks the event loop. The
client is **lazily** constructed from `Settings` and cached, with a reset hook for tests
(so dependency-overridden settings are honored rather than frozen at import).

When `photos_enabled` is false (local dev without creds), the upload endpoint returns
**503** (`photo_uploads_unavailable`) and logs a warning — fails closed, never silent.

## 5. Image processing pipeline

Runs entirely **off** the event loop (`run_in_threadpool`) and **outside any DB
transaction** (see §8.1): (1) **streamed size guard** — the request body is read with a
hard byte ceiling (§6) and rejected the instant it is exceeded (413), never buffered
unbounded; (2) **decode & verify** with a decompression-bomb guard
(`Image.MAX_IMAGE_PIXELS`), reject non-raster/animated/oversized-dimension inputs (415);
(3) **normalize** — RGB, apply EXIF orientation, then re-encode dropping all metadata
(strips EXIF/GPS by construction); (4) **downscale** full image to max long edge **2048px**
(JPEG q≈85); (5) **thumbnail** max long edge **400px** (JPEG q≈80). Every step logs
structured events (fountain/user id, byte sizes, outcome); failures log WARNING/ERROR with
context and never leak secrets.

## 6. Limits, quotas & abuse controls

Because visibility is immediate and accounts are cheap, upload/report abuse is a
**security** concern, not polish. Controls (all backend-enforced; numbers tunable, see
§18):

**Per-request:**
- Accepted input (web `accept`): JPEG, PNG, WebP; mobile picker emits JPEG. Server
  re-encodes to JPEG; other types → 415.
- Max upload size **10 MB**, enforced by a **streaming byte cap** (413), plus the k8s
  ingress `nginx.ingress.kubernetes.io/proxy-body-size` annotation as defense-in-depth
  (§16).

**Per-fountain / per-user visibility caps** (counted `is_hidden = false`, in the insert
txn under the fountain row lock, §8.1):
- Per-fountain visible cap **20** (409 `photo_limit_fountain`).
- Per-user-per-fountain visible cap **5** (409 `photo_limit_user`).

**Rate limits & global quotas** (durable, **Postgres-count-based** so they hold across
pods without a Redis dependency — count rows in a rolling window; the `(user_id, …)`
indexes back these). Two distinct dimensions, so that **failed attempts still cost
budget** (a client that repeatedly triggers post-reservation validation/cap failures must
not upload for free):
- **Attempt rate limit** — counts **all non-expired `upload_attempt` rows regardless of
  status** (`reserved` + `completed` + `failed`) by `created_at`: **≤10 / rolling 60s**
  and **≤60 / rolling 24h per user** → **429** with `Retry-After`. This is what stops
  sequential abuse through failures.
- **Successful-upload quota** — counts `completed` attempts in **≤30 / rolling 24h per
  user** → **429** (the product limit; hidden photos still count because the attempt row
  is `completed` regardless of later hide).
- **Report** — counts all `photo_reports` by that reporter in **≤20 / rolling 60s** and
  **≤100 / rolling 24h per user** → **429**.
- **Atomic enforcement (not raceable), and it gates expensive work.** A plain
  count-then-insert races (concurrent requests all observe the same pre-count and all
  proceed), and even an atomic *commit-time* check would still let a burst burn Pillow/S3
  cost before rejection. So:
  - **Uploads** use the **`upload_attempt` reservation** (§3.4) as the *first
    authoritative gate*, evaluated in a **reservation dependency** that runs **before the
    request body is consumed** (the endpoint reads the multipart part via a size-capped
    manual stream — §8.1 — rather than an `UploadFile` body param, so nothing is parsed
    until the reservation passes). Under a per-user advisory lock: evaluate both the
    attempt-rate and success-quota counts above; if either is at its limit → **429** (no
    body read, no CPU/S3 spent); else insert a `reserved` row and commit that short
    reservation txn, releasing the lock. Then process + upload (§8.1 step 3), then
    **finalize** the reservation to `completed` (success) or `failed` (validation/cap
    conflict / cleanup — and a `failed` row **still counts** toward the attempt-rate
    window). The lock is held only around the tiny reservation write — never across CPU/S3
    work — so it can't starve the connection pool.
  - **Reports** do only a cheap insert, so the authoritative check runs at insert time
    under the per-user advisory lock (count in windows → 429, else the ON-CONFLICT insert
    of §9.1) — no reservation needed.
  - **Raw-body cost** (before Pillow) is bounded independently by the 10 MB streaming cap
    and the ingress `proxy-body-size` limit, so the honest claim is: the reservation gates
    **Pillow + Spaces** work, and raw multipart bytes are separately capped.
- **Advisory-lock keying.** Use the **two-argument** `pg_advisory_xact_lock(namespace,
  user_key)` form with a **distinct per-feature namespace constant** (e.g.
  `PHOTO_UPLOAD_LOCK_NS`, `PHOTO_REPORT_LOCK_NS`, both different from the existing
  `ADD_FOUNTAIN` key) and `user_key` = a stable 32-bit hash of the user id, so these locks
  cannot collide with each other or with `add_fountain`'s lock. Constants live in one
  place. **Lock ordering:** per-user advisory lock **before** any fountain `FOR UPDATE`.
- Every throttle emits a structured audit log (user id, kind, window, count). Tests fire
  **concurrent** uploads/reports and prove (a) committed rows never exceed the limit, and
  (b) excess parallel uploads are rejected **before** `put_object`/Pillow runs — plus the
  single-request 429 boundary for both endpoints.

**Deferred (documented non-goal for v1):** per-IP/subnet throttling and new-account trust
tiers. Rationale: DB-count per-user quotas + post-moderation + the report queue + fast
hide/delete are sufficient for launch; per-IP throttling belongs at ingress and trust
tiers are a larger design. Called out so it is a decision, not an omission.

## 7. Points — first photo per fountain (new contribution primitives)

The existing `record_contributions` uses `INSERT ... ON CONFLICT (dedup_key) DO NOTHING`
and `reverse_contributions` reverses **every** awarded event for a whole `fountain_id`
(used by admin fountain-delete). Neither fits a single-photo award, so this feature adds
**new, target-scoped primitives** in `backend/app/contributions.py`:

- Add `photo` to `EVENT_TARGET_TYPES`, a `PHOTO_FIRST` points value to the points config,
  and `dk_photo_first(fountain_id) -> "photo_first:{fountain_id}"`.
- **Award** (on the first visible photo for a fountain): record a `ContributionEvent`
  with `target_type='photo'`, `target_id=photo_id`, `fountain_id`, `points=PHOTO_FIRST`,
  `dedup_key=dk_photo_first(fountain_id)`. The per-fountain dedup key means only the first
  ever awards; later uploads conflict → no award. Because a removed award is **not**
  re-transferred, `ON CONFLICT DO NOTHING` is the correct semantics.
- **`reverse_contribution_for_target(session, target_type, target_id)`** — reverses **only
  that photo's** event (status `awarded → reversed`) and decrements the uploader's stats
  exactly once. It must **not** touch other fountain contributions.
- **`reactivate_contribution_for_target(session, target_type, target_id)`** — flips that
  photo's `reversed` event back to `awarded` and increments stats exactly once (used on
  unhide). No-op if no reversed event exists for the target.

Rules: **hide or delete** of the awarded photo reverses; **unhide** re-awards (reactivate).
If the awarded photo is removed, the award does not auto-transfer to the next photo.
Required tests (§17): hide twice, unhide twice, delete-after-hide, delete-after-unhide,
hide/delete of a non-awarded photo, and proof that unrelated add/rate/attribute/note
contributions on the same fountain are never reversed.

## 8. Photo endpoints (`backend/app/routers/photos.py`, new; registered in `main.py`)

Under `APIRouter(prefix="/api/v1")`. Schemas in `backend/app/schemas.py`.

### 8.1 `POST /fountains/{fountain_id}/photos` — upload
Auth `require_named_user`. `multipart/form-data`, but the endpoint takes the raw `Request`
and reads the single file part via a **size-capped manual multipart stream**
(`python-multipart`'s streaming parser, aborting at the 10 MB cap → 413) **rather than an
`UploadFile` body param** — so the reservation gate below runs before the body is consumed
(an `UploadFile` param would force full multipart parsing before the function body). The
transaction boundary is designed to avoid holding a lock across image/S3 work:
1. **Cheap existence check** (no lock): fountain exists + not hidden → 404 else.
2. **Reservation (authoritative rate gate, before the body is read or any expensive work):**
   in a short txn, take the per-user advisory lock (§6), evaluate the attempt-rate
   (`reserved`+`completed`+`failed`, non-expired) and success-quota (`completed`) counts in
   the 60s/24h windows → **429** if either is at its limit (nothing read/processed), else
   insert a `reserved` `upload_attempt`, `commit`, release the lock. Capture the id.
3. **Read + process (outside any txn):** stream-read the file part under the size cap, run
   the pipeline (§5), and upload both objects (full + thumb) to the private bucket via
   `run_in_threadpool`.
4. **Short txn:** `SELECT ... FOR UPDATE` the fountain, re-check caps/visibility (§6) →
   409, insert the row, award the first-photo point if applicable (§7), **finalize the
   reservation → `completed`**, `commit`.
5. **Failure/cleanup:** on a 413/415/409 or any failure after step 2 (row not committed),
   mark the reservation `failed` (it **still counts** toward the attempt-rate window),
   delete any just-uploaded objects; if that delete fails, log ERROR and insert a
   `storage_cleanup` row (§3.3, §10.6) — never leave a silent orphan.

Returns `PhotoOut`. Failure modes: 401/403, 404, 409, 413, 415, 429, 503.

### 8.2 `GET /fountains/{fountain_id}/photos` — list
Public. Visible photos (`is_hidden=false`) ordered `created_at DESC` → `list[PhotoOut]`.

### 8.3 `DELETE /fountains/{fountain_id}/photos/{photo_id}` — delete own
Auth `require_named_user`, **ownership enforced** (`photo.user_id == user.id`) → 403.
Hard-deletes Spaces objects (raises → 5xx on failure), deletes the row, reverses the
first-photo point if this was the awarded photo, resolves any pending reports. Returns 204.

### 8.4 `PhotoOut`
```
class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str            # API path to the gated full-image read endpoint (§8.5)
    thumbnail_url: str  # API path to the gated thumbnail read endpoint
    width: int
    height: int
    uploaded_by: str | None   # uploader display name
    created_at: datetime
```
`url`/`thumbnail_url` are **API-relative read paths** (not durable object URLs); clients
render them against their configured API base (as they already do for api-client calls).

### 8.5 `GET /photos/{photo_id}` and `GET /photos/{photo_id}/thumb` — gated read
Public. Looks up the photo; **404 if it does not exist or `is_hidden = true`**; otherwise
**302-redirects** to a short-TTL presigned GET (§4) for the full or thumbnail object, with
a short `Cache-Control`. This is the single choke point that makes hide effective. `<img>`
tags follow the redirect transparently.

## 9. Reporting (user endpoint)

### 9.1 `POST /fountains/{fountain_id}/photos/{photo_id}/report`
Auth `get_current_user` (**any signed-in user**, display name not required — reporting is
protective). Report rate limit (§6) → 429. Body:
```
class ReportPhotoRequest(BaseModel):
    category: Literal["inappropriate", "not_a_fountain", "spam", "other"]
    note: str | None = Field(default=None, max_length=500)
```
404 if the photo does not exist. Under the **per-user advisory lock** (§6), authoritatively
re-check the report rate/quota → 429, then insert via **`INSERT ... ON CONFLICT DO
NOTHING`** against the partial-unique predicate (`status='pending'`), using the
inserted-row count to decide — **no exception path** for duplicates, so the async session
is never poisoned by an `IntegrityError`. A duplicate pending report is an **idempotent
204** ("already reported"). **Accepted trade-off:** because a duplicate adds no row
(`DO NOTHING`), re-reporting the same photo does not consume the report-rate count; this is
fine — the path is a single cheap authenticated upsert with no expensive work, so a
dedicated report-attempt ledger is deferred unless duplicate-report spam is observed.
Reporting a hidden photo is allowed (records the report; visibility unchanged). Structured
log records ids/category/count only — **never the raw note** (PII). Returns 204.

## 10. Admin moderation & queue (`backend/app/routers/admin.py`, extend)

Router carries `dependencies=[Depends(require_admin)]` + the `_admin_context` audit helper.

### 10.1 Queue list — `GET /admin/photo-reports`
Reported photos **grouped by photo** (a photo with N pending reports appears once),
pending only, oldest-first (by earliest pending report). Paginated. Each item
(`ReportedPhotoOut`): photo id, `url`, `thumbnail_url` (the gated read paths), `fountain_id`,
`is_hidden`, `report_count`, distinct `categories`, up to **3** most-recent `notes` each
**truncated to 200 chars**, `first_reported_at`, uploader display name. Notes are returned
to admins only and **never logged**.

### 10.2 Badge count — `GET /admin/photo-reports/summary`
`{ "pending_photo_count": int }` = number of distinct photos with ≥1 pending report.
Polled by admin clients for the profile badge (§11/§13).

### 10.3 Hide — `PATCH /admin/photos/{photo_id}`
Body `{ "is_hidden": bool }`. Flips `is_hidden`, stamps `hidden_by_user_id`/`hidden_at` on
hide (clears on unhide). On **hide**: resolve this photo's pending reports as
`resolution="hidden"` and `reverse_contribution_for_target('photo', photo_id)`; the read
endpoints (§8.5) now 404. On **unhide**: `reactivate_contribution_for_target(...)`
(already-resolved reports stay resolved). Structured audit log (`target_type="photo"`).
Hide needs **no** object delete (reads are gated), so it cannot half-fail.

### 10.4 Reject reports — `POST /admin/photos/{photo_id}/dismiss-reports`
Resolve all pending reports for the photo as `resolution="rejected"` (photo stays visible),
stamping `resolved_by_user_id`/`resolved_at`. Structured audit log. Returns 204.

### 10.5 Delete — `DELETE /admin/photos/{photo_id}`
Hard-delete: remove Spaces objects **first**; if the object delete fails, return **5xx**
and do **not** report success (or, on repeated failure, mark `removal_pending` §10.6) — an
admin must never see "deleted" while bytes remain. Then delete the row (cascades reports),
reverse the first-photo point. Structured audit log.

### 10.6 Orphan / removal reconciliation
The `storage_cleanup` table (§3.3) is the single durable mechanism — it works whether or
not a `fountain_photos` row exists. On any failed object delete (upload orphan in §8.1
step 4 with `reason='upload_orphan'`, or moderation delete in §10.5 with
`reason='moderation_delete'`), insert a `pending` `storage_cleanup` row with the key(s)
and log ERROR. Admin **delete** additionally returns 5xx on the first failure so it is
never reported as succeeded. A future janitor drains `status='pending'`. The spec commits
to **never silently succeeding** on a failed moderation delete and **never leaving a
silent orphan**.

## 11. Web (`web/`)

- **Carousel** — `web/components/fountain/PhotoCarousel.tsx` (client). Photos with
  **left/right arrows overlaid, vertically centered on the image edges** (issue AC),
  keyboard-navigable, index indicator, wraps. **Empty state renders nothing.** Images use
  the gated read paths (§8.5). Slots near the top of
  `web/components/fountain/FountainDetail.tsx`.
- **Report control** — a "Report" affordance on each carousel photo → a small dialog
  (category select + optional note) → new `reportPhoto` **server action**
  (`web/app/actions/contribute.ts`). Auth-gated; shows "Reported/Already reported".
- **Upload** — auth-gated file input in `ContributeSection` → new `uploadPhoto` server
  action; client-side progress/errors; uploader sees a **delete** control on own photos.
- **Data** — `getFountainPhotosServer(...)` in `web/lib/fountains.ts`, passed into
  `FountainDetail`.
- **Moderation queue page** — new `web/app/admin/reports/page.tsx` (server component,
  admin-gated via existing admin server helpers): reported-photos list with each photo,
  report count/categories/notes, and **Hide** / **Reject** buttons (→ `PATCH
  /admin/photos/{id}` and `POST /admin/photos/{id}/dismiss-reports` server actions). A
  **"Reports" link** is added to the **account page** for admin users.
- **Badge** — the header user-menu/avatar shows a badge when `pending_photo_count > 0`. A
  small client component polls `GET /admin/photo-reports/summary` (only when the current
  user is admin) on a ~60s interval. (Exact header/nav file pinned in the plan.)
- **Style guide** — add the carousel, overlaid arrow button, list-row thumbnail, report
  dialog, queue row, and badge to `docs/style-guide.md` before implementing.

## 12. Web city fountain list — `CityFountainPin` (web only)

`FountainPin` is shared by the map **bbox** hot path, so it is **not** modified. A new
schema `CityFountainPin(FountainPin)` adds `photo_count: int` and
`thumbnail_url: str | None`; `CityFountainsOut.fountains` becomes `list[CityFountainPin]`.

**Pinned SQL shape** (preserve the existing stable ranking/count/id order + limit/offset
contract in `backend/app/routers/places.py`): first select the **page** of fountain ids
using the existing `ORDER BY ranking_score DESC NULLS LAST, rating_count DESC, id` +
`limit`/`offset`; then, for those page rows only, `LEFT JOIN LATERAL (SELECT id
FROM fountain_photos WHERE fountain_id = f.id AND is_hidden = false ORDER BY created_at
DESC LIMIT 1)` for the representative photo's **id** (the gated read path needs the id, not
the key) and a **separate scalar aggregate** `COUNT(*) FILTER (is_hidden = false)` for
`photo_count` — each returning exactly one row per fountain, so no row multiplication and
pagination is unchanged. `thumbnail_url` = `/api/v1/photos/{photo_id}/thumb` for that id
(null when no visible photo). Map/bbox + mobile untouched.
`FountainListRow.tsx` renders the thumbnail (`<img loading="lazy" alt>`, rounded, neutral
placeholder when null) and an optional "N photos" count. Tests cover 0/1/many photos:
stable pagination, no duplicate fountains, correct count, unchanged bbox `FountainPin`.

## 13. Mobile (`mobile/`)

- **Deps (new):** `expo-image-picker` (capture/pick; permission prompt; emits JPEG) and
  `expo-image` (cached rendering). Carousel = horizontal **`FlatList` with `pagingEnabled`**
  (native swipe; **no** reanimated/gesture-handler), page-dot indicator, empty state renders
  nothing — in `mobile/components/fountain/FountainDetail.tsx`. Images use the gated read
  paths (§8.5).
- **Upload** — "Add photo" in `mobile/app/fountains/[id].tsx`; POST multipart via
  `client.POST(".../photos")`; invalidate the photos query on success; uploader can delete
  own photo.
- **Report** — a "Report" control on each photo → dialog (category + optional note) →
  `client.POST(".../photos/{id}/report")`.
- **Moderation queue screen** — new `mobile/app/admin/reports.tsx` (admin-gated), reusing
  the mobile admin mutation pattern: reported-photos list with **Hide** / **Reject** actions.
  A **"Reports" link** on the mobile **profile screen** for admins.
- **Badge** — the profile **tab icon** shows a badge when `pending_photo_count > 0`, via a
  TanStack Query poll of `GET /admin/photo-reports/summary` (admins only, ~60s interval).
  (Exact tab/profile files pinned in the plan.)

## 14. API client (`packages/api-client/`)

After backend routes/schemas land: `pnpm run generate`; **commit** regenerated
`openapi.json` + `src/schema.d.ts` per repo convention. Web/mobile consume the generated
`PhotoOut` / `ReportedPhotoOut` / request types.

## 15. Backend dependencies (`backend/pyproject.toml`)

Add `boto3`, `Pillow`, `python-multipart`.

## 16. Infrastructure (`infra/`)

- **Terraform** (`infra/terraform/main.tf`) — add a **private** `digitalocean_spaces_bucket.photos`
  (no public-read; **no CDN** — reads are backend-presigned), gated by new
  `var.manage_photos_spaces` (default false), registered in
  `digitalocean_project_resources.main`. Local Terraform stays read-only
  (`init -backend=false`/`validate`/`fmt`/`plan`); apply is CI-only.
- **Secrets → k8s** — add `spaces-access-key`, `spaces-secret-key`, `spaces-bucket`,
  `spaces-endpoint`, `spaces-region` to `infra/k8s/secrets.yaml` (reference doc) +
  `valueFrom.secretKeyRef` env in `infra/k8s/backend.yaml`. (No `spaces-cdn-url`.)
- **Ingress body size** — set `nginx.ingress.kubernetes.io/proxy-body-size: "12m"` on the
  backend ingress (defense-in-depth over the app's 10 MB streaming cap).

### 16.1 ⚠️ Pre-deploy dependency (owner action)

`infra/terraform/main.tf` documents that the current CI Spaces key is **TF-state-scoped
and 403s on bucket create / object write**. Before production: (1) a DO Spaces key with
**bucket-create + object read/write** scope must be added to the GitHub `production`
environment secrets (and to the TF provider creds if TF-managed); (2) the private `photos`
bucket applied via the Terraform CI workflow. The feature is fully **buildable and testable
without this** (storage mocked in tests; local dev fails closed with 503). This gate blocks
only the production deploy and is called out so it is scheduled, not discovered at deploy.

## 17. Testing (mirrors CI)

- **Backend (pytest, Spaces mocked — no real network in CI):**
  - upload: JPEG/PNG/WebP accepted & re-encoded to JPEG; oversized → 413 (streaming cap);
    non-image/SVG/animated → 415; EXIF/GPS stripped from output; per-fountain + per-user
    visible caps → 409; upload attempt-rate + success-quota → 429 via the `upload_attempt`
    reservation; **concurrent** uploads from one user are rejected **before**
    `put_object`/Pillow runs (reservation gate) and can never commit past the quota;
    **repeated invalid (415) and repeated cap-conflict (409) uploads still hit 429** once
    the attempt-rate window fills (failed attempts count); a `reserved` row is finalized to
    `completed`/`failed`; expired reservations don't consume quota; `photos_enabled=false` →
    503; **orphan cleanup** writes a `storage_cleanup` row on a post-upload conflict; no
    lock held across S3/CPU work.
  - read gate: visible → 302 to presigned; hidden → 404; unknown id → 404.
  - list: hidden excluded; ordering.
  - delete: owner deletes; non-owner → 403; object delete failure → 5xx (no silent
    success); point reversal + report resolution invoked.
  - report: any signed-in user reports; **duplicate pending → idempotent 204 and the
    session still commits** (ON CONFLICT DO NOTHING, no poisoned txn); report rate → 429;
    **concurrent** reports from one user cannot commit past the quota; category validated;
    note length bound; report on hidden photo allowed; note never logged.
  - admin queue: grouped-by-photo, pending-only, oldest-first, paginated; note truncation +
    max-3; summary count correct; hide resolves reports + reverses point + read 404s;
    unhide re-awards; dismiss-reports rejects + keeps photo; delete resolves + reverses +
    hard removal; audit logs carry no PII; non-admin → 403.
  - points: first photo awards `photo_first:{fountain_id}`; second does not; reversal on
    hide/delete; re-award on unhide; **no unrelated fountain contributions reversed**;
    hide-twice/unhide-twice idempotent.
  - city list: `photo_count` + `thumbnail_url` correct with 0/1/many photos; stable
    pagination; no duplicate fountains; null when none; map/bbox `FountainPin` unchanged.
  - migrations: `alembic upgrade head` + `alembic check` clean; both revisions downgrade.
- **Web/mobile:** `pnpm exec turbo run lint typecheck test --filter=web|mobile`;
  `FountainListRow` thumbnail render/placeholder test; badge renders on pending count > 0;
  web build clean.

## 18. Open decisions for spec review

1. **City-list thumbnail = most-recent visible photo** (vs the awarded first photo).
2. **Numbers:** caps 20/fountain, 5/user/fountain; 10 MB; 2048px/400px; upload attempt-rate
   10/min + 60/day, successful-upload quota 30/day; report 20/min + 100/day; presign TTL
   600s; reservation TTL 120s. All tunable — confirm the ballpark.
3. **Un-hide re-awards** the first-photo point (symmetric with hide reversing it).
4. **Report categories:** `inappropriate` / `not_a_fountain` / `spam` / `other` + optional
   note.
5. **Badge = distinct photos with pending reports**, polled ~60s by admin clients (no
   realtime/websocket).
6. **Per-IP throttling + new-account trust tiers deferred** to a future release (§6
   rationale) — confirm that's acceptable for launch.
