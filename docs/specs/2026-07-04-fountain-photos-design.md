# Fountain photo uploads + image carousel — design

Design spec for GitHub issue **#167** (support fountain photo uploads and an image
carousel on detail pages, web + mobile). Ships as its own branch/PR — it is greenfield
on the object-storage/upload axis and independent of the other open backlog items.

## 1. Problem & scope

Users can rate, comment on, and report the condition of a fountain, but they cannot
**show** it. #167 adds user-contributed photos: a signed-in user uploads a picture of a
fountain, the picture is stored durably, and every fountain-detail page (web + mobile)
displays that fountain's photos in a carousel. Because this is a **public, open-source
repo accepting arbitrary user-uploaded images**, storage, permissions, validation, and
moderation are designed here **before** any code.

**In scope:**

- A `FountainPhoto` table (child of fountain), mirroring `FountainNote`'s shape incl.
  the moderation triple.
- DigitalOcean **Spaces** object storage for the image bytes + a **backend-proxied**
  upload endpoint that validates, strips EXIF, re-encodes, and thumbnails each image.
- Public list endpoint + a carousel on **web** (overlaid left/right arrows) and
  **mobile** (native swipe).
- **Post-moderation**: photos are visible immediately; admins reactively hide/delete via
  extended admin endpoints; only authenticated (non-anonymous) users may upload.
- A **first-photo-per-fountain** contribution point (reversed on hide/delete).
- A representative **thumbnail + photo count on the web city fountain list** (web only).

**Out of scope (explicitly):**

- Pre-moderation approval queue; automated/AI content scanning (post-moderation only).
- A user-facing "report photo" flow (that belongs to the deferred #11/#12 moderation
  cluster; admins already have direct removal here).
- HEIC decoding server-side (the mobile picker emits JPEG; the web input accepts
  JPEG/PNG/WebP).
- Photo thumbnails on the **map/bbox** pins or the **mobile** city list, or in the
  `FountainDetail` payload — web city list only.
- Points transferring to the "next" photo when an awarded photo is removed.
- Presigned direct-to-Spaces uploads (backend proxy only, this batch).

**Platforms:** upload + carousel = web **and** mobile. City-list thumbnail = web only.

## 2. Moderation posture & threat model

The animating risk of accepting user images in a public repo is illegal or abusive
content becoming publicly hosted under our domain. Mitigations chosen:

1. **Authenticated uploaders only** — `require_named_user` (the same gate contributions
   use): the account must exist and have a non-"Anonymous" display name, giving every
   photo an accountable owner.
2. **Server-side validation before publish** — the backend proxies the bytes, verifies
   they decode as a real image (Pillow, with a decompression-bomb guard), **re-encodes
   to JPEG** (which strips EXIF including GPS), and generates a thumbnail. Arbitrary
   bytes never reach storage; only our re-encoded output does.
3. **Reactive removal** — admins hide (soft, reversible) or delete (hard) any photo
   immediately via extended admin endpoints; public reads filter `is_hidden = false`.
4. **Point disincentive** — only the *first* photo on a fountain earns a point, so
   there is no volume-farming incentive (see §7).

Post-moderation means a small exposure window before an admin acts; that is the accepted
trade-off (consistent with how notes work today) versus building a pre-moderation queue.

## 3. Data model — `FountainPhoto`

New table `fountain_photos`, migration `backend/migrations/versions/0017_fountain_photos.py`
(mirrors `0008_fountain_notes.py`; deterministic constraint/index names per the repo's
`NAMING_CONVENTION`). Columns:

| column | type | notes |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `fountain_id` | UUID FK → `fountains.id` | `ondelete=CASCADE`, indexed |
| `user_id` | UUID FK → `users.id` | `ondelete=CASCADE` (uploader) |
| `storage_key` | text | Spaces object key of the full image |
| `thumbnail_key` | text | Spaces object key of the thumbnail |
| `content_type` | text | always `image/jpeg` post-processing |
| `width` | int | processed full-image width |
| `height` | int | processed full-image height |
| `byte_size` | int | processed full-image size in bytes |
| `is_hidden` | bool | `server_default false` |
| `hidden_by_user_id` | UUID FK → `users.id` nullable | set on admin hide |
| `hidden_at` | timestamptz nullable | set on admin hide |
| `created_at` / `updated_at` | timestamptz | `server_default now()` |

- Partial index `WHERE is_hidden = false` on `(fountain_id, created_at DESC)` to serve
  the public list and the city-list "most recent visible photo" lookup efficiently.
