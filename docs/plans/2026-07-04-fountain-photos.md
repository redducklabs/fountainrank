# Fountain Photos + Report/Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users upload photos of a fountain, shown in a carousel on the web and mobile detail pages, with a user report path feeding an admin moderation queue (hide/reject) and a pending-count badge on the profile icon.

**Architecture:** A backend-proxied upload validates + re-encodes + thumbnails each image and stores it in a **private** DO Spaces bucket; all reads go through backend **presigned-redirect** endpoints that 404 when a photo is hidden, so moderation actually removes access. Post-moderation visibility is bounded by per-user quotas (a pre-work `upload_attempt` reservation) + a report queue. Web uses Next server actions/components (multipart via a raw `fetch` in the action with a server-side token); mobile uses the api-client, with multipart going through a sanitized `MobileApiClient.uploadMultipart` method (same x-dev-stripping/bearer path as every other call).

**Tech Stack:** FastAPI + async SQLAlchemy 2 + Alembic + PostGIS (backend), boto3/Pillow/python-multipart (new), DO Spaces (S3-compatible), Next.js 16 (web), Expo SDK 56 / React Native (mobile), `packages/api-client` (openapi-typescript + openapi-fetch), Terraform + DOKS (infra).

**Source spec:** `docs/specs/2026-07-04-fountain-photos-design.md` (Codex-APPROVED). Section refs below (`spec §N`) point there.

## Global Constraints

- **Windows host, backslash paths** in file tools; **Bash tool is Git Bash** (forward slashes). Backend runs under **`uv`** (`cd backend && uv run …`); DB container on **port 5436** (`./run.ps1 up`; fresh container needs `uv run alembic upgrade head`).
- **`run.ps1` aborts on tool stderr** — run CI-mirror commands via the **Bash tool** (`pnpm exec turbo run lint typecheck test --filter=<pkg>`; backend `cd backend && uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`).
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution**, **no time estimates** anywhere.
- **Backend endpoint change → `pnpm run generate`** and **commit** regenerated `packages/api-client/{openapi.json,src/schema.d.ts}` (git-tracked despite the dead `.gitignore` lines).
- **IaC is read-only locally** — Terraform `init -backend=false`/`validate`/`fmt`/`plan` only; **never** `apply`/`kubectl apply`. Deploy is CI-only.
- **Alembic**: deterministic constraint/index names per `models.py` `NAMING_CONVENTION`; every migration reversible; `alembic check` must be drift-free.
- **Logging**: structured, no bare `print`, no secrets/tokens/PII/raw report notes in logs; a 500 is never silent.
- **Auth**: reuse existing deps — `require_named_user` (uploads/own-delete), `get_current_user` (report), `require_admin` (admin). Never self-mint tokens; dev-auth seam stays closed in prod.
- **Every PR**: CI green **AND** Codex `VERDICT: APPROVED` **AND** every PR comment addressed → squash-merge. Codex `cwd` = the WSL path **derived from the current repo root** (translate the Windows working dir, e.g. `C:\…\fountainrank` → `/mnt/c/…/fountainrank`; never hardcode), bypass mode (`sandbox: danger-full-access`, `approval-policy: never`).

---

## PR / branch strategy

Three sequenced PRs off `feat/fountain-photos` (or stacked branches), each independently CI-green + Codex-approved before the next builds on it:

- **PR 1 — Backend + infra + api-client** (Tasks B1–B16, I1–I2). Ships working, tested endpoints; storage mocked in tests.
- **PR 2 — Web** (Tasks W1–W9). Consumes the regenerated api-client.
- **PR 3 — Mobile** (Tasks M1–M8).

The spec (`docs/specs/2026-07-04-fountain-photos-design.md`) and this plan are already committed on the branch.

---

## File Structure

**Backend (new):**
- `backend/app/storage.py` — Spaces client wrapper (put/delete/presign), lazy+cached.
- `backend/app/images.py` — Pillow validate/normalize/downscale/thumbnail (pure, blocking).
- `backend/app/rate_limit.py` — advisory-lock helpers + upload reservation + report rate check.
- `backend/app/multipart_read.py` — size-capped streaming multipart file reader (B12a).
- `backend/app/routers/photos.py` — upload / list / delete-own / gated reads / report.
- `backend/migrations/versions/0017_fountain_photos.py` — `fountain_photos` + `storage_cleanup` + `upload_attempts`.
- `backend/migrations/versions/0018_photo_reports.py` — `photo_reports`.
- Backend tests under `backend/tests/`.

**Backend (modified):** `config.py` (Spaces settings), `models.py` (4 models), `contributions.py` (photo primitives), `schemas.py` (photo/report schemas + `CityFountainPin`), `routers/admin.py` (queue + hide/dismiss/delete), `routers/places.py` (`CityFountainPin` lateral), `main.py` (register router), `pyproject.toml` (deps).

**Web (new):** `web/components/fountain/PhotoCarousel.tsx`, `web/components/fountain/PhotoUpload.tsx`, `web/components/fountain/ReportPhotoButton.tsx`, `web/components/admin/ReportBadge.tsx`, `web/app/admin/reports/page.tsx`, `web/lib/server/photo-reports.ts`.
**Web (modified):** `web/app/actions/contribute.ts` (uploadPhoto/reportPhoto/deleteOwnPhoto), `web/app/actions/admin.ts` (hide/dismiss/delete photo + count), `web/lib/fountains.ts` (getFountainPhotosServer), `web/lib/server/api.ts` (getActionAccessToken), `web/components/fountain/FountainDetail.tsx` + `ContributeSection.tsx`, `web/app/fountains/[id]/page.tsx`, `web/components/fountain/FountainListRow.tsx`, `web/components/SiteHeader.tsx` + `AuthControl.tsx`, `docs/style-guide.md`.

**Mobile (new):** `mobile/components/fountain/PhotoCarousel.tsx`, `mobile/components/fountain/PhotoUploadButton.tsx`, `mobile/components/fountain/ReportPhotoButton.tsx`, `mobile/app/admin/reports.tsx`, `mobile/lib/photo-upload.ts`.
**Mobile (modified):** `mobile/app/fountains/[id].tsx`, `mobile/components/fountain/FountainDetail.tsx`, `mobile/components/nav/ProfileTabIcon.tsx`, `mobile/app/(tabs)/account.tsx`, `mobile/lib/api.ts` (authed routes), `mobile/package.json`.

**Infra (modified):** `infra/terraform/main.tf`, `infra/k8s/secrets.yaml`, `infra/k8s/backend.yaml`.

---

# PR 1 — Backend + infra + api-client

### Task B1: Backend dependencies

**Files:** Modify `backend/pyproject.toml`

- [ ] **Step 1: Add deps.** The repo uses **exact pins** (e.g. `fastapi==0.138.0`). Add `boto3`, `pillow`, `python-multipart` to `[project].dependencies`, then in Step 2 pin each to the exact version `uv lock` resolves (edit the `==` pins to match `uv.lock`), matching the existing style.

- [ ] **Step 2: Lock + install + pin.** Run: `cd backend && uv lock && uv sync`, then read the resolved versions from `uv.lock` and set exact `==` pins in `pyproject.toml`.
  Expected: resolves and installs boto3, pillow, python-multipart at pinned versions.

- [ ] **Step 3: Commit.**
```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "build(backend): add boto3, pillow, python-multipart for photo uploads"
```

---

### Task B2: Spaces settings in config

**Files:** Modify `backend/app/config.py`; Test `backend/tests/test_config_spaces.py`

**Interfaces — Produces:** `Settings.spaces_endpoint/spaces_region/spaces_bucket/spaces_access_key/spaces_secret_key: str | None`, `spaces_presign_ttl_seconds: int = 600`, `upload_reservation_ttl_seconds: int = 120`, and `@property photos_enabled -> bool`.

- [ ] **Step 1: Write the failing test.**
```python
# backend/tests/test_config_spaces.py
from app.config import Settings

def _base(**kw):
    return Settings(database_url="postgresql+asyncpg://x/y", logto_endpoint="https://l", logto_audience="a", **kw)

def test_photos_disabled_without_creds():
    assert _base().photos_enabled is False

def test_photos_enabled_with_full_creds():
    s = _base(spaces_endpoint="https://nyc3.digitaloceanspaces.com", spaces_region="nyc3",
              spaces_bucket="fr-photos", spaces_access_key="k", spaces_secret_key="s")
    assert s.photos_enabled is True

def test_endpoint_trailing_slash_normalized():
    s = _base(spaces_endpoint="https://nyc3.digitaloceanspaces.com/")
    assert s.spaces_endpoint == "https://nyc3.digitaloceanspaces.com"
```
(Match the existing `Settings` construction in other config tests; copy their required-field kwargs if different.)

- [ ] **Step 2: Run — expect FAIL** (`AttributeError: photos_enabled`). Run: `cd backend && uv run pytest tests/test_config_spaces.py -v`

