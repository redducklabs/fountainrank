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
repo accepting arbitrary user-uploaded images**, storage, permissions, validation, and
moderation — including a user-facing report path — are designed here **before** any code.

**In scope:**

- A `FountainPhoto` table (child of fountain), mirroring `FountainNote`'s shape incl.
  the moderation triple.
- DigitalOcean **Spaces** object storage + a **backend-proxied** upload endpoint that
  validates, strips EXIF, re-encodes, and thumbnails each image.
- Public list endpoint + a carousel on **web** (overlaid left/right arrows) and
  **mobile** (native swipe).
- **Post-moderation**: photos are visible immediately; only authenticated (non-anonymous)
  users may upload.
- A user-facing **report** button on every photo → a `PhotoReport` record.
- An admin **moderation queue** (list of reported photos) reachable from a **"Reports"
  link on the profile page** on **both web and mobile**, where an admin can **hide the
  photo** or **reject the report(s)**.
- A **badge on the profile icon** (web header + mobile tab) whenever the pending report
  queue is non-empty.
- A **first-photo-per-fountain** contribution point (reversed on hide/delete).
- A representative **thumbnail + photo count on the web city fountain list** (web only).

**Out of scope (explicitly):**

- Pre-moderation approval queue; automated/AI content scanning (post-moderation +
  user-report queue only).
- Reporting/moderation of non-photo content (notes, fountains) — that remains the broader
  #11/#12 work; this release covers **photos only**.
- HEIC decoding server-side (mobile picker emits JPEG; web input accepts JPEG/PNG/WebP).
- Photo thumbnails on the **map/bbox** pins or the **mobile** city list, or in the
  `FountainDetail` payload — web city list only.
- Points transferring to the "next" photo when an awarded photo is removed.
- Presigned direct-to-Spaces uploads (backend proxy only, this batch).

**Platforms:** upload, carousel, report button, moderation queue, and badge = web **and**
mobile. City-list thumbnail = web only.

## 2. Moderation posture & threat model

The animating risk of accepting user images in a public repo is illegal or abusive
content becoming publicly hosted under our domain. Mitigations:

1. **Authenticated uploaders only** — `require_named_user` (the gate contributions use):
   the account must exist and have a non-"Anonymous" display name, giving every photo an
   accountable owner.
2. **Server-side validation before publish** — the backend proxies the bytes, verifies
   they decode as a real image (Pillow, with a decompression-bomb guard), **re-encodes to
   JPEG** (stripping EXIF incl. GPS), and generates a thumbnail. Arbitrary bytes never
   reach storage; only our re-encoded output does.
3. **User report path** — any signed-in user can flag a photo; reports feed an admin
   queue with a visible badge, so bad content is surfaced by the community, not left to
   chance.
4. **Fast admin removal** — from the queue an admin hides (soft, reversible) or the photo
   can be deleted (hard); public reads filter `is_hidden = false`.
5. **Point disincentive** — only the *first* photo on a fountain earns a point, so there
   is no volume-farming incentive (see §7).

Post-moderation means a small exposure window before an admin acts; the report queue +
badge minimize it. That is the accepted trade-off versus a pre-moderation queue.

## 3. Data model

Two new tables. Deterministic constraint/index names per the repo's `NAMING_CONVENTION`.
Migrations `backend/migrations/versions/0017_fountain_photos.py` and
`0018_photo_reports.py` (mirroring `0008_fountain_notes.py`).

### 3.1 `FountainPhoto` (`fountain_photos`)

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `fountain_id` | UUID FK → `fountains.id` | `ondelete=CASCADE`, indexed |
| `user_id` | UUID FK → `users.id` | `ondelete=CASCADE` (uploader) |
| `storage_key` | text | Spaces object key of the full image |
| `thumbnail_key` | text | Spaces object key of the thumbnail |
| `content_type` | text | always `image/jpeg` post-processing |
| `width` / `height` | int | processed full-image dimensions |
| `byte_size` | int | processed full-image size in bytes |
| `is_hidden` | bool | `server_default false` |
| `hidden_by_user_id` | UUID FK → `users.id` nullable | set on admin hide |
| `hidden_at` | timestamptz nullable | set on admin hide |
| `created_at` / `updated_at` | timestamptz | `server_default now()` |