- **No** `unique(fountain_id, user_id)` — a fountain has many photos; a user may add
  more than one (bounded by the per-user cap in §6).
- We store **keys**, not full URLs, so the CDN host/base can change without a migration;
  URLs are composed at read time from `settings.spaces_cdn_base_url`.

`FountainPhoto` is added to `backend/app/models.py` alongside `FountainNote`.

## 4. Object storage (`backend/app/storage.py`, new)

A small storage module wrapping a `boto3` S3 client pointed at DO Spaces
(S3-compatible). Config (new `Settings` fields in `backend/app/config.py`, following the
fail-closed `*_enabled` idiom used by `geocoding_enabled`/`email_configured`):

- `spaces_endpoint` (e.g. `https://nyc3.digitaloceanspaces.com`)
- `spaces_region` (e.g. `nyc3`)
- `spaces_bucket`
- `spaces_access_key`, `spaces_secret_key` (secret; default `None`)
- `spaces_cdn_base_url` (public read base, e.g. `https://<bucket>.<region>.cdn.digitaloceanspaces.com`)
- `@property photos_enabled` → true only when bucket + creds + endpoint are all set.

Module surface:

- `put_object(key, data, content_type)` → uploads with `ACL="public-read"` and a long
  `Cache-Control`.
- `delete_objects(keys)` → best-effort delete of full + thumbnail on removal.
- `public_url(key)` → `f"{spaces_cdn_base_url}/{key}"`.

Object keys: `fountains/{fountain_id}/{photo_id}.jpg` (full) and
`fountains/{fountain_id}/{photo_id}_thumb.jpg` (thumbnail).

When `photos_enabled` is false (e.g. local dev without Spaces creds), the upload endpoint
returns **503** with a clear `detail` (`photo_uploads_unavailable`) and logs a warning —
it fails closed, never silently.

## 5. Image processing pipeline

On upload, in-process (Pillow):

1. **Size guard** — reject payloads over the max (§6) before decoding (413).
2. **Decode & verify** — `Image.open(...)`; guard against decompression bombs
   (`Image.MAX_IMAGE_PIXELS`); reject anything that does not decode as an image (415).
3. **Normalize** — convert to RGB, apply EXIF orientation, then **drop all metadata** by
   re-encoding. This strips EXIF/GPS by construction.
4. **Downscale** — full image to a max long edge of **2048px** (preserve aspect); encode
   JPEG quality ~85.
5. **Thumbnail** — max long edge **400px**, JPEG quality ~80.
6. **Store** — `put_object` full then thumbnail; on the second failing, best-effort
   delete the first to avoid orphans.
7. **Persist** — insert the `FountainPhoto` row with processed dimensions/size/keys.

All steps log structured events (fountain id, user id, byte sizes, outcome); failures log
at WARNING/ERROR with context so an upload issue is diagnosable from logs alone.

## 6. Limits & validation

- **Accepted input** (web input `accept`): JPEG, PNG, WebP. Mobile picker emits JPEG.
  Server accepts any of the three and re-encodes to JPEG; other types → 415.
- **Max upload size:** 10 MB (413 past it).
- **Per-fountain visible cap:** 20 (409 `photo_limit_fountain` past it).
- **Per-user-per-fountain cap:** 5 (409 `photo_limit_user` past it).

Caps are checked against `is_hidden = false` counts inside the same transaction that
inserts the row, under a row lock on the parent fountain (`with_for_update`) to avoid a
concurrent-insert race past the cap.

## 7. Points — first photo per fountain

On a successful upload, if the fountain has **no other visible photo** at insert time,
emit one `ContributionEvent` awarding the uploader via
`record_contributions(...)` with dedup key **`photo_first:{fountain_id}`** (idempotent,
per the existing `dk_*` convention in `backend/app/contributions.py`). Rules:

- The award is one-time per fountain, tied to the specific awarded photo.
- **Hiding or deleting** the awarded photo **reverses** the point
  (`reverse_contributions` scoped to that event). This extends the current behavior,
  where only *delete* reverses — for photos, hide reverses too, and **un-hide re-awards**
  (re-emits the same dedup-keyed event).
- If the awarded photo is removed, the award does **not** auto-transfer to the next
  photo (kept idempotent and simple; noted as a deliberate limitation).

## 8. Backend endpoints (`backend/app/routers/photos.py`, new; registered in `main.py`)

All under the existing `APIRouter(prefix="/api/v1")`. Pydantic schemas in
`backend/app/schemas.py`.