- [ ] **Step 3: Implement.** Add the fields near the geocoding/email blocks. Follow the `email_configured`/`geocoding_enabled` idiom:
```python
spaces_endpoint: str | None = None
spaces_region: str | None = None
spaces_bucket: str | None = None
spaces_access_key: str | None = None
spaces_secret_key: str | None = None
spaces_presign_ttl_seconds: int = 600
upload_reservation_ttl_seconds: int = 120

@field_validator("spaces_endpoint")
@classmethod
def _normalize_endpoint(cls, v: str | None) -> str | None:
    if v is None:
        return None
    v = v.rstrip("/")
    if not v.startswith("https://"):
        raise ValueError("spaces_endpoint must be https")
    return v

@property
def photos_enabled(self) -> bool:
    return all([self.spaces_endpoint, self.spaces_region, self.spaces_bucket,
                self.spaces_access_key, self.spaces_secret_key])
```
The startup logger (`backend/app/logging_config.py` `log_startup`) is an explicit **allow-list**, not a settings dump — do **not** add the access/secret keys anywhere. If useful, add only non-secret metadata (`photos_enabled`, `spaces_region`) to that allow-list.

- [ ] **Step 4: Run — expect PASS.** Run: `cd backend && uv run pytest tests/test_config_spaces.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/config.py backend/tests/test_config_spaces.py && git commit -m "feat(backend): add DO Spaces settings + photos_enabled"`

---

### Task B3: Storage module

**Files:** Create `backend/app/storage.py`; Test `backend/tests/test_storage.py`

**Interfaces — Produces:**
- `get_storage(settings) -> Storage | None` (None when `not settings.photos_enabled`; lazily builds + caches a boto3 client).
- `Storage.put_object(key: str, data: bytes, content_type: str) -> None`
- `Storage.delete_object(key: str) -> None` (raises on failure)
- `Storage.presign_get(key: str) -> str`
- `reset_storage_cache() -> None` (test hook)

- [ ] **Step 1: Write failing tests** (boto3 client mocked via `unittest.mock`):
```python
# backend/tests/test_storage.py
from unittest.mock import MagicMock, patch
from app.config import Settings
from app import storage

def _settings():
    return Settings(database_url="postgresql+asyncpg://x/y", logto_endpoint="https://l",
        logto_audience="a", spaces_endpoint="https://nyc3.digitaloceanspaces.com",
        spaces_region="nyc3", spaces_bucket="b", spaces_access_key="k", spaces_secret_key="s")

def setup_function():
    storage.reset_storage_cache()

def test_disabled_returns_none():
    from app.config import Settings as S
    assert storage.get_storage(S(database_url="postgresql+asyncpg://x/y",
        logto_endpoint="https://l", logto_audience="a")) is None

@patch("app.storage.boto3")
def test_put_object_private(mock_boto3):
    client = MagicMock(); mock_boto3.client.return_value = client
    st = storage.get_storage(_settings())
    st.put_object("fountains/a/b.jpg", b"x", "image/jpeg")
    kwargs = client.put_object.call_args.kwargs
    assert kwargs["ACL"] == "private" and kwargs["Bucket"] == "b" and kwargs["Key"] == "fountains/a/b.jpg"

@patch("app.storage.boto3")
def test_presign_get(mock_boto3):
    client = MagicMock(); client.generate_presigned_url.return_value = "https://signed"
    mock_boto3.client.return_value = client
    assert storage.get_storage(_settings()).presign_get("k") == "https://signed"
```

- [ ] **Step 2: Run — expect FAIL** (module missing). `cd backend && uv run pytest tests/test_storage.py -v`