- Partial index `WHERE is_hidden = false` on `(fountain_id, created_at DESC)` — serves the
  public list and the city-list "most recent visible photo" lookup.
- **No** `unique(fountain_id, user_id)` — many photos per fountain; a user may add more
  than one (bounded by the per-user cap, §6).
- Store **keys**, not URLs; URLs composed at read time from `spaces_cdn_base_url`.

### 3.2 `PhotoReport` (`photo_reports`)

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `photo_id` | UUID FK → `fountain_photos.id` | `ondelete=CASCADE`, indexed |
| `reporter_user_id` | UUID FK → `users.id` | `ondelete=CASCADE` |
| `category` | text | one of `inappropriate` / `not_a_fountain` / `spam` / `other` |
| `note` | text nullable | optional short free-text (length-bounded) |
| `status` | text | `pending` / `resolved`, `server_default 'pending'` |
| `resolution` | text nullable | set on resolve: `hidden` / `rejected` |
| `resolved_by_user_id` | UUID FK → `users.id` nullable | admin who resolved |
| `resolved_at` | timestamptz nullable | |
| `created_at` | timestamptz | `server_default now()` |

- **Partial unique** index `unique(photo_id, reporter_user_id) WHERE status = 'pending'`
  — one *pending* report per user per photo (a user may re-report after a prior report is
  resolved).
- Partial index `WHERE status = 'pending'` on `(photo_id)` — powers the queue + badge
  count.

## 4. Object storage (`backend/app/storage.py`, new)

A small module wrapping a `boto3` S3 client pointed at DO Spaces (S3-compatible). New
`Settings` fields in `backend/app/config.py` (fail-closed `*_enabled` idiom used by
`geocoding_enabled`/`email_configured`):

- `spaces_endpoint`, `spaces_region`, `spaces_bucket`, `spaces_access_key`,
  `spaces_secret_key`, `spaces_cdn_base_url`, plus `@property photos_enabled` (true only
  when bucket + creds + endpoint all set).

Surface: `put_object(key, data, content_type)` (uploads `ACL="public-read"`, long
`Cache-Control`); `delete_objects(keys)` (best-effort); `public_url(key)`. Object keys:
`fountains/{fountain_id}/{photo_id}.jpg` and `..._thumb.jpg`.

`boto3` is **synchronous**; every storage call is invoked from the async endpoints via
Starlette's `run_in_threadpool` (a.k.a. `anyio.to_thread`) so it never blocks the event
loop. The client is constructed once at module import and reused.

When `photos_enabled` is false (e.g. local dev without creds), the upload endpoint returns
**503** (`photo_uploads_unavailable`) and logs a warning — fails closed, never silent.

## 5. Image processing pipeline

On upload, in-process (Pillow): (1) **size guard** before decoding (413); (2) **decode &
verify** with a decompression-bomb guard (`Image.MAX_IMAGE_PIXELS`), reject non-images
(415); (3) **normalize** — RGB, apply EXIF orientation, then re-encode dropping all
metadata (strips EXIF/GPS by construction); (4) **downscale** full image to max long edge
**2048px**, JPEG q≈85; (5) **thumbnail** max long edge **400px**, JPEG q≈80; (6) **store**
full then thumbnail (best-effort delete the first if the second fails, to avoid orphans);
(7) **persist** the row. Every step logs structured events (fountain/user id, byte sizes,
outcome); failures log WARNING/ERROR with context. The Pillow decode/resize/encode work
is CPU-bound and blocking, so — like the storage calls (§4) — the whole pipeline runs off
the event loop via `run_in_threadpool`.

## 6. Limits & validation

- **Accepted input** (web `accept`): JPEG, PNG, WebP; mobile picker emits JPEG. Server
  re-encodes to JPEG; other types → 415.
- **Max upload size:** 10 MB (413).
- **Per-fountain visible cap:** 20 (409 `photo_limit_fountain`).
- **Per-user-per-fountain cap:** 5 (409 `photo_limit_user`).