### 8.1 `POST /fountains/{fountain_id}/photos`
- Auth: `Depends(require_named_user)`. Body: `multipart/form-data` with a single
  `file` (`UploadFile`; requires the new `python-multipart` dep).
- Loads the parent fountain (`is_hidden = false`, `with_for_update`) → 404 if missing.
- Enforces caps (§6) → 409. Runs the pipeline (§5). Inserts the row. Awards the
  first-photo point if applicable (§7). Commits. Returns `PhotoOut`.
- Failure modes: 401/403 (auth), 404 (fountain), 409 (caps), 413 (too big), 415
  (not an image), 503 (`photos_enabled` false).

### 8.2 `GET /fountains/{fountain_id}/photos`
- Public. Returns visible photos (`is_hidden = false`) ordered `created_at DESC` as
  `list[PhotoOut]`.

### 8.3 `DELETE /fountains/{fountain_id}/photos/{photo_id}`
- Auth: `require_named_user`; **ownership enforced** (`photo.user_id == user.id`) → 403
  otherwise. Deletes Spaces objects (full + thumb), deletes the row, reverses the
  first-photo point if this was the awarded photo. Returns 204.

### 8.4 Schemas
```
class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str            # public_url(storage_key)
    thumbnail_url: str  # public_url(thumbnail_key)
    width: int
    height: int
    uploaded_by: str | None   # uploader display name (null if since cleared)
    created_at: datetime
```

## 9. Admin moderation (`backend/app/routers/admin.py`, extend)

Router already carries `dependencies=[Depends(require_admin)]` and the `_admin_context`
audit-log helper. Add:

- `PATCH /admin/photos/{photo_id}` — body `{ "is_hidden": bool }`. Clones
  `admin_patch_note`: flips `is_hidden`, stamps `hidden_by_user_id = admin.id` +
  `hidden_at = now()` on hide (clears on unhide). **Reverses the first-photo point on
  hide, re-awards on unhide** (§7). Structured audit log with `target_type="photo"`.
- `DELETE /admin/photos/{photo_id}` — deletes Spaces objects + row + reverses the
  first-photo point. Structured audit log.

## 10. Web (`web/`)