- [ ] **Step 3: Implement `backend/app/storage.py`:**
```python
from __future__ import annotations
import boto3
from app.config import Settings

_cache: "Storage | None" = None
_cache_key: tuple | None = None

class Storage:
    def __init__(self, settings: Settings):
        self._bucket = settings.spaces_bucket
        self._ttl = settings.spaces_presign_ttl_seconds
        self._client = boto3.client(
            "s3", endpoint_url=settings.spaces_endpoint, region_name=settings.spaces_region,
            aws_access_key_id=settings.spaces_access_key, aws_secret_access_key=settings.spaces_secret_key,
        )
    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data,
            ContentType=content_type, ACL="private", CacheControl="public, max-age=31536000, immutable")
    def delete_object(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)
    def presign_get(self, key: str) -> str:
        return self._client.generate_presigned_url("get_object",
            Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=self._ttl)

def get_storage(settings: Settings) -> Storage | None:
    global _cache, _cache_key
    if not settings.photos_enabled:
        return None
    # Cache key includes BOTH keys so a credential rotation rebuilds the client
    # (hash the secret so it never lands in a repr/log).
    k = (settings.spaces_endpoint, settings.spaces_region, settings.spaces_bucket,
         settings.spaces_access_key, hash(settings.spaces_secret_key))
    if _cache is None or _cache_key != k:
        _cache, _cache_key = Storage(settings), k
    return _cache

def reset_storage_cache() -> None:
    global _cache, _cache_key
    _cache, _cache_key = None, None
```
Note: per the amended spec §4, `presign_get(key)` uses the configured TTL directly — window-snapped stable-within-window URLs are a deferred optimization (SigV4 embeds the signing time, so a stable URL string isn't simple with boto3).

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_storage.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/storage.py backend/tests/test_storage.py && git commit -m "feat(backend): private Spaces storage wrapper (put/delete/presign)"`

---

### Task B4: Image processing pipeline

**Files:** Create `backend/app/images.py`; Test `backend/tests/test_images.py`

**Interfaces — Produces:** `process_image(raw: bytes, *, max_edge=2048, thumb_edge=400) -> ProcessedImage` where `ProcessedImage = dataclass(full: bytes, thumb: bytes, width: int, height: int)`. Raises `UnsupportedImage` (→ 415) on non-raster/animated/decode failure or decompression bomb.

- [ ] **Step 1: Write failing tests** (build inputs with Pillow):
```python
# backend/tests/test_images.py
import io, pytest
from PIL import Image
from app.images import process_image, UnsupportedImage

def _jpeg(w=3000, h=2000, exif_gps=True):
    img = Image.new("RGB", (w, h), (100, 150, 200))
    buf = io.BytesIO(); img.save(buf, "JPEG"); return buf.getvalue()

def test_downscales_full_to_max_edge():
    out = process_image(_jpeg())
    assert max(out.width, out.height) == 2048
    Image.open(io.BytesIO(out.full)).verify()

def test_generates_thumbnail():
    out = process_image(_jpeg())
    t = Image.open(io.BytesIO(out.thumb)); assert max(t.size) == 400

def test_strips_exif():
    out = process_image(_jpeg())
    assert not Image.open(io.BytesIO(out.full))._getexif()

def test_rejects_non_image():
    with pytest.raises(UnsupportedImage):
        process_image(b"not an image")

def test_accepts_png_and_webp_reencodes_to_jpeg():
    img = Image.new("RGB", (500, 500), (10, 20, 30)); buf = io.BytesIO(); img.save(buf, "PNG")
    out = process_image(buf.getvalue())
    assert Image.open(io.BytesIO(out.full)).format == "JPEG"
```

- [ ] **Step 2: Run — expect FAIL.** `cd backend && uv run pytest tests/test_images.py -v`

- [ ] **Step 3: Implement `backend/app/images.py`:**
```python
from __future__ import annotations
import io
from dataclasses import dataclass
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard (~40MP)
_ALLOWED = {"JPEG", "PNG", "WEBP"}

class UnsupportedImage(Exception): ...

@dataclass
class ProcessedImage:
    full: bytes
    thumb: bytes
    width: int
    height: int

def _encode(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=quality, optimize=True); return buf.getvalue()

def process_image(raw: bytes, *, max_edge: int = 2048, thumb_edge: int = 400) -> ProcessedImage:
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in _ALLOWED or getattr(img, "is_animated", False):
            raise UnsupportedImage(f"unsupported format {img.format}")
        img = ImageOps.exif_transpose(img).convert("RGB")  # apply orientation, drop metadata
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise UnsupportedImage(str(e)) from e
    full = img.copy(); full.thumbnail((max_edge, max_edge))
    thumb = img.copy(); thumb.thumbnail((thumb_edge, thumb_edge))
    return ProcessedImage(full=_encode(full, 85), thumb=_encode(thumb, 80),
                          width=full.width, height=full.height)
```

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_images.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/images.py backend/tests/test_images.py && git commit -m "feat(backend): image validate/re-encode/thumbnail pipeline (strips EXIF)"`

---

### Task B5: Data models

**Files:** Modify `backend/app/models.py`

**Interfaces — Produces:** ORM classes `FountainPhoto`, `PhotoReport`, `StorageCleanup`, `UploadAttempt` (columns per spec §3.1–3.4).

- [ ] **Step 1:** Add the four models near `FountainNote` (line ~563), copying its column idioms (`PgUUID(as_uuid=True)`, `default=uuid.uuid4`, `ForeignKey(..., ondelete="CASCADE")`, `server_default`, `mapped_column`). Include CHECK constraints + explicit short names via `__table_args__` (mirror existing constraint-naming in the file). Key columns:
  - `FountainPhoto`: `id, fountain_id(FK CASCADE), user_id(FK CASCADE), storage_key, thumbnail_key, content_type(CHECK ="image/jpeg"), width(CHECK>0), height(CHECK>0), byte_size(CHECK>0), is_hidden(server_default false), hidden_by_user_id(FK nullable), hidden_at, created_at, updated_at`.
  - `PhotoReport`: `id, photo_id(FK fountain_photos CASCADE), reporter_user_id(FK CASCADE), category(CHECK in set), note(String(500) nullable), status(CHECK in {pending,resolved} server_default pending), resolution(CHECK in {hidden,rejected} nullable), resolved_by_user_id(FK nullable), resolved_at, created_at`.
  - `StorageCleanup`: `id, object_key, reason(CHECK in {upload_orphan,moderation_delete}), status(CHECK in {pending,done} server_default pending), attempts(server_default 0), created_at, last_attempt_at(nullable)`.
  - `UploadAttempt`: `id, user_id(FK CASCADE), status(CHECK in {reserved,completed,failed} server_default reserved), created_at, finalized_at(nullable)`.

- [ ] **Step 2: Sanity import.** Run: `cd backend && uv run python -c "from app.models import FountainPhoto, PhotoReport, StorageCleanup, UploadAttempt; print('ok')"` Expected: `ok`.

- [ ] **Step 3: Commit.** `git add backend/app/models.py && git commit -m "feat(backend): FountainPhoto/PhotoReport/StorageCleanup/UploadAttempt models"`

---

### Task B6: Migration 0017 (photos + storage_cleanup + upload_attempts)

**Files:** Create `backend/migrations/versions/0017_fountain_photos.py`

- [ ] **Step 1:** Copy `0008_fountain_notes.py` as the template. Revision ids follow the repo's **full-string** convention: set `revision = "0017_fountain_photos"` and `down_revision = "0016_place_boundary_cells"` (confirm the current head first: `cd backend && uv run alembic heads` — it should print `0016_place_boundary_cells`; use whatever it prints). In `upgrade()` create `fountain_photos`, `storage_cleanup`, `upload_attempts` with **explicit named** PK/FK/CHECK/index constraints matching the model `__table_args__`. Add the partial indexes: `fountain_photos` `WHERE is_hidden = false` on `(fountain_id, created_at DESC)` and `(user_id, created_at)`; `storage_cleanup` `WHERE status='pending'` on `(created_at)`; `upload_attempts` on `(user_id, status, created_at)`. `downgrade()` drops all three (reverse order).

- [ ] **Step 2: Apply.** Run: `cd backend && uv run alembic upgrade head` Expected: revision 0017 applied, no error.

- [ ] **Step 3: Check drift + verify constraint/index names.** Run: `cd backend && uv run alembic check` (expect "No new upgrade operations detected"). Then — because `alembic check` does **not** compare CHECK definitions (`claude_help/testing-ci.md`) — verify the CHECK/partial-index names exist against the live DB: `cd backend && uv run python -c "import asyncio,sqlalchemy as sa; from app.db import engine; ..."` querying `pg_constraint`/`pg_indexes` for the expected names (or a psql `\d fountain_photos`). Confirm the `content_type='image/jpeg'` and `width/height/byte_size>0` CHECKs and the two partial indexes are present with the deterministic names.

- [ ] **Step 4: Round-trip.** Run: `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head` Expected: both succeed.

- [ ] **Step 5: Commit.** `git add backend/migrations/versions/0017_fountain_photos.py && git commit -m "feat(backend): migration 0017 — fountain_photos, storage_cleanup, upload_attempts"`

---

### Task B7: Migration 0018 (photo_reports)

**Files:** Create `backend/migrations/versions/0018_photo_reports.py`

- [ ] **Step 1:** `revision = "0018_photo_reports"`, `down_revision = "0017_fountain_photos"`. Create `photo_reports` with named constraints; add the **partial unique** index `unique(photo_id, reporter_user_id) WHERE status='pending'` and partial indexes `WHERE status='pending'` on `(photo_id)` and on `(reporter_user_id, created_at)`. `downgrade()` drops the table.

- [ ] **Step 2:** `cd backend && uv run alembic upgrade head && uv run alembic check` — applied + drift-free.

- [ ] **Step 3:** `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head` — round-trips.

- [ ] **Step 4: Commit.** `git add backend/migrations/versions/0018_photo_reports.py && git commit -m "feat(backend): migration 0018 — photo_reports"`

---

### Task B8: Contribution primitives (photo_first)

**Files:** Modify `backend/app/contributions.py`; Test `backend/tests/test_contributions_photo.py`

**Interfaces — Produces:** `dk_photo_first(fountain_id) -> str`; `POINTS["photo_first"]`; `EVENT_TARGET_TYPES["photo_first"] = {"photo"}`; `reverse_contribution_for_target(session, target_type, target_id) -> int`; `reactivate_contribution_for_target(session, target_type, target_id) -> int`.

- [ ] **Step 1: Write failing tests** (use the existing async DB test fixture — copy setup from `backend/tests/` contribution tests; seed a user + fountain):
```python
# assert: recording photo_first awards points once (2nd dedups); reverse_contribution_for_target
# flips only that photo's event to reversed and decrements total_points; reactivate flips it back;
# reverse of a different fountain's contributions is untouched.
```
Model these on the existing `record_contributions`/`reverse_contributions` tests.

- [ ] **Step 2: Run — expect FAIL** (`dk_photo_first` undefined).

- [ ] **Step 3: Implement.** Add to `POINTS`: `"photo_first": 5`. Add to `EVENT_TARGET_TYPES`: `"photo_first": {"photo"}`. Add `def dk_photo_first(fountain_id): return f"photo_first:{fountain_id}"`. Add (mirroring `reverse_contributions` but scoped by target, with re-award as the inverse):
```python
async def _adjust_target(session, target_type, target_id, from_status, to_status, sign):
    rows = (await session.execute(
        update(ContributionEvent)
        .where(ContributionEvent.target_type == target_type,
               ContributionEvent.target_id == target_id,
               ContributionEvent.status == from_status)
        .values(status=to_status)
        .returning(ContributionEvent.user_id, ContributionEvent.event_type, ContributionEvent.points)
    )).all()
    for row in rows:
        col_delta = {"total_points": sign * row.points}
        counter = _STAT_COUNTER.get(row.event_type)
        if counter:
            col_delta[counter] = sign * 1
        set_ = {c: func.greatest(UserContributionStats.__table__.c[c] + d, 0) for c, d in col_delta.items()}
        set_["updated_at"] = func.now()
        await session.execute(update(UserContributionStats)
            .where(UserContributionStats.user_id == row.user_id).values(**set_))
    return len(rows)

async def reverse_contribution_for_target(session, target_type, target_id) -> int:
    return await _adjust_target(session, target_type, target_id, "awarded", "reversed", -1)

async def reactivate_contribution_for_target(session, target_type, target_id) -> int:
    return await _adjust_target(session, target_type, target_id, "reversed", "awarded", +1)
```
(`photo_first` has **no** `_STAT_COUNTER` entry — total_points only.)

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_contributions_photo.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/contributions.py backend/tests/test_contributions_photo.py && git commit -m "feat(backend): target-scoped contribution reverse/reactivate + photo_first"`

---

### Task B9: Rate limit + upload reservation helpers

**Files:** Create `backend/app/rate_limit.py`; Test `backend/tests/test_rate_limit.py`

**Interfaces — Produces:**
- Constants `PHOTO_UPLOAD_LOCK_NS`, `PHOTO_REPORT_LOCK_NS` (distinct ints, ≠ the existing `ADD_FOUNTAIN` lock key — grep for it and pick unused namespaces).
- `async def acquire_user_lock(session, namespace: int, user_id) -> None` — `SELECT pg_advisory_xact_lock(:ns, :ukey)` with `ukey = signed-32-bit hash of user_id`.
- `async def reserve_upload(session, user_id, settings) -> uuid.UUID` — under the upload lock, evaluate **three** checks, each → `RateLimited` (429, with `retry_after`): (a) non-expired `reserved`+`completed`+`failed` attempts in the last 60s ≥ `UPLOAD_ATTEMPTS_PER_MIN` (10); (b) same set in the last 24h ≥ `UPLOAD_ATTEMPTS_PER_DAY` (60); (c) `completed` in the last 24h ≥ `UPLOAD_COMPLETED_PER_DAY` (30). Otherwise insert a `reserved` UploadAttempt and return its id.
- `async def finalize_upload(session, attempt_id, status: str) -> None`.
- `async def check_report_rate(session, user_id) -> None` — under the report lock, count reports in 60s/24h vs limits; raise `RateLimited`.
- `class RateLimited(Exception)` (carries `retry_after: int`).
- Limits (module constants, tunable): `UPLOAD_ATTEMPTS_PER_MIN=10`, `UPLOAD_ATTEMPTS_PER_DAY=60`, `UPLOAD_COMPLETED_PER_DAY=30`, `REPORTS_PER_MIN=20`, `REPORTS_PER_DAY=100`.

- [ ] **Step 1: Write failing tests** (async DB fixture): reserving 10 in 60s → 11th raises `RateLimited`; **61 non-expired attempts spread across 24h (no 60s window breached) → 429** (the daily attempt cap); a `failed` attempt still counts toward both attempt windows; `completed` beyond 30/24h raises even when attempt caps aren't hit; expired `reserved` (created_at older than TTL, forced via direct UPDATE of created_at) does not count; `RateLimited.retry_after` is set; `check_report_rate` caps at 20/60s and 100/24h. Seed `created_at` explicitly to place rows in windows.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** per the interfaces. Window counts use `created_at > now() - :window`; expired reserved excluded via `NOT (status='reserved' AND created_at < now() - :ttl)`. Advisory lock via `text("SELECT pg_advisory_xact_lock(:ns, :uk)")`.

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_rate_limit.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/rate_limit.py backend/tests/test_rate_limit.py && git commit -m "feat(backend): advisory-lock upload reservation + report rate limits"`

---

### Task B10: Schemas

**Files:** Modify `backend/app/schemas.py`

**Interfaces — Produces:** `PhotoOut`, `ReportPhotoRequest`, `ReportedPhotoOut`, `CityFountainPin(FountainPin)`, `PhotoReportsSummary`.

- [ ] **Step 1:** Add (Pydantic v2, matching existing style):
```python
class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str
    thumbnail_url: str
    width: int
    height: int
    uploaded_by: str | None
    created_at: datetime

class ReportPhotoRequest(BaseModel):
    category: Literal["inappropriate", "not_a_fountain", "spam", "other"]
    note: str | None = Field(default=None, max_length=500)

class ReportedPhotoOut(BaseModel):
    photo_id: uuid.UUID
    fountain_id: uuid.UUID
    url: str
    thumbnail_url: str
    is_hidden: bool
    report_count: int
    categories: list[str]
    notes: list[str]           # ≤3, each truncated ≤200 chars
    first_reported_at: datetime
    uploaded_by: str | None

class CityFountainPin(FountainPin):
    photo_count: int = 0
    thumbnail_url: str | None = None

class PhotoReportsSummary(BaseModel):
    pending_photo_count: int
```
Change `CityFountainsOut.fountains` type to `list[CityFountainPin]`.

- [ ] **Step 2: Sanity import.** `cd backend && uv run python -c "from app.schemas import PhotoOut, ReportedPhotoOut, CityFountainPin; print('ok')"`

- [ ] **Step 3: Commit.** `git add backend/app/schemas.py && git commit -m "feat(backend): photo/report/city-pin schemas"`

---

### Task B11: Photo router — read gate + list

**Files:** Create `backend/app/routers/photos.py`; Modify `backend/app/main.py`; Test `backend/tests/test_photos_read.py`

**Interfaces — Produces:** `GET /api/v1/fountains/{fountain_id}/photos` → `list[PhotoOut]`; `GET /api/v1/photos/{photo_id}` and `/api/v1/photos/{photo_id}/thumb` → 302 or 404. Helper `photo_out(photo) -> PhotoOut` building `url=/api/v1/photos/{id}`, `thumbnail_url=/api/v1/photos/{id}/thumb`.

- [ ] **Step 1: Write failing tests** (use the app test client + a mocked `get_storage`; seed fountain + a visible + a hidden photo): list returns only visible, newest-first; **`GET /fountains/{unknown_or_hidden}/photos` → 404** (parent-scoped, like notes — not an empty list); `GET /photos/{visible}` → 302 with `Location` = the mocked presigned URL; `GET /photos/{hidden}` → 404; unknown id → 404; **with storage disabled (`get_storage` → None): visible → 503, hidden/unknown → 404**.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the router (`APIRouter(prefix="/api/v1", tags=["photos"])`). The **list** endpoint first loads the parent fountain (`is_hidden.is_(False)`) → **404** if missing/hidden (mirror `list_notes`), then returns visible photos. The read endpoints return `RedirectResponse(storage.presign_get(key), status_code=302)` with `Cache-Control: private, max-age=60`; add the `photo_out` helper; register `app.include_router(photos.router)` in `main.py`. Read-gate order: **unknown id or `is_hidden` → 404** (don't reveal hidden/missing); for a **visible existing row** when `get_storage(settings)` is None (misconfigured storage) → **503** with a structured error + WARNING log (an operational misconfig must not masquerade as "not found", per the observability standard).

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_photos_read.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/routers/photos.py backend/app/main.py backend/tests/test_photos_read.py && git commit -m "feat(backend): photo list + gated presigned-redirect reads"`

---

### Task B12a: Streaming multipart file reader

**Files:** Create `backend/app/multipart_read.py`; Test `backend/tests/test_multipart_read.py`

**Interfaces — Produces:** `async def read_capped_multipart_file(request: Request, max_bytes: int) -> bytes` — streams the request body via `request.stream()`, feeds `python-multipart`'s streaming parser (`multipart.MultipartParser` with the boundary from the `Content-Type` header), extracts the first file part's bytes, and raises `TooLarge` (→413) the instant the accumulated bytes exceed `max_bytes` (never buffering unbounded). `class TooLarge(Exception)`.

- [ ] **Step 1: Write failing tests** (build a Starlette `Request` from an ASGI scope + a `receive` that yields multipart chunks, or use the app test client posting `files=`): a valid small file returns its exact bytes; a body exceeding `max_bytes` raises `TooLarge` after reading ≤ `max_bytes + one chunk` (assert it aborts early, e.g. via a chunk counter); a non-multipart content-type raises a clear error.

- [ ] **Step 2: Run — expect FAIL.** `cd backend && uv run pytest tests/test_multipart_read.py -v`

- [ ] **Step 3: Implement** using `python-multipart` (`from multipart import MultipartParser` / the `multipart.multipart` callback API) fed chunk-by-chunk from `async for chunk in request.stream()`; track a running byte total and raise `TooLarge` when it would exceed `max_bytes`; collect the first file part's data into a `bytearray`. Parse the boundary from `request.headers["content-type"]`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.** `git add backend/app/multipart_read.py backend/tests/test_multipart_read.py && git commit -m "feat(backend): size-capped streaming multipart file reader"`

---

### Task B12: Photo router — upload

**Files:** Modify `backend/app/routers/photos.py`; Test `backend/tests/test_photos_upload.py`

**Interfaces — Consumes:** `read_capped_multipart_file` (B12a), `reserve_upload`/`finalize_upload` (B9), `process_image` (B4), `get_storage` (B3), `dk_photo_first`/`record_contributions` (B8). **Produces:** `POST /api/v1/fountains/{fountain_id}/photos` (multipart) → `PhotoOut`.

- [ ] **Step 1: Write failing tests** (mock `get_storage` + `process_image` where useful; seed fountain). Assert:
  - happy path inserts a row + returns `PhotoOut`; awards `photo_first` on the first photo (2nd doesn't); the awarded `ContributionEvent` has `user_id == uploader.id`, `target_type == "photo"`, `target_id == photo_id`, and a non-null `location` (copied from the fountain);
  - **`photos_enabled=False` → 503 and neither the body is read nor `process_image`/`put_object` called** (before reservation);
  - **over-quota via reservation → 429 with `Retry-After`, and `process_image`/`put_object` are NOT called** (reservation precedes body read) — assert via mock call-count;
  - over-size (>10 MB) → 413; non-image → 415; per-fountain cap (seed 20 visible) → 409; per-user cap (seed 5 by user) → 409;
  - **reservation finalize status** is `failed` for the 413/415/409/upload-failure cases and `completed` on success (query `upload_attempts`);
  - a step-4 cap conflict deletes the uploaded objects (assert `delete_object` called) and, when `delete_object` raises, writes a `storage_cleanup` row (`reason='upload_orphan'`);
  - concurrent uploads can't exceed quota (fire N tasks, assert committed rows ≤ limit).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the endpoint `async def upload_photo(request: Request, fountain_id: uuid.UUID, user: User = Depends(require_named_user), session=..., settings=...)`. **Do NOT declare an `UploadFile`/`Form` body param** — that forces FastAPI to parse the multipart body before the function runs, defeating reserve-before-work. Sequence (spec §8.1):
  1. `storage = get_storage(settings)`; if None → **503** `photo_uploads_unavailable` (no body read).
  2. Cheap 404 check: fountain exists + not hidden (no lock).
  3. **Reservation** — `reservation_id = await reserve_upload(session, user.id, settings)` (its own short txn; `RateLimited` → **429** + `Retry-After`; **no body read yet**).
  4. **Read + validate** (wrapped so every failure finalizes the reservation `failed`): `raw = await read_capped_multipart_file(request, 10*1024*1024)` (Task B12a; `TooLarge` → 413); `processed = await run_in_threadpool(process_image, raw)` (`UnsupportedImage` → 415).
  5. **Upload** both objects via `run_in_threadpool(storage.put_object, ...)` — keys `fountains/{fountain_id}/{pid}.jpg` and `..._thumb.jpg`, `pid = uuid4()`.
  6. **Short txn:** `SELECT ... FOR UPDATE` the fountain; re-check caps → **409**; insert the `FountainPhoto`; award via `record_contributions([ContributionSpec(user_id=user.id, event_type="photo_first", target_type="photo", target_id=pid, fountain_id=fountain_id, location=fountain.location, dedup_key=dk_photo_first(fountain_id))])`; `await finalize_upload(session, reservation_id, "completed")`; `commit`.
  7. **Failure handler** (a single `try/except` spanning steps 4–6): on **any** exception after the reservation exists — 413/415 (before upload), 409/DB failure (after upload) — run in a fresh short txn: `finalize_upload(session, reservation_id, "failed")`; and if objects were already uploaded, `run_in_threadpool(storage.delete_object, key)` for each (on delete failure insert `StorageCleanup(reason="upload_orphan")`), then re-raise as the mapped HTTP error. This guarantees the reservation is **never** left `reserved` and failures still cost budget. Structured logs throughout (fountain/user id, sizes, outcome; no secrets).

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_photos_upload.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/routers/photos.py backend/tests/test_photos_upload.py && git commit -m "feat(backend): photo upload (reservation, pipeline, first-photo point, cleanup)"`

---

### Task B13: Photo router — own delete + report

**Files:** Modify `backend/app/routers/photos.py`; Test `backend/tests/test_photos_delete_report.py`

**Interfaces — Produces:** `DELETE /api/v1/fountains/{fountain_id}/photos/{photo_id}` (owner) → 204; `POST /api/v1/fountains/{fountain_id}/photos/{photo_id}/report` → 204.

- [ ] **Step 1: Write failing tests:** owner delete removes the row + calls `delete_object` + reverses the point, and its pending `photo_reports` are gone (removed by `ON DELETE CASCADE` — assert the report rows no longer exist, not that they carry a `resolution`); non-owner → 403; object-delete failure → 5xx + `storage_cleanup` row (`reason='moderation_delete'`); **a `photo_id` whose `fountain_id` doesn't match the path `{fountain_id}` → 404** (route is nested). Report: any signed-in user creates a pending report; duplicate pending → 204 and **the session still commits** (no IntegrityError); category validated (422 on bad); note >500 → 422; report on hidden photo allowed; report rate → 429; unknown photo → 404; **photo under the wrong `{fountain_id}` path → 404**.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Both routes are **nested** — load the photo with `WHERE id == photo_id AND fountain_id == fountain_id` (→ 404 on mismatch, mirroring `submit_note`/`list_notes` scoping in `fountains.py`). Delete: `require_named_user`, load scoped photo (404), ownership check (403), `run_in_threadpool(delete_object)` for both keys (on failure insert `StorageCleanup(reason="moderation_delete")` and raise 500), `reverse_contribution_for_target(session, "photo", photo_id)` **before** deleting the row (so the awarded event is still found), then delete the row — the photo's `photo_reports` are removed automatically by `ON DELETE CASCADE` (no `resolution` write), `commit`, 204. Report: `Depends(get_current_user)`, `check_report_rate` (429), load scoped photo (404 on missing/mismatch), then `pg_insert(PhotoReport).values(...).on_conflict_do_nothing(index_elements=["photo_id","reporter_user_id"], index_where=(PhotoReport.status=="pending")).returning(PhotoReport.id)` — use the row-count to decide (no exception path); log ids/category only (never the note); 204 always (idempotent).

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_photos_delete_report.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/routers/photos.py backend/tests/test_photos_delete_report.py && git commit -m "feat(backend): own-photo delete + photo report (idempotent)"`

---

### Task B14: Admin moderation queue + actions

**Files:** Modify `backend/app/routers/admin.py`; Test `backend/tests/test_admin_photos.py`

**Interfaces — Produces:** `GET /admin/photo-reports` → `list[ReportedPhotoOut]` (paginated); `GET /admin/photo-reports/summary` → `PhotoReportsSummary`; `PATCH /admin/photos/{photo_id}` (`{is_hidden}`); `POST /admin/photos/{photo_id}/dismiss-reports` → 204; `DELETE /admin/photos/{photo_id}` → 204.

- [ ] **Step 1: Write failing tests:** queue groups by photo (one row per photo with N pending reports), pending-only, oldest-first, notes ≤3 truncated ≤200, paginated; summary count = distinct photos with pending reports; hide flips `is_hidden`, stamps `hidden_by_user_id/hidden_at`, resolves pending reports (`resolution='hidden'`), reverses point, and the read endpoint now 404s; unhide re-awards + reads resolve again; dismiss-reports sets `resolution='rejected'`, photo stays visible; delete removes objects + row + reverses point + returns 5xx on object-delete failure; audit logs carry no raw notes; non-admin → 403.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Clone `admin_patch_note` (admin.py ~215) for `admin_patch_photo`; reuse `_admin_context` for audit logs.
  - **Queue** (`GET /admin/photo-reports`): two-part query to bound the admin-only PII notes. (1) A **grouped subquery** over pending `photo_reports` joined to `fountain_photos`: `GROUP BY photo_id` selecting `count(*) AS report_count`, `array_agg(DISTINCT category) AS categories`, `min(created_at) AS first_reported_at`; order by `first_reported_at ASC`; `limit/offset`. (2) For that page's photo ids, a **`LATERAL`** (or per-row correlated) subquery selecting the **3 newest non-null notes** per photo `ORDER BY created_at DESC LIMIT 3`, each truncated to 200 chars via `left(note, 200)` **in SQL** (so untruncated notes never leave the DB). Join in the fountain id + uploader display name + `is_hidden` + the gated `url`/`thumbnail_url`. Never log the notes.
  - **Summary** (`GET /admin/photo-reports/summary`): `SELECT count(DISTINCT photo_id) FROM photo_reports WHERE status='pending'`.
  - **Hide** (`PATCH /admin/photos/{id}`): flip `is_hidden` + stamp `hidden_by_user_id/hidden_at` (clone admin_patch_note); on hide → `reverse_contribution_for_target(session, "photo", id)` + resolve this photo's pending reports (`UPDATE ... SET status='resolved', resolution='hidden', resolved_by_user_id=admin.id, resolved_at=now()`); on unhide → `reactivate_contribution_for_target(...)` (already-resolved reports stay resolved). Audit log.
  - **Dismiss** (`POST /admin/photos/{id}/dismiss-reports`): `UPDATE ... SET status='resolved', resolution='rejected', resolved_by_user_id, resolved_at` for pending reports; photo unchanged; 204; audit log.
  - **Delete** (`DELETE /admin/photos/{id}`): `run_in_threadpool(delete_object)` both keys first (5xx + `storage_cleanup(reason='moderation_delete')` on failure), `reverse_contribution_for_target(...)` before deleting the row, then delete the row (reports removed by cascade). Audit log.
  - Register the new routes on the existing admin router (`require_admin` dep).

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_admin_photos.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/routers/admin.py backend/tests/test_admin_photos.py && git commit -m "feat(backend): admin photo moderation queue + hide/dismiss/delete"`

---

### Task B15: City list — CityFountainPin lateral

**Files:** Modify `backend/app/routers/places.py`; Test `backend/tests/test_city_photos.py`

- [ ] **Step 1: Write failing tests:** `city_fountains` returns `photo_count` + `thumbnail_url` per fountain; 0 photos → count 0, url None; 1/many → count correct, `thumbnail_url == /api/v1/photos/{newest_visible_id}/thumb`; hidden photos excluded from both; **pagination/order unchanged** vs a no-photo baseline; assert the map/bbox `FountainPin` response is untouched (no photo fields).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** per spec §12 in **SQLAlchemy 2 async** (not raw SQL). Import `FountainPhoto`. Add two **correlated scalar subqueries** as extra columns on the existing `select(...)` (keep the `WHERE city_place_id == place.id, is_hidden.is_(False)` filter and the **exact** existing `order_by(ranking_score.desc().nulls_last(), rating_count.desc(), id.asc())` + `limit`/`offset` untouched):
```python
thumb_id_sq = (
    select(FountainPhoto.id)
    .where(FountainPhoto.fountain_id == Fountain.id, FountainPhoto.is_hidden.is_(False))
    .order_by(FountainPhoto.created_at.desc())
    .limit(1).correlate(Fountain).scalar_subquery()
)
photo_count_sq = (
    select(func.count()).select_from(FountainPhoto)
    .where(FountainPhoto.fountain_id == Fountain.id, FountainPhoto.is_hidden.is_(False))
    .correlate(Fountain).scalar_subquery()
)
```
  Add `thumb_id_sq.label("thumb_id"), photo_count_sq.label("photo_count")` to the selected columns; then build `CityFountainPin(..., photo_count=row.photo_count, thumbnail_url=(f"/api/v1/photos/{row.thumb_id}/thumb" if row.thumb_id else None))`. Change the constructor from `FountainPin` to `CityFountainPin`. Because both are scalar subqueries (exactly one value per row), the page's row count/order/pagination are unchanged.

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_city_photos.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/routers/places.py backend/tests/test_city_photos.py && git commit -m "feat(backend): city list thumbnail + photo_count (CityFountainPin)"`

---

### Task B16: Regenerate api-client + full backend CI mirror

**Files:** Modify `packages/api-client/{openapi.json,src/schema.d.ts}`

- [ ] **Step 1: Regenerate.** Run: `pnpm run generate` (from repo root). Expected: `openapi.json` + `schema.d.ts` update with the new photo/report/city types.

- [ ] **Step 2: Full backend mirror.** Run via Bash: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest` Expected: all green.

- [ ] **Step 3: api-client typecheck.** Run: `pnpm exec turbo run lint typecheck test --filter=@fountainrank/api-client` (use the actual package name from `packages/api-client/package.json`). Expected: green.

- [ ] **Step 4: Commit.** `git add packages/api-client/openapi.json packages/api-client/src/schema.d.ts && git commit -m "chore(api-client): regenerate for photo endpoints"`

---

### Task I1: Terraform private photos bucket

**Files:** Modify `infra/terraform/main.tf`

- [ ] **Step 1:** Copy the `digitalocean_spaces_bucket.basemap` block (+ its project-resource registration) to a **private** `digitalocean_spaces_bucket.photos` gated by a new `variable "manage_photos_spaces" { default = false }`. **No** public CDN and **no** public-read; add it to `digitalocean_project_resources.main`. Pin a concrete bucket name (`name = "fountainrank-photos"`) and reuse the existing region variable the basemap bucket uses. Add a short comment block documenting the **`production` GitHub environment secret names** that feed the backend's runtime settings so CI/deploy wiring isn't guesswork: `SPACES_ENDPOINT`, `SPACES_REGION`, `SPACES_BUCKET` (= `fountainrank-photos`), `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY` (these map to `config.py`'s `spaces_*` fields and the `secretKeyRef`s in I2). Update the "Phase 4 photos bucket" comment to "landed".

- [ ] **Step 2: Validate (read-only).** Run: `cd infra/terraform && terraform init -backend=false && terraform fmt -check && terraform validate` Expected: valid, formatted. **Do not** `plan` against real creds or `apply`.

- [ ] **Step 3: Commit.** `git add infra/terraform/main.tf && git commit -m "feat(infra): private photos Spaces bucket (manage_photos_spaces)"`

---

### Task I2: k8s secrets + backend env + ingress body size

**Files:** Modify `infra/k8s/secrets.yaml`, `infra/k8s/backend.yaml`

- [ ] **Step 1:** In `secrets.yaml` (reference doc) add keys `spaces-access-key`, `spaces-secret-key`, `spaces-bucket`, `spaces-endpoint`, `spaces-region`. In `backend.yaml` add matching `env` entries via `valueFrom.secretKeyRef` mapping to `SPACES_ACCESS_KEY` etc. (match the app's `Settings` env names). Add the annotation `nginx.ingress.kubernetes.io/proxy-body-size: "12m"` to the backend ingress.

- [ ] **Step 2:** YAML lint/sanity (yamllint if available, else visual). Confirm env names match `config.py` fields (`SPACES_ENDPOINT` → `spaces_endpoint`, etc.).

- [ ] **Step 3: Commit.** `git add infra/k8s/secrets.yaml infra/k8s/backend.yaml && git commit -m "feat(infra): wire Spaces secrets + ingress body-size for photos"`

**Note (owner):** production deploy expects the `production` GitHub environment Spaces key to carry **bucket-create + object read/write** scope (owner-confirmed); verify at deploy time (spec §16.1).

**→ Open PR 1, get CI green, run the Codex PR-review loop to `VERDICT: APPROVED`, address all comments, squash-merge.**

---

# PR 2 — Web

### Task W1: Photo fetch helper + action token

**Files:** Modify `web/lib/fountains.ts`, `web/lib/server/api.ts`

**Interfaces — Produces:** `getFountainPhotosServer(id, requestId) -> {data, status}`; `getActionAccessToken(requestId) -> Promise<string>` (raw Logto token via the action-variant `getAccessToken(getLogtoConfig(), API_RESOURCE)`).

- [ ] **Step 1:** Add `getFountainPhotosServer` mirroring `getFountainNotesServer` (`web/lib/fountains.ts:52-63`) but `client.GET("/api/v1/fountains/{fountain_id}/photos", ...)`. Add `getActionAccessToken` to `web/lib/server/api.ts` (server-only) returning the token string used inside `getAuthedApiClientForAction`.

- [ ] **Step 2: Typecheck.** Run: `pnpm exec turbo run typecheck --filter=web` Expected: green.

- [ ] **Step 3: Commit.** `git add web/lib/fountains.ts web/lib/server/api.ts && git commit -m "feat(web): getFountainPhotosServer + action access token helper"`

---

### Task W2: uploadPhoto / reportPhoto / deleteOwnPhoto actions

**Files:** Modify `web/app/actions/contribute.ts`; Test `web/app/actions/contribute.test.ts` (if action tests exist; else a light unit test of the FormData/status mapping)

**Interfaces — Produces:** `uploadPhoto(fountainId, formData) -> ActionResult`; `reportPhoto(fountainId, photoId, category, note?) -> ActionResult`; `deleteOwnPhoto(fountainId, photoId) -> ActionResult`.

- [ ] **Step 1:** Implement `uploadPhoto` with a **raw fetch** (multipart): read the token via `getActionAccessToken(requestId)`, `fetch(\`${resolveApiBaseUrl()}/api/v1/fountains/${fountainId}/photos\`, { method:"POST", headers:{ Authorization:\`Bearer ${token}\`, "X-Request-ID":requestId }, body: formData })`, then `revalidatePath(\`/fountains/${fountainId}\`)`. **409 handling:** the existing `mapStatus` maps every 409 → `needs_name`, but photo upload also returns 409 for `photo_limit_fountain`/`photo_limit_user`. Extend the `ContributeError` union with a `photo_limit` variant and, in `uploadPhoto`, inspect the JSON body's `detail` to distinguish `display_name_required` (→ `needs_name`) from `photo_limit_*` (→ `photo_limit`); also add `429` → a `rate_limited` variant. `reportPhoto` uses the typed `run(...)` helper + `client.POST("/api/v1/fountains/{fountain_id}/photos/{photo_id}/report", { params, body:{category, note} })` (map its `429` too). `deleteOwnPhoto` uses `run(...)` + `client.DELETE(".../photos/{photo_id}")`.

- [ ] **Step 2:** Typecheck + any test. Run: `pnpm exec turbo run lint typecheck test --filter=web`

- [ ] **Step 3: Commit.** `git add web/app/actions/contribute.ts && git commit -m "feat(web): uploadPhoto/reportPhoto/deleteOwnPhoto server actions"`

---

### Task W2b: Style guide — document photo UI patterns (BEFORE any UI)

**Files:** Modify `docs/style-guide.md`

Per `CLAUDE.md` + spec §11, the style guide is updated **before** building the components.

- [ ] **Step 1:** Read `docs/style-guide.md`, then add the specs for: the photo carousel + overlaid arrow button (position, size, focus ring, brand colors), the report dialog (category select + note), the list-row thumbnail (size, radius, placeholder), the admin queue row, and the pending-report badge (color, min size, count formatting). Use existing tokens/patterns.

- [ ] **Step 2: Commit.** `git add docs/style-guide.md && git commit -m "docs(style): photo carousel, report dialog, list thumbnail, queue row, badge"`

---

### Task W3: PhotoCarousel component

**Files:** Create `web/components/fountain/PhotoCarousel.tsx`; Test `web/components/fountain/PhotoCarousel.test.tsx`

**Interfaces — Consumes:** `PhotoOut[]` (from api-client `components["schemas"]["PhotoOut"]`). **Produces:** `<PhotoCarousel photos isOwner? onDelete? onReport? />`.

- [ ] **Step 1: Write failing test** (Vitest + Testing Library): renders nothing for `[]`; renders the first image; left/right buttons change the visible index and wrap; arrow buttons have `aria-label`s; report/delete controls call their callbacks when provided.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** a `"use client"` carousel: state `index`; `<img src={photos[index].thumbnail_url … or url}>` (use `url` for the main view); prev/next buttons **overlaid, vertically centered on the left/right edges** (`absolute inset-y-0 left/right-0 flex items-center`), brand styling per `docs/style-guide.md`; keyboard `ArrowLeft/Right`; a dot/index indicator; optional Report button per photo and a Delete button when `isOwner`.

- [ ] **Step 4: Run — expect PASS.** `pnpm exec turbo run test --filter=web`

- [ ] **Step 5: Commit.** `git add web/components/fountain/PhotoCarousel.tsx web/components/fountain/PhotoCarousel.test.tsx && git commit -m "feat(web): PhotoCarousel with overlaid arrows"`

---

### Task W4: Wire carousel + upload into the detail page

**Files:** Modify `web/app/fountains/[id]/page.tsx`, `web/components/fountain/FountainDetail.tsx`, `web/components/fountain/ContributeSection.tsx`; Create `web/components/fountain/PhotoUpload.tsx`, `web/components/fountain/ReportPhotoButton.tsx`

- [ ] **Step 1:** In `page.tsx`, add `getFountainPhotosServer(id, requestId)` to the `Promise.all` (~72-75) and pass `photos` + `currentUserId` into `<FountainDetail>`. In `FountainDetail.tsx`, add a `photos` prop (props block 11-28) and render `<PhotoCarousel photos … isOwner=… onReport/onDelete via client wrappers>` right after the h1/status block (~line 45). Create `PhotoUpload.tsx` (a `"use client"` file input → `uploadPhoto` action, progress/errors) and slot it in `ContributeSection.tsx`'s authed block (~38-39). Create `ReportPhotoButton.tsx` (category dialog → `reportPhoto`).

- [ ] **Step 2: Verify build.** Run: `pnpm exec turbo run lint typecheck test --filter=web` and `pnpm exec turbo run build --filter=web` (then `git checkout -- web/next-env.d.ts web/tsconfig.json`). Expected: green.

- [ ] **Step 3: Commit.** `git add web/app/fountains web/components/fountain && git commit -m "feat(web): photos on fountain detail (carousel, upload, report)"`

---

### Task W5: City-list thumbnail

**Files:** Modify `web/components/fountain/FountainListRow.tsx`; Test `web/components/fountain/FountainListRow.test.tsx`

- [ ] **Step 1: Update the test** (existing `FountainListRow.test.tsx`): with `thumbnail_url` set, an `<img>` renders (lazy, `alt`); with null, a neutral placeholder renders; with `photo_count>0`, a "N photos" label shows.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `FountainPin` here is now the `CityFountainPin` shape (regenerated types) — render `f.thumbnail_url` prefixed with the API base for the `<img src>` (the URL is API-relative), else placeholder; add the count label. Confirm the row's type import resolves to the new fields.

- [ ] **Step 4: Run — expect PASS.** `pnpm exec turbo run test --filter=web`

- [ ] **Step 5: Commit.** `git add web/components/fountain/FountainListRow.tsx web/components/fountain/FountainListRow.test.tsx && git commit -m "feat(web): city list photo thumbnail + count"`

---

### Task W6: Admin server helper + actions

**Files:** Create `web/lib/server/photo-reports.ts`; Modify `web/app/actions/admin.ts`

**Interfaces — Produces:** `getPhotoReportsServer(requestId) -> {data, status}` (server-only, for the RSC queue page); **`fetchPendingReportCount() -> number`** (a `"use server"` **action** in `web/app/actions/admin.ts`, for the client badge); actions `adminHidePhoto(photoId, isHidden)`, `adminDismissPhotoReports(photoId)`, `adminDeletePhoto(photoId)`.

- [ ] **Step 1:** Create `web/lib/server/photo-reports.ts` mirroring `web/lib/server/admin.ts` (`getAuthedApiClient(requestId).GET("/api/v1/admin/photo-reports")`). Add to `web/app/actions/admin.ts`: the three admin mutation actions (via the existing `runAdminAction` helper + `client.PATCH/POST/DELETE`), **and** a `"use server"` action `fetchPendingReportCount()` that generates a requestId, calls `getAuthedApiClientForAction(requestId).GET("/api/v1/admin/photo-reports/summary")`, and returns `pending_photo_count` — or **0** on any non-2xx (so a non-admin poll degrades quietly to 0, no noisy 403 surfaced to the client). This action is what the client badge polls; the server-only helper is not callable from a client component.

- [ ] **Step 2: Typecheck.** `pnpm exec turbo run typecheck --filter=web`

- [ ] **Step 3: Commit.** `git add web/lib/server/photo-reports.ts web/app/actions/admin.ts && git commit -m "feat(web): admin photo-reports server helper + actions"`

---

### Task W7: Admin reports queue page + account link

**Files:** Create `web/app/admin/reports/page.tsx`; Modify `web/components/AuthControl.tsx`

- [ ] **Step 1:** Create `web/app/admin/reports/page.tsx` replicating the admin gate from `web/app/admin/page.tsx:8-43` verbatim, then `getPhotoReportsServer(...)` and render the reported-photos list (thumbnail, report count, categories, notes) with **Hide** / **Reject** / **Delete** forms bound to the W6 actions. Add a "Reports" `<Link href="/admin/reports">` to the admin block in `AuthControl.tsx`'s `UserMenu` (~129-137, alongside the existing Admin link).

- [ ] **Step 2: Build.** `pnpm exec turbo run lint typecheck test --filter=web` + `build --filter=web` (then restore `web/next-env.d.ts`, `web/tsconfig.json`).

- [ ] **Step 3: Commit.** `git add web/app/admin/reports web/components/AuthControl.tsx && git commit -m "feat(web): admin photo-reports queue page + menu link"`

---

### Task W8: Header report badge

**Files:** Create `web/components/admin/ReportBadge.tsx`; Modify `web/components/SiteHeader.tsx`, `web/components/AuthControl.tsx`

- [ ] **Step 1:** In `SiteHeader.tsx`, when `viewer.isAdmin`, compute the initial count server-side via `getPhotoReportsServer`/the summary helper and pass it through `AuthControl` → `UserMenu` as the badge's initial value. Create `ReportBadge.tsx` (`"use client"`) that renders a badge when count>0 and **polls the `fetchPendingReportCount` server action** (from `web/app/actions/admin.ts`, W6) on a ~60s interval (`useEffect` + `setInterval`, cleared on unmount; the token stays server-side inside the action). Only mounted when `viewer.isAdmin`. Overlay it on the avatar button.

- [ ] **Step 2: Build.** `pnpm exec turbo run lint typecheck test --filter=web` + `build --filter=web` (restore generated files).

- [ ] **Step 3: Commit.** `git add web/components/admin/ReportBadge.tsx web/components/SiteHeader.tsx web/components/AuthControl.tsx && git commit -m "feat(web): admin pending-report badge on profile avatar"`

---

### Task W9: Style guide — reconcile with shipped UI

**Files:** Modify `docs/style-guide.md`

- [ ] **Step 1:** Compare the components as built (W3–W8) against the pre-UI spec written in W2b; update `docs/style-guide.md` for any variance (final tokens/spacing/states as actually implemented).

- [ ] **Step 2: Commit.** `git add docs/style-guide.md && git commit -m "docs(style): reconcile photo UI patterns with implementation"`

**→ Open PR 2, CI green, Codex PR-review loop to APPROVED, address comments, squash-merge.**

---

# PR 3 — Mobile

### Task M1: Deps

**Files:** Modify `mobile/package.json`

- [ ] **Step 1:** Run: `cd mobile && npx expo install expo-image-picker expo-image` (resolves SDK-56-compatible versions).

- [ ] **Step 2: Doctor + typecheck.** Run: `cd mobile && npx expo-doctor` (patch drift is expected/benign) and `pnpm exec turbo run typecheck --filter=mobile`.

- [ ] **Step 3: Commit.** `git add mobile/package.json pnpm-lock.yaml && git commit -m "build(mobile): add expo-image-picker + expo-image"`

---

### Task M2: Sanitized multipart upload method + authed routes

**Files:** Modify `mobile/lib/api.ts`; Test `mobile/lib/api.test.ts`

**Interfaces — Produces:** a new **`uploadMultipart(path, formData) -> Promise<{status:number}>`** method on the `MobileApiClient` facade that reuses the **same sanitized fetch** `createApiClient` already builds (strips any `x-dev*` header, attaches `Authorization: Bearer` via `getAccessToken`) — **not** a separate raw `fetch`, so there is no second unaudited network path for an authenticated write. Also add `/api/v1/admin/photo-reports` and `/api/v1/admin/photo-reports/summary` to the force-authed GET list in `isAuthenticatedApiRequest` (80-108).

- [ ] **Step 1: Write failing tests** in `mobile/lib/api.test.ts` (mirror the existing sanitizer/classification tests): `uploadMultipart` sends the `FormData` body, attaches the bearer token, and **strips any `x-dev*` header** passed in; `isAuthenticatedApiRequest("/api/v1/admin/photo-reports")` and `.../summary` both return true (so the GET carries a token) while a public route stays false.

- [ ] **Step 2: Run — expect FAIL.** `pnpm exec turbo run test --filter=mobile`

- [ ] **Step 3: Implement** `uploadMultipart` inside `createApiClient` (it closes over the same sanitizing fetch + `getAccessToken`). The existing sanitizer has signature `(input: Request) => Promise<Response>`, so build a `Request` and pass it through: `const req = new Request(\`${baseUrl}${path}\`, { method:"POST", body: formData }); const res = await sanitizingFetch(req); return { status: res.status };` — do **not** set `Content-Type` (RN sets the multipart boundary); auth + x-dev stripping happen inside the sanitizer exactly as for every other call. Add `uploadMultipart` to the `MobileApiClient` **type** and the narrowed facade object (167-176). Add the two admin routes to `isAuthenticatedApiRequest`. (The Step-1 test passes an `x-dev*` header by constructing the input `Request` with it and asserting the sanitizer strips it.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.** `git add mobile/lib/api.ts mobile/lib/api.test.ts && git commit -m "feat(mobile): sanitized uploadMultipart method + authed report routes"`

---

### Task M3: Mobile PhotoCarousel

**Files:** Create `mobile/components/fountain/PhotoCarousel.tsx`; Test `mobile/components/fountain/PhotoCarousel.test.tsx`

**Interfaces — Produces:** `<PhotoCarousel photos webBaseUrl isOwner? onReport? onDelete? />` using a horizontal `FlatList pagingEnabled` + `expo-image`.

- [ ] **Step 1: Write failing test** (Vitest): renders null for `[]`; renders a page per photo; exposes report/delete affordances via callbacks. (Keep it render/logic-level given RN test constraints.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** with `FlatList` (`horizontal pagingEnabled`), `expo-image` `<Image source={{uri: apiBase + photo.url}}>`, a page-dot indicator, theme tokens from `mobile/theme.ts`, empty → null. Photo URLs are API-relative → prefix with `config.apiBaseUrl`.

- [ ] **Step 4: Run — expect PASS.** `pnpm exec turbo run test --filter=mobile`

- [ ] **Step 5: Commit.** `git add mobile/components/fountain/PhotoCarousel.tsx mobile/components/fountain/PhotoCarousel.test.tsx && git commit -m "feat(mobile): swipeable PhotoCarousel"`

---

### Task M4: Wire carousel + upload + report into detail screen

**Files:** Modify `mobile/app/fountains/[id].tsx`, `mobile/components/fountain/FountainDetail.tsx`; Create `mobile/components/fountain/PhotoUploadButton.tsx`, `mobile/components/fountain/ReportPhotoButton.tsx`

- [ ] **Step 1:** Add a `photosQuery` (`useQuery` → `client.GET(".../photos")`), a `photoUploadMutation` that builds a `FormData` from the `expo-image-picker` asset (`formData.append("file", { uri, name, type })`) and calls **`client.uploadMultipart(\`/api/v1/fountains/${fountainId}/photos\`, formData)`** (M2), then `photosQuery.refetch()` + invalidate `["me","contributions"]` + map non-2xx via `handleMutationError`, and a `photoReportMutation` (`client.POST(".../report")`). Add a `photos` prop to `mobile/components/fountain/FountainDetail.tsx` (props 16-34) and render `<PhotoCarousel>` after `headerBlock` (~line 63). Add `PhotoUploadButton` into the contribution area and `ReportPhotoButton` per photo. Use `expo-image-picker` `launchImageLibraryAsync({mediaTypes:'images', quality:0.9})` (emits JPEG).

- [ ] **Step 2: Typecheck.** `pnpm exec turbo run lint typecheck --filter=mobile`

- [ ] **Step 3: Commit.** `git add mobile/app/fountains mobile/components/fountain && git commit -m "feat(mobile): photos on fountain detail (carousel, upload, report)"`

---

### Task M5: Admin reports screen

**Files:** Create `mobile/app/admin/reports.tsx`

- [ ] **Step 1:** Create the directory route `mobile/app/admin/reports.tsx` (Expo Router file-based; the root `<Stack>` in `mobile/app/_layout.tsx` auto-registers files, but **verify** the route resolves — add a `<Stack.Screen name="admin/reports" options={{ headerShown: true, title: "Reports" }} />` entry in `mobile/app/_layout.tsx` if the root Stack needs explicit screen options, and confirm `router.push("/admin/reports")` / `<Link href="/admin/reports">` from `account.tsx` (M6) navigates). Gate on `useQuery(["me"])` `is_admin` (render an empty/"not authorized" state + `router.back()` if not admin). `useQuery` → `client.GET("/api/v1/admin/photo-reports")`; render a list with thumbnail (`expo-image`, `apiBase + thumbnail_url`), report count/categories/notes, and **Hide** / **Reject** / **Delete** buttons wired to `client.PATCH("/api/v1/admin/photos/{photo_id}")`, `client.POST(".../dismiss-reports")`, `client.DELETE(".../{photo_id}")` mutations that invalidate the reports query + the `["admin","photo-reports","summary"]` query.

- [ ] **Step 2: Typecheck.** `pnpm exec turbo run lint typecheck --filter=mobile`

- [ ] **Step 3: Commit.** `git add mobile/app/admin/reports.tsx && git commit -m "feat(mobile): admin photo-reports queue screen"`

---

### Task M6: Profile "Reports" link

**Files:** Modify `mobile/app/(tabs)/account.tsx`

- [ ] **Step 1:** In `SignedInProfile` (gated on `profile.is_admin`, ~line 206), add a `<Link href="/admin/reports">Reports</Link>` (mirror the existing Diagnostics link ~109-111).

- [ ] **Step 2: Typecheck.** `pnpm exec turbo run typecheck --filter=mobile`

- [ ] **Step 3: Commit.** `git add mobile/app/(tabs)/account.tsx && git commit -m "feat(mobile): admin Reports link on profile"`

---

### Task M7: Profile-tab report badge

**Files:** Modify `mobile/components/nav/ProfileTabIcon.tsx`

- [ ] **Step 1:** `ProfileTabIcon` has no `client` today — import `useApi` (for `client`) and `unwrap` (`mobile/lib/api.ts`). Add `useQuery(["admin","photo-reports","summary"], () => unwrap(client.GET("/api/v1/admin/photo-reports/summary")), { enabled: me.data?.is_admin === true, refetchInterval: 60_000, staleTime: 30_000 })` (reuse the existing `["me"]` subscription at line 45 for `is_admin`); when `pending_photo_count > 0`, overlay a small badge `View` (with count) on the avatar/glyph. The GET carries a token because M2 added `/summary` to `isAuthenticatedApiRequest`.

- [ ] **Step 2: Add a test** (in a mobile component test or `mobile/lib/api.test.ts` per M2): the badge query is disabled for a non-admin `me` (no fetch), enabled + renders the count for an admin. (M2 already tests the authed-route classification.)

- [ ] **Step 3: Typecheck + test.** `pnpm exec turbo run typecheck test --filter=mobile`

- [ ] **Step 4: Commit.** `git add mobile/components/nav/ProfileTabIcon.tsx && git commit -m "feat(mobile): pending-report badge on profile tab"`

---

### Task M8: Full mobile CI mirror

- [ ] **Step 1:** Run: `pnpm exec turbo run lint typecheck test --filter=mobile` Expected: green.
- [ ] **Step 2:** `cd mobile && npx expo-doctor` (patch drift benign; don't chase Expo bumps).
- [ ] **Step 3:** Fix any failures, commit as needed.

**→ Open PR 3, CI green, Codex PR-review loop to APPROVED, address comments, squash-merge.**

---

## Self-Review notes (author)

- **Spec coverage:** upload (B12), list+gated reads (B11), own-delete + report (B13), admin queue/hide/dismiss/delete + summary (B14), first-photo point + reverse/reactivate (B8/B12/B13/B14), reservation/quotas (B9/B12), storage/private+presign (B3/B11), image pipeline (B4), CityFountainPin (B10/B15), infra (I1/I2), web carousel/upload/report/queue/badge/city-thumb (W3–W8/W5), mobile equivalents (M3–M7). All spec sections map to a task.
- **Multipart** handled explicitly on both clients (W2 raw fetch with a server-side token; M2 sanitized `uploadMultipart` through the existing x-dev-stripping/bearer fetch) — the one place the typed api-client doesn't fit.
- **Type consistency:** `PhotoOut.url`/`thumbnail_url` are API-relative everywhere; clients prefix with the API base (W3/W4/W5/M3/M4). `photo_first` has no stat counter. Advisory-lock namespaces are distinct constants (B9).
- **Deferred (spec-approved):** per-IP throttling, new-account trust tiers, presign window-snapping, a `storage_cleanup` janitor — noted, not built.