Caps checked against `is_hidden = false` counts in the same transaction that inserts the
row, under a row lock on the parent fountain (`with_for_update`) to avoid a
concurrent-insert race past the cap.

## 7. Points — first photo per fountain

On a successful upload, if the fountain has **no other visible photo** at insert time,
emit one `ContributionEvent` (dedup key `photo_first:{fountain_id}`, per the `dk_*`
convention in `backend/app/contributions.py`). Rules:

- One-time per fountain, tied to the specific awarded photo.
- **Hiding or deleting** the awarded photo **reverses** the point
  (`reverse_contributions` scoped to that event); this extends the current
  delete-only behavior. **Un-hiding re-awards** (re-emits the same dedup-keyed event).
- If the awarded photo is removed, the award does **not** auto-transfer to the next photo
  (kept idempotent and simple).

## 8. Photo endpoints (`backend/app/routers/photos.py`, new; registered in `main.py`)

Under `APIRouter(prefix="/api/v1")`. Schemas in `backend/app/schemas.py`.

### 8.1 `POST /fountains/{fountain_id}/photos`
Auth `require_named_user`; `multipart/form-data` single `file` (`UploadFile`, needs the
new `python-multipart` dep). Loads parent (`is_hidden=false`, `with_for_update`) → 404;
enforces caps → 409; runs the pipeline (§5); inserts; awards first-photo point (§7);
commits; returns `PhotoOut`. Failure modes: 401/403, 404, 409, 413, 415, 503.

### 8.2 `GET /fountains/{fountain_id}/photos`
Public. Visible photos (`is_hidden=false`) ordered `created_at DESC` → `list[PhotoOut]`.

### 8.3 `DELETE /fountains/{fountain_id}/photos/{photo_id}`
Auth `require_named_user`, **ownership enforced** (`photo.user_id == user.id`) → 403.
Deletes Spaces objects + row, reverses the first-photo point if this was the awarded
photo, resolves any pending reports on it. Returns 204.

### 8.4 `PhotoOut`
```
class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str            # public_url(storage_key)
    thumbnail_url: str  # public_url(thumbnail_key)
    width: int
    height: int
    uploaded_by: str | None   # uploader display name
    created_at: datetime
```

## 9. Reporting (user endpoint)

### 9.1 `POST /fountains/{fountain_id}/photos/{photo_id}/report`
Auth `get_current_user` (**any signed-in user**, display name not required — reporting is
protective and must not be gated behind the name requirement). Body:
```
class ReportPhotoRequest(BaseModel):
    category: Literal["inappropriate", "not_a_fountain", "spam", "other"]
    note: str | None = None   # length-bounded
```
Behavior: 404 if the photo does not exist / is deleted. Insert a `PhotoReport` (status
`pending`). The partial-unique index makes a duplicate pending report by the same user a
no-op — caught and returned as **idempotent 204** (not a hard 409, so the UI can show
"already reported"). Structured log (`photo_id`, `reporter`, `category`). Returns 204.

Reporting a **hidden** photo is allowed (the reporter may not know it is hidden); it still
records a report but does not change visibility.

## 10. Admin moderation & queue (`backend/app/routers/admin.py`, extend)

Router carries `dependencies=[Depends(require_admin)]` + the `_admin_context` audit
helper. Add:

### 10.1 Queue list — `GET /admin/photo-reports`
Returns **reported photos grouped by photo** (a photo with N pending reports appears
once), pending only, oldest-first (by earliest pending report). Paginated
(`limit`/`offset`). Each item (`ReportedPhotoOut`): photo id, `url`, `thumbnail_url`,
`fountain_id`, `is_hidden`, `report_count`, distinct `categories`, a few recent `notes`,
`first_reported_at`, uploader display name.

### 10.2 Badge count — `GET /admin/photo-reports/summary`
Lightweight: `{ "pending_photo_count": int }` = number of distinct photos with ≥1 pending
report. Clients poll this (admins only) for the profile-icon badge.