- **Carousel** — new client component `web/components/fountain/PhotoCarousel.tsx`.
  Renders `PhotoOut[]` with **left/right arrow buttons overlaid, vertically centered on
  the left and right edges of the image** (the issue's exact AC). Keyboard-navigable
  (arrow keys, focusable controls, `aria-label`s), dot/index indicator, wraps at ends.
  **Empty state:** renders nothing (no broken box). Slots near the top of
  `web/components/fountain/FountainDetail.tsx`, above the rating hero.
- **Data** — the web detail page (`web/app/fountains/[id]/page.tsx`, a server component)
  adds a `getFountainPhotosServer(...)` helper (in `web/lib/fountains.ts`) calling
  `GET /fountains/{id}/photos`, passed into `FountainDetail`.
- **Upload** — an auth-gated file input in `ContributeSection` wired to a new
  `uploadPhoto` **server action** in `web/app/actions/contribute.ts` (web writes go
  through server actions, not the api-client). Shows client-side progress/errors and
  refreshes on success. The uploader sees a **delete** control on their own photos.
- **City-list thumbnail (web only)** — `FountainListRow.tsx` renders the row's
  `thumbnail_url` (a small rounded image, `<img>` with `loading="lazy"` + `alt`) with a
  neutral **placeholder** when null, and an optional "N photos" count. Type flows from
  the new `CityFountainPin` schema (§11).
- **Style guide** — add the carousel, overlaid arrow button, and list-row thumbnail to
  `docs/style-guide.md` before implementing them.

## 11. Web city fountain list — `CityFountainPin` (web only)

`FountainPin` is shared by the map **bbox** hot path, so it is **not** modified. Instead:

- New schema `CityFountainPin(FountainPin)` adds `photo_count: int` and
  `thumbnail_url: str | None`. `CityFountainsOut.fountains` becomes
  `list[CityFountainPin]`.
- `city_fountains` (`backend/app/routers/places.py`) gains, per returned fountain:
  a **LEFT JOIN LATERAL** selecting the most-recent visible photo's `thumbnail_key`
  (`is_hidden = false`, `created_at DESC LIMIT 1`) and a **count** of that fountain's
  visible photos. `thumbnail_url = public_url(thumbnail_key)` (null when no photo).
- Bounded by the endpoint's existing `limit ≤ 500`, so the extra per-row lateral is
  cheap; the map/bbox and mobile endpoints are untouched.

## 12. Mobile (`mobile/`)

- **Deps (new):** `expo-image-picker` (capture/pick; requests permission; emits JPEG,
  which sidesteps HEIC) and `expo-image` (cached, performant rendering). **No**
  `react-native-reanimated`/`gesture-handler` — the carousel is a horizontal
  **`FlatList` with `pagingEnabled`** for native swipe, keeping the dep footprint small.
- **Carousel** — renders in `mobile/components/fountain/FountainDetail.tsx` near the top;
  swipeable, page-dot indicator, empty state renders nothing.
- **Upload** — a "Add photo" control in `mobile/app/fountains/[id].tsx`; on pick, POST
  multipart via the api-client `client.POST("/api/v1/fountains/{fountain_id}/photos")`,
  invalidate the photos query on success. Uploader can delete their own photo.

## 13. API client (`packages/api-client/`)

After the backend routes/schemas land: `pnpm run generate` (dumps OpenAPI →
`openapi.json`, regenerates `src/schema.d.ts`). **Commit** both regenerated artifacts per
repo convention. Web/mobile then consume `components["schemas"]["PhotoOut"]` etc.

## 14. Backend dependencies (`backend/pyproject.toml`)

Add `boto3`, `Pillow`, `python-multipart`.

## 15. Infrastructure (`infra/`)

- **Terraform** (`infra/terraform/main.tf`) — add `digitalocean_spaces_bucket.photos`,
  `digitalocean_spaces_bucket_cors_configuration.photos` (browser **GET** origins; no PUT
  needed since the backend proxies bytes), and `digitalocean_cdn.photos`, gated by a new
  `var.manage_photos_spaces` (default false), and register them in
  `digitalocean_project_resources.main` — copying the existing `.basemap` block. Local
  Terraform stays read-only (`init -backend=false` / `validate` / `fmt` / `plan`); apply
  is CI-only.
- **Secrets → k8s** — add `spaces-access-key`, `spaces-secret-key`, `spaces-bucket`,
  `spaces-endpoint`, `spaces-region`, `spaces-cdn-url` to `infra/k8s/secrets.yaml`
  (reference-only doc) and corresponding `valueFrom.secretKeyRef` env entries in
  `infra/k8s/backend.yaml` (secret `fountainrank-secrets`, created imperatively by CI
  from the GitHub `production` environment).

### 15.1 ⚠️ Pre-deploy dependency (owner action)

`infra/terraform/main.tf` documents that the current CI Spaces key is **TF-state-scoped
and 403s on bucket create / object write**. Before this feature can reach production:

1. A DO Spaces access key with **bucket-create + object read/write** scope must exist and
   be added to the GitHub `production` environment secrets (and to the Terraform provider
   creds if the bucket is TF-managed).
2. The `photos` bucket + CDN must be applied via the Terraform CI workflow.

The feature is fully **buildable and testable without this** (storage is mocked in tests;
local dev fails closed with 503). This gate blocks only the production deploy, and is
called out so it is scheduled, not discovered at deploy time.

## 16. Testing (mirrors CI)

- **Backend (pytest, Spaces mocked — no real network in CI):**
  - upload: valid JPEG/PNG/WebP accepted & re-encoded to JPEG; oversized → 413;
    non-image → 415; EXIF/GPS stripped from output; per-fountain and per-user caps → 409;
    `photos_enabled=false` → 503.
  - list: hidden photos excluded; ordering.
  - delete: owner can delete; non-owner → 403; Spaces delete + point reversal invoked.
  - admin: hide reverses point, unhide re-awards; delete reverses; audit log emitted.
  - points: first photo awards `photo_first:{fountain_id}`; second photo does not;
    reversal on hide/delete.
  - city list: `photo_count` + `thumbnail_url` populated; null when no photo; map/bbox
    pins unchanged.
  - migration: `alembic upgrade head` + `alembic check` clean.
- **Web/mobile:** `pnpm exec turbo run lint typecheck test --filter=web|mobile`;
  `FountainListRow` thumbnail render/placeholder test; web build clean.

## 17. Open decisions for spec review

1. **Representative city-list thumbnail = most-recent visible photo** (vs the awarded
   first photo). Chosen for freshness — confirm.
2. **Caps: 20/fountain, 5/user/fountain; 10 MB; 2048px/400px.** Confirm the numbers.
3. **Un-hide re-awards the first-photo point.** Confirm (alternative: hide reverses but
   un-hide does not re-award).
4. **No user-facing "report photo"** this batch (admins remove directly). Confirm.