### 10.3 Hide — `PATCH /admin/photos/{photo_id}`
Body `{ "is_hidden": bool }`. Clones `admin_patch_note`: flips `is_hidden`, stamps
`hidden_by_user_id`/`hidden_at` on hide (clears on unhide). On **hide**: resolve all this
photo's pending reports as `resolution="hidden"` and **reverse** the first-photo point; on
**unhide**: **re-award** the point (reports already resolved stay resolved). Structured
audit log (`target_type="photo"`).

### 10.4 Reject reports — `POST /admin/photos/{photo_id}/dismiss-reports`
Resolve all pending reports for the photo as `resolution="rejected"` (photo stays
visible), stamping `resolved_by_user_id`/`resolved_at`. Structured audit log. Returns 204.

### 10.5 Delete — `DELETE /admin/photos/{photo_id}`
Delete Spaces objects + row, reverse the first-photo point, resolve pending reports
(cascade removes them). Structured audit log.

## 11. Web (`web/`)

- **Carousel** — `web/components/fountain/PhotoCarousel.tsx` (client). Photos with
  **left/right arrows overlaid, vertically centered on the image edges** (issue AC),
  keyboard-navigable, index indicator, wraps. **Empty state renders nothing.** Slots near
  the top of `web/components/fountain/FountainDetail.tsx`.
- **Report control** — a "Report" affordance on each carousel photo → a small dialog
  (category select + optional note) → new `reportPhoto` **server action**
  (`web/app/actions/contribute.ts`). Auth-gated; shows "Reported/Already reported".
- **Upload** — auth-gated file input in `ContributeSection` → new `uploadPhoto` server
  action; client-side progress/errors; uploader sees a **delete** control on own photos.
- **Data** — `getFountainPhotosServer(...)` in `web/lib/fountains.ts` (`GET
  /fountains/{id}/photos`), passed into `FountainDetail`.
- **Moderation queue page** — new `web/app/admin/reports/page.tsx` (server component,
  admin-gated via the existing admin server helpers): the reported-photos list with each
  photo, report count/categories/notes, and **Hide** / **Reject** buttons wired to
  `PATCH /admin/photos/{id}` and `POST /admin/photos/{id}/dismiss-reports` (server
  actions). A **"Reports" link** is added to the **account page** for admin users.
- **Badge** — the header user-menu/avatar shows a badge when
  `pending_photo_count > 0`. A small client component polls `GET
  /admin/photo-reports/summary` (only when the current user is admin) on an interval
  (~60s) and renders the count. (Exact header/nav file pinned in the plan.)
- **Style guide** — add the carousel, overlaid arrow button, list-row thumbnail, report
  dialog, queue row, and badge to `docs/style-guide.md` before implementing.

## 12. Web city fountain list — `CityFountainPin` (web only)

`FountainPin` is shared by the map **bbox** hot path, so it is **not** modified. Instead a
new schema `CityFountainPin(FountainPin)` adds `photo_count: int` and
`thumbnail_url: str | None`; `CityFountainsOut.fountains` becomes `list[CityFountainPin]`.
`city_fountains` (`backend/app/routers/places.py`) gains a **LEFT JOIN LATERAL** selecting
the most-recent visible photo's `thumbnail_key` (`is_hidden=false`, `created_at DESC LIMIT
1`) + a **count** of visible photos per fountain; `thumbnail_url = public_url(...)` (null
when none). Bounded by the endpoint's `limit ≤ 500`, so cheap; map/bbox + mobile untouched.
`FountainListRow.tsx` renders the thumbnail (`<img loading="lazy" alt>`, rounded, with a
neutral placeholder when null) and an optional "N photos" count.

## 13. Mobile (`mobile/`)

- **Deps (new):** `expo-image-picker` (capture/pick; permission prompt; emits JPEG) and
  `expo-image` (cached rendering). Carousel = horizontal **`FlatList` with
  `pagingEnabled`** (native swipe; **no** reanimated/gesture-handler), page-dot indicator,
  empty state renders nothing — in `mobile/components/fountain/FountainDetail.tsx`.
- **Upload** — "Add photo" in `mobile/app/fountains/[id].tsx`; POST multipart via
  `client.POST(".../photos")`; invalidate the photos query on success; uploader can delete
  own photo.
- **Report** — a "Report" control on each photo → dialog (category + optional note) →
  `client.POST(".../photos/{id}/report")`.
- **Moderation queue screen** — new `mobile/app/admin/reports.tsx` (admin-gated),
  reusing the mobile admin mutation pattern: reported-photos list with **Hide** / **Reject**
  actions. A **"Reports" link** on the mobile **profile screen** for admins.
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

- **Terraform** (`infra/terraform/main.tf`) — add `digitalocean_spaces_bucket.photos`,
  `digitalocean_spaces_bucket_cors_configuration.photos` (browser **GET** origins), and
  `digitalocean_cdn.photos`, gated by new `var.manage_photos_spaces` (default false),
  registered in `digitalocean_project_resources.main` — copying the `.basemap` block.
  Local Terraform stays read-only; apply is CI-only.
- **Secrets → k8s** — add `spaces-access-key`, `spaces-secret-key`, `spaces-bucket`,
  `spaces-endpoint`, `spaces-region`, `spaces-cdn-url` to `infra/k8s/secrets.yaml`
  (reference doc) + `valueFrom.secretKeyRef` env in `infra/k8s/backend.yaml`.

### 16.1 ⚠️ Pre-deploy dependency (owner action)

`infra/terraform/main.tf` documents that the current CI Spaces key is **TF-state-scoped
and 403s on bucket create / object write**. Before production: (1) a DO Spaces key with
**bucket-create + object read/write** scope must be added to the GitHub `production`
environment secrets (and to the TF provider creds if TF-managed); (2) the `photos` bucket
+ CDN applied via the Terraform CI workflow. The feature is fully **buildable and testable
without this** (storage mocked in tests; local dev fails closed with 503). This gate
blocks only the production deploy and is called out so it is scheduled, not discovered at
deploy time.

## 17. Testing (mirrors CI)

- **Backend (pytest, Spaces mocked — no real network in CI):**
  - upload: JPEG/PNG/WebP accepted & re-encoded to JPEG; oversized → 413; non-image → 415;
    EXIF/GPS stripped from output; per-fountain + per-user caps → 409;
    `photos_enabled=false` → 503.
  - list: hidden excluded; ordering.
  - delete: owner deletes; non-owner → 403; Spaces delete + point reversal + report
    resolution invoked.
  - report: any signed-in user reports; duplicate pending → idempotent 204; category
    validated; report on hidden photo allowed.
  - admin queue: grouped-by-photo, pending-only, oldest-first, paginated; summary count
    correct; hide resolves reports + reverses point; unhide re-awards; dismiss-reports
    rejects + keeps photo; delete resolves + reverses; audit logs emitted; non-admin → 403.
  - points: first photo awards `photo_first:{fountain_id}`; second does not; reversal on
    hide/delete; re-award on unhide.
  - city list: `photo_count` + `thumbnail_url` populated; null when none; map/bbox pins
    unchanged.
  - migrations: `alembic upgrade head` + `alembic check` clean.
- **Web/mobile:** `pnpm exec turbo run lint typecheck test --filter=web|mobile`;
  `FountainListRow` thumbnail render/placeholder test; badge renders on pending count > 0;
  web build clean.

## 18. Open decisions for spec review

1. **City-list thumbnail = most-recent visible photo** (vs the awarded first photo) —
   chosen for freshness.
2. **Caps: 20/fountain, 5/user/fountain; 10 MB; 2048px/400px.** Confirm the numbers.
3. **Un-hide re-awards the first-photo point** (symmetric with hide reversing it).
4. **Report categories:** `inappropriate` / `not_a_fountain` / `spam` / `other` + optional
   note. Confirm the set.
5. **Badge count = distinct photos with pending reports**, polled ~60s by admin clients
   (no realtime/websocket). Confirm the polling approach.
6. **Duplicate pending report = idempotent 204** (UI shows "already reported") rather than
   a hard error. Confirm.
