# Generalized Content Reporting (#11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the photos-only `photo_reports` with a polymorphic `content_reports` table and let signed-in users report **notes** and **fountains** (photos already reportable), on web and mobile, with the existing photo report/moderation path preserved byte-for-byte.

**Architecture:** One polymorphic `content_reports` table (`content_type` ∈ {photo,note,fountain} + soft `content_id` + denormalized `fountain_id` FK CASCADE), following the codebase's existing `contribution_events` soft-target precedent. A shared chokepoint (`app/reports.py`) does per-type category validation + rate-limit + idempotent insert. The existing photo report endpoint and photo admin queue are repointed onto the new table (kept photo-only — generalizing the admin queue is #12); notes and fountains get nested report endpoints and generalized web/mobile report UI.

**Tech Stack:** FastAPI + async SQLAlchemy 2 + Alembic + PostGIS (backend), Next.js 16 (web), Expo SDK 56 / React Native (mobile), `packages/api-client` (openapi-typescript + openapi-fetch).

**Source spec:** `docs/specs/2026-07-06-content-reporting-design.md` (Codex-APPROVED). Section refs below (`spec §N`) point there.

## Global Constraints

- **Windows host, backslash paths** in file tools; **Bash tool is Git Bash** (forward slashes). Backend runs under **`uv`** (`cd backend && uv run …`); DB container on **port 5436** (`./run.ps1 up`; fresh container needs `uv run alembic upgrade head`).
- **`run.ps1` aborts on tool stderr** — run CI-mirror commands via the **Bash tool**: backend `cd backend && uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`; JS `pnpm exec turbo run lint typecheck test --filter=<pkg>`.
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution**, **no time estimates** anywhere.
- **Backend endpoint/schema change → `pnpm run generate`** (repo root) and **commit** regenerated `packages/api-client/{openapi.json,src/schema.d.ts}`.
- **Alembic**: deterministic constraint/index names per `models.py` `NAMING_CONVENTION` (short CHECK names — the `stars_range` double-prefix trap); every migration reversible; `alembic check` drift-free; CHECK/index names verified against `pg_constraint`/`pg_indexes` (alembic check ignores CHECK defs).
- **Logging**: structured, no bare `print`, no secrets/PII/**raw report notes** in logs; a 500 is never silent.
- **Auth**: reuse existing deps — `get_current_user` (report; any signed-in user, display name NOT required), `require_admin` (admin). Never self-mint tokens; dev-auth seam stays closed in prod.
- **Every PR**: CI green **AND** Codex `VERDICT: APPROVED` **AND** every PR comment addressed → squash-merge. Codex `cwd` = the WSL path **derived from the current repo root** (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`; never hardcode), bypass mode (`sandbox: danger-full-access`, `approval-policy: never`).

---

## PR / branch strategy

**Single PR** off `feat/11-content-reporting` bundling backend + api-client + web + mobile. The change is cohesive (one table, two endpoints, generalized UI), and the repo squash-merges even when a branch bundles topics. Backend tasks (B*) land first as commits, then api-client (C1), then web (W*), then mobile (M*); the PR opens after the full local mirror is green. The spec and this plan are already committed on the branch.

After merge: dispatch the **web deploy** and the **mobile store release** (see "Deployment" at the end).

---

## File Structure

**Backend (new):**
- `backend/app/reports.py` — the shared `create_content_report` chokepoint + per-type `ALLOWED_CATEGORIES`.
- `backend/migrations/versions/0021_content_reports.py` — create `content_reports`, data-migrate `photo_reports`, drop `photo_reports`.
- `backend/tests/test_content_reports.py` — chokepoint + note/fountain report tests.
- `backend/tests/test_content_reports_migration.py` — data-migration integrity + round-trip.

**Backend (modified):** `models.py` (ContentReport replaces PhotoReport), `locks.py` (rename lock ns), `rate_limit.py` (count ContentReport), `schemas.py` (ReportContentRequest), `routers/photos.py` (report → chokepoint; owner-delete cleanup), `routers/fountains.py` (note + fountain report endpoints), `routers/admin.py` (queue/hide/dismiss/delete read/write content_reports; admin_delete_photo cleanup), plus repointed tests `tests/conftest.py`, `tests/test_rate_limit.py`, `tests/test_photos_delete_report.py`, `tests/test_admin_photos.py`.

**Web (new):** `web/components/fountain/ReportContentDialog.tsx` (generalized from `ReportPhotoDialog.tsx`).
**Web (modified):** the notes list + `FountainDetail.tsx` (note/fountain report affordances), `web/app/actions/…` (`reportContent` generalizing `reportPhoto`), `ReportPhotoDialog.tsx` usages, `docs/style-guide.md`.

**Mobile (new):** `mobile/components/fountain/ReportContentButton.tsx` (generalized from `ReportPhotoButton.tsx`).
**Mobile (modified):** the mobile notes rows + `mobile/app/fountains/[id].tsx` (note/fountain affordances), `mobile/lib/…` report helper.

*(Exact web/mobile note-list file paths are pinned in W2/M1 Step 1 by grepping for the existing note-render component.)*

---

# Backend

### Task B1: Replace `photo_reports` with polymorphic `content_reports` (photo path parity)

The atomic swap: model + migration + repoint every consumer + no-orphan cleanup, verified by the (repointed) existing photo tests staying green plus new migration/cleanup tests. **One coherent, reviewable deliverable** — the app is not importable between the model swap and the consumer repoint, so these land together.

**Files:**
- Modify: `backend/app/models.py`, `backend/app/locks.py`, `backend/app/rate_limit.py`, `backend/app/schemas.py`, `backend/app/routers/photos.py`, `backend/app/routers/admin.py`
- Create: `backend/app/reports.py`, `backend/migrations/versions/0021_content_reports.py`, `backend/tests/test_content_reports_migration.py`
- Modify (tests): `backend/tests/conftest.py`, `backend/tests/test_rate_limit.py`, `backend/tests/test_photos_delete_report.py`, `backend/tests/test_admin_photos.py`

**Interfaces — Produces:**
- `ContentReport` ORM model (`content_reports`).
- `app.reports.create_content_report(session, *, content_type: str, content_id: uuid.UUID, fountain_id: uuid.UUID, reporter_user_id: uuid.UUID, category: str, note: str | None) -> None` (422 on bad category, 429 on rate limit, idempotent insert, commits).
- `app.reports.ALLOWED_CATEGORIES: dict[str, frozenset[str]]`.
- `schemas.ReportContentRequest` (replaces `ReportPhotoRequest`).
- `locks.CONTENT_REPORT_LOCK_NS` (replaces `PHOTO_REPORT_LOCK_NS`, same value).

- [ ] **Step 1: Swap the model.** In `backend/app/models.py` remove `class PhotoReport` and add, near it:
```python
class ContentReport(Base):
    """Polymorphic user report flagging content for moderation (#11). Replaces
    `photo_reports`. `content_id` is a SOFT reference (no per-type FK — targets span
    tables, like ContributionEvent.target_id); integrity is enforced in the report
    chokepoint (app/reports.py) and by the fountain_id CASCADE. One *pending* report per
    (content_type, content_id, reporter); re-report allowed after resolution."""

    __tablename__ = "content_reports"
    __table_args__ = (
        CheckConstraint("content_type IN ('photo','note','fountain')", name="content_type"),
        CheckConstraint(
            "category IN ('spam','abuse','inappropriate','not_a_fountain','inaccurate','other')",
            name="category",
        ),
        CheckConstraint("status IN ('pending','resolved')", name="status"),
        CheckConstraint("resolution IN ('hidden','rejected')", name="resolution"),
        Index(
            "uq_content_reports_target_reporter_pending",
            "content_type", "content_id", "reporter_user_id",
            unique=True, postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "ix_content_reports_target_pending",
            "content_type", "content_id",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_content_reports_reporter_created", "reporter_user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    content_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_content_reports_fountain"),
        nullable=False,
    )
    reporter_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_content_reports_reporter"),
        nullable=False,
    )
    category: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'pending'"))
    resolution: Mapped[str | None] = mapped_column(String, nullable=True)
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", name="fk_content_reports_resolved_by"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
```

- [ ] **Step 2: Rename the lock.** In `backend/app/locks.py` rename `PHOTO_REPORT_LOCK_NS` → `CONTENT_REPORT_LOCK_NS` (keep the value `0x50525054`; update the comment to "content report rate gate").

- [ ] **Step 3: Repoint + refactor the rate limiter.** In `backend/app/rate_limit.py`: change the import `PhotoReport` → `ContentReport` and `PHOTO_REPORT_LOCK_NS` → `CONTENT_REPORT_LOCK_NS`; in `_count_reports_since` use `ContentReport`/`ContentReport.reporter_user_id`; update the docstring "count `photo_reports`" → "count `content_reports`"; limits unchanged. **Extract** the lock-free counting so the chokepoint can rate-check without re-acquiring the lock:
```python
async def enforce_report_rate(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Lock-free: raise RateLimited if the user is over the 60s/24h report windows.
    The CALLER must already hold the per-user report advisory lock."""
    minute_count = await _count_reports_since(session, user_id, _MINUTE_WINDOW_SECONDS)
    if minute_count >= REPORTS_PER_MIN:
        logger.info("report_rate_limited", extra={"user_id": str(user_id), "kind": "report_per_minute", "count": minute_count})
        raise RateLimited("reports_per_minute", retry_after=_MINUTE_WINDOW_SECONDS)
    day_count = await _count_reports_since(session, user_id, _DAY_WINDOW_SECONDS)
    if day_count >= REPORTS_PER_DAY:
        logger.info("report_rate_limited", extra={"user_id": str(user_id), "kind": "report_per_day", "count": day_count})
        raise RateLimited("reports_per_day", retry_after=_DAY_WINDOW_SECONDS)

async def check_report_rate(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Public gate (kept for tests/back-compat): acquire the lock, then enforce."""
    await acquire_user_lock(session, CONTENT_REPORT_LOCK_NS, user_id)
    await enforce_report_rate(session, user_id)
```
  This keeps `check_report_rate` (and `test_rate_limit.py`) behaving exactly as before while exposing `enforce_report_rate` for the chokepoint's dedupe-before-rate ordering (Step 4).

- [ ] **Step 4: Add the chokepoint** `backend/app/reports.py`. **Ordering is dedupe-BEFORE-rate** (Codex plan-review #2): a duplicate pending report is an idempotent 204 that consumes **no** rate budget, regardless of the reporter's quota state. The per-user advisory lock serializes a user's report requests, so the "already pending?" check + insert is race-free for that user; `ON CONFLICT DO NOTHING` remains a backstop. (This makes the idempotency guarantee unconditional — a strict, test-safe improvement over the old photo path, which rate-checked first; no existing photo test exercises a rate-limited duplicate.)
```python
import logging
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.locks import CONTENT_REPORT_LOCK_NS
from app.models import ContentReport
from app.rate_limit import RateLimited, acquire_user_lock, enforce_report_rate

logger = logging.getLogger(__name__)

ALLOWED_CATEGORIES: dict[str, frozenset[str]] = {
    "photo": frozenset({"inappropriate", "not_a_fountain", "spam", "other"}),
    "note": frozenset({"spam", "abuse", "inappropriate", "inaccurate", "other"}),
    "fountain": frozenset({"not_a_fountain", "spam", "inappropriate", "inaccurate", "other"}),
}


async def create_content_report(
    session: AsyncSession, *, content_type: str, content_id: uuid.UUID,
    fountain_id: uuid.UUID, reporter_user_id: uuid.UUID, category: str, note: str | None,
) -> None:
    """Idempotent, rate-limited report insert (spec §7). Category validated per content_type;
    a duplicate pending report is a silent no-op (idempotent 204) that consumes no rate budget;
    a NEW report is rate-limited. Commits. NEVER logs the raw note (PII)."""
    allowed = ALLOWED_CATEGORIES.get(content_type)
    if allowed is None:  # defensive: internal misuse of the soft-polymorphic boundary
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"unknown content_type: {content_type}")
    if category not in allowed:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"invalid category for {content_type}: {category}")

    # Serialize this user's report requests so dedupe-check + insert is race-free.
    await acquire_user_lock(session, CONTENT_REPORT_LOCK_NS, reporter_user_id)

    # Idempotent: an existing PENDING report by this reporter for this item -> no-op 204.
    existing = (await session.execute(
        select(ContentReport.id).where(
            ContentReport.content_type == content_type,
            ContentReport.content_id == content_id,
            ContentReport.reporter_user_id == reporter_user_id,
            ContentReport.status == "pending",
        ).limit(1)
    )).first()
    if existing is not None:
        await session.commit()  # releases the lock; no rate charge
        logger.info("content report duplicate ignored", extra={
            "content_type": content_type, "content_id": str(content_id),
            "user_id": str(reporter_user_id)})
        return

    # NEW report: apply the rate limit (lock already held).
    try:
        await enforce_report_rate(session, reporter_user_id)
    except RateLimited as exc:
        await session.rollback()
        logger.info("content report rate limited",
                    extra={"user_id": str(reporter_user_id), "reason": exc.reason})
        raise HTTPException(http_status.HTTP_429_TOO_MANY_REQUESTS, detail=exc.reason,
                            headers={"Retry-After": str(exc.retry_after)}) from exc

    stmt = (
        pg_insert(ContentReport)
        .values(content_type=content_type, content_id=content_id, fountain_id=fountain_id,
                reporter_user_id=reporter_user_id, category=category, note=note)
        .on_conflict_do_nothing(  # backstop; the lock already prevents same-user races
            index_elements=["content_type", "content_id", "reporter_user_id"],
            index_where=(ContentReport.status == "pending"),
        )
        .returning(ContentReport.id)
    )
    inserted = (await session.execute(stmt)).first() is not None
    await session.commit()
    logger.info("content reported", extra={
        "content_type": content_type, "content_id": str(content_id),
        "fountain_id": str(fountain_id), "user_id": str(reporter_user_id),
        "category": category, "inserted": inserted})
```

- [ ] **Step 5: Repoint the request schema.** In `backend/app/schemas.py` replace `ReportPhotoRequest` with:
```python
class ReportContentRequest(BaseModel):
    category: str
    note: str | None = Field(default=None, max_length=500)
```

- [ ] **Step 6: Repoint the photo report endpoint + owner-delete.** In `backend/app/routers/photos.py`:
  - `report_photo`: change the body param type to `ReportContentRequest`; **replace** the inline rate-check + `pg_insert(PhotoReport)` block with: load the scoped photo first (keep `_load_scoped_photo` → 404), then `await create_content_report(session, content_type="photo", content_id=photo.id, fountain_id=fountain_id, reporter_user_id=user.id, category=payload.category, note=payload.note)`; return 204. (Order: target-existence 404 precedes report handling; within the chokepoint a duplicate is a 204 regardless of quota, a new report is rate-limited — verified by the repointed tests in Step 9.)
  - `delete_own_photo`: **before** `delete(FountainPhoto)`, add
    `await session.execute(delete(ContentReport).where(ContentReport.content_type == "photo", ContentReport.content_id == photo_id))`; delete the now-false "cascades to `photo_reports`" comments (photos.py ~484, ~540).
  - **Imports:** add `ContentReport` (models) and `create_content_report` (`app.reports`); **remove the now-unused** `from sqlalchemy.dialects.postgresql import insert as pg_insert` (line 16) and drop `check_report_rate` from the `from app.rate_limit import …` line (line 33) — **keep** `RateLimited`, `reserve_upload`, `finalize_upload` (still used by the upload path). `ruff check` must be clean (it flags the unused imports — this is the single-commit-green hazard called out in Codex plan-review #4).

- [ ] **Step 7: Repoint the admin photo queue/actions (precise — NOT a blind rename).** `ContentReport` has **no `photo_id`**; every current `PhotoReport.photo_id` use maps to `ContentReport.content_id` **plus** a `ContentReport.content_type == "photo"` filter. In `backend/app/routers/admin.py`, for **each** of the queue, ranked-notes subquery, summary, hide-resolve, dismiss-resolve, and delete-cleanup:
  - Join `FountainPhoto.id == ContentReport.content_id` (was `== PhotoReport.photo_id`).
  - `GROUP BY` / `ORDER BY` / window-`PARTITION BY` / `COUNT(DISTINCT …)` on **`ContentReport.content_id`** (was `photo_id`).
  - Label the grouped id back to **`photo_id`** in the projection so `ReportedPhotoOut` (unchanged) still gets a `photo_id` field: `ContentReport.content_id.label("photo_id")`.
  - Add `ContentReport.content_type == "photo"` to the WHERE of the **grouped queue**, the **ranked-notes** subquery, the **summary** count (`count(DISTINCT content_id) … WHERE status='pending' AND content_type='photo'`), the **hide** `_resolve_pending_reports` UPDATE, and the **dismiss** UPDATE.
  - Repoint the `_resolve_pending_reports` helper (admin.py) to `UPDATE content_reports … WHERE content_type='photo' AND content_id=:photo_id AND status='pending'`.
  In `admin_delete_photo`: **before** `delete(FountainPhoto)`, add `await session.execute(delete(ContentReport).where(ContentReport.content_type == "photo", ContentReport.content_id == photo_id))`; delete the "cascades to `photo_reports`" comment (admin.py ~585). The queue stays photo-only (still joins `fountain_photos`); `ReportedPhotoOut` unchanged. `ruff check` + the repointed `test_admin_photos.py` (Step 9) prove no stale `PhotoReport`/`.photo_id` reference survives.

- [ ] **Step 8: Write the migration** `backend/migrations/versions/0021_content_reports.py`. Confirm head first: `cd backend && uv run alembic heads` (expect `0020_condition_award_window`). `revision = "0021_content_reports"`, `down_revision = "0020_condition_award_window"`. `upgrade()`:
```python
def upgrade() -> None:
    op.create_table(
        "content_reports",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("reporter_user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("resolution", sa.String(), nullable=True),
        sa.Column("resolved_by_user_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("content_type IN ('photo','note','fountain')", name="content_type"),
        sa.CheckConstraint(
            "category IN ('spam','abuse','inappropriate','not_a_fountain','inaccurate','other')",
            name="category"),
        sa.CheckConstraint("status IN ('pending','resolved')", name="status"),
        sa.CheckConstraint("resolution IN ('hidden','rejected')", name="resolution"),
        sa.PrimaryKeyConstraint("id", name="pk_content_reports"),
        sa.ForeignKeyConstraint(["fountain_id"], ["fountains.id"], ondelete="CASCADE",
                                name="fk_content_reports_fountain"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="CASCADE",
                                name="fk_content_reports_reporter"),
        sa.ForeignKeyConstraint(["resolved_by_user_id"], ["users.id"],
                                name="fk_content_reports_resolved_by"),
    )
    op.create_index("uq_content_reports_target_reporter_pending", "content_reports",
                    ["content_type", "content_id", "reporter_user_id"], unique=True,
                    postgresql_where=sa.text("status = 'pending'"))
    op.create_index("ix_content_reports_target_pending", "content_reports",
                    ["content_type", "content_id"], postgresql_where=sa.text("status = 'pending'"))
    op.create_index("ix_content_reports_reporter_created", "content_reports",
                    ["reporter_user_id", "created_at"])
    # Data-migrate existing photo reports (join fountain_photos for fountain_id), reusing ids.
    op.execute("""
        INSERT INTO content_reports
          (id, content_type, content_id, fountain_id, reporter_user_id, category, note,
           status, resolution, resolved_by_user_id, resolved_at, created_at)
        SELECT pr.id, 'photo', pr.photo_id, fp.fountain_id, pr.reporter_user_id, pr.category,
               pr.note, pr.status, pr.resolution, pr.resolved_by_user_id, pr.resolved_at,
               pr.created_at
        FROM photo_reports pr JOIN fountain_photos fp ON fp.id = pr.photo_id
    """)
    op.drop_table("photo_reports")
```
  `downgrade()` recreates `photo_reports` **verbatim from `0019_photo_reports.py`** (table + its 3 indexes), copies the photo rows back
  (`INSERT INTO photo_reports (id, photo_id, reporter_user_id, category, note, status, resolution, resolved_by_user_id, resolved_at, created_at) SELECT id, content_id, reporter_user_id, category, note, status, resolution, resolved_by_user_id, resolved_at, created_at FROM content_reports WHERE content_type = 'photo'`),
  then `op.drop_table("content_reports")`. (Note/fountain reports are dropped on downgrade — documented in the spec §4.)

- [ ] **Step 9: Repoint the existing tests + the autouse fixture.**
  - **CRITICAL — `tests/conftest.py`:** the autouse `clean_db` fixture `TRUNCATE`s `photo_reports` (conftest.py:37). After the migration that table is gone, so this **must** be changed `photo_reports` → `content_reports` in the TRUNCATE list — otherwise **every** test errors ("relation photo_reports does not exist"). `content_reports` FKs `fountains`/`users` which are already in the `CASCADE` list, so only the name changes.
  - `test_rate_limit.py`, `test_photos_delete_report.py`, `test_admin_photos.py`: replace `PhotoReport`→`ContentReport`, `photo_reports`→`content_reports`, and any direct-construct of a report row to include `content_type="photo"`, `content_id=<photo_id>`, `fountain_id=<fountain_id>` (was `photo_id=`). Keep every assertion. The dedupe-first order (Step 4) is behavior-compatible with the existing non-rate-limited duplicate-204 test and the distinct-report rate-limit test; adjust only if a test specifically constructs a rate-limited *duplicate* expecting 429 (none should — it would now be 204).

- [ ] **Step 10a: No-orphan cleanup + idempotency tests** (head DB — extend `test_photos_delete_report.py` / `test_admin_photos.py`):
  - **No-orphan — owner delete:** seed a photo + a pending content report on it; `DELETE /fountains/{fid}/photos/{pid}` (owner); assert `SELECT count(*) FROM content_reports WHERE content_type='photo' AND content_id=:pid` == 0.
  - **No-orphan — admin delete:** same via `DELETE /admin/photos/{pid}`; 0 orphans.
  - **Fountain cascade:** seed reports on a fountain's photo AND on the fountain itself (`content_type='fountain'`); `DELETE /admin/fountains/{fid}`; assert all that fountain's `content_reports` are gone.
  - **Photo-delete isolation:** deleting photo A leaves a report on unrelated photo B intact.
  - **Duplicate-at-quota idempotency (Codex plan-review #2 R2):** order matters — establish X's pending report BEFORE filling the quota. As `test_user`: (1) report photo X once while under quota → **204**, exactly one pending `(photo, X, reporter)` row; (2) seed `REPORTS_PER_MIN - 1` additional in-window `content_reports` for the same reporter on **distinct** content_ids (reporter now at `REPORTS_PER_MIN`); (3) re-report photo X → **204**, **no** new row, **no** 429 (idempotent duplicate consumes no budget); (4) separately, a NEW report on a different photo Y at the same quota → **429**. This proves dedupe-before-rate. (The endpoint returns 204, never 201.)

- [ ] **Step 10b: Real data-migration test** `backend/tests/test_content_reports_migration.py` — an **isolated temporary database** (the shared test DB is externally pinned at head; the async Alembic env can't be stepped in-process because `env.py` calls `asyncio.run`, so drive it via **subprocess**). Skeleton:
```python
import subprocess, uuid, os
from pathlib import Path
import asyncpg, pytest
from sqlalchemy.engine import make_url
from app.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]

def _urls():
    u = make_url(get_settings().database_url)                 # postgresql+asyncpg://…/fountainrank
    tmp = f"cr_migtest_{uuid.uuid4().hex[:12]}"
    admin_dsn = f"postgresql://{u.username}:{u.password}@{u.host}:{u.port}/postgres"
    tmp_pg   = f"postgresql://{u.username}:{u.password}@{u.host}:{u.port}/{tmp}"   # asyncpg.connect
    tmp_alembic = str(u.set(database=tmp))                     # postgresql+asyncpg://…/<tmp>  (env DATABASE_URL)
    return tmp, admin_dsn, tmp_pg, tmp_alembic

def _alembic(rev, database_url):
    subprocess.run(["uv", "run", "alembic", "upgrade", rev] if rev != "down" else [],
                   check=True, cwd=BACKEND, env={**os.environ, "DATABASE_URL": database_url})

@pytest.mark.asyncio
async def test_photo_reports_data_migration_roundtrip():
    tmp, admin_dsn, tmp_pg, tmp_alembic = _urls()
    admin = await asyncpg.connect(dsn=admin_dsn)
    await admin.execute(f'CREATE DATABASE "{tmp}"')
    try:
        # 1) up to just-before this migration
        subprocess.run(["uv","run","alembic","upgrade","0020_condition_award_window"],
                       check=True, cwd=BACKEND, env={**os.environ, "DATABASE_URL": tmp_alembic})
        # 2) seed user + fountain + photo + a PENDING and a RESOLVED photo_reports row (raw)
        c = await asyncpg.connect(dsn=tmp_pg)
        uid, fid, pid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        rep_pending, rep_resolved = uuid.uuid4(), uuid.uuid4()
        await c.execute("INSERT INTO users (id, logto_user_id, display_name, email) VALUES ($1,$2,$3,$4)",
                        uid, "m", "M", "m@e.com")
        await c.execute("INSERT INTO fountains (id, location, added_by_user_id, created_source) "
                        "VALUES ($1, ST_SetSRID(ST_MakePoint(0,0),4326)::geography, $2, 'user')", fid, uid)
        await c.execute("INSERT INTO fountain_photos (id, fountain_id, user_id, storage_key, thumbnail_key, "
                        "content_type, width, height, byte_size) VALUES "
                        "($1,$2,$3,'k','t','image/jpeg',10,10,10)", pid, fid, uid)
        await c.execute("INSERT INTO photo_reports (id, photo_id, reporter_user_id, category, note, status) "
                        "VALUES ($1,$2,$3,'spam','hi','pending')", rep_pending, pid, uid)
        await c.execute("INSERT INTO photo_reports (id, photo_id, reporter_user_id, category, status, "
                        "resolution, resolved_by_user_id, resolved_at) VALUES "
                        "($1,$2,$3,'other','resolved','hidden',$3, now())", rep_resolved, pid, uid)
        await c.close()
        # 3) apply the migration under test
        subprocess.run(["uv","run","alembic","upgrade","0021_content_reports"],
                       check=True, cwd=BACKEND, env={**os.environ, "DATABASE_URL": tmp_alembic})
        c = await asyncpg.connect(dsn=tmp_pg)
        rows = {r["id"]: r for r in await c.fetch("SELECT * FROM content_reports")}
        assert set(rows) == {rep_pending, rep_resolved}
        assert rows[rep_pending]["content_type"] == "photo"
        assert rows[rep_pending]["content_id"] == pid
        assert rows[rep_pending]["fountain_id"] == fid            # <- the JOIN got fountain_id right
        assert rows[rep_pending]["category"] == "spam" and rows[rep_pending]["note"] == "hi"
        assert rows[rep_resolved]["status"] == "resolved" and rows[rep_resolved]["resolution"] == "hidden"
        assert not await c.fetch("SELECT 1 FROM information_schema.tables WHERE table_name='photo_reports'")
        await c.close()
        # 4) downgrade recreates photo_reports (0019 shape) + copies photo rows back
        subprocess.run(["uv","run","alembic","downgrade","0020_condition_award_window"],
                       check=True, cwd=BACKEND, env={**os.environ, "DATABASE_URL": tmp_alembic})
        c = await asyncpg.connect(dsn=tmp_pg)
        back = {r["id"] for r in await c.fetch("SELECT id FROM photo_reports")}
        assert back == {rep_pending, rep_resolved}
        idx = {r["indexname"] for r in await c.fetch("SELECT indexname FROM pg_indexes WHERE tablename='photo_reports'")}
        assert "uq_photo_reports_photo_reporter_pending" in idx and "ix_photo_reports_reporter_pending_created" in idx
        checks = {r["conname"] for r in await c.fetch(
            "SELECT conname FROM pg_constraint WHERE conrelid='photo_reports'::regclass AND contype='c'")}
        # NAMING_CONVENTION renders short CHECK names to ck_<table>_<name> (the stars_range trap),
        # so the DB connames are the rendered forms, NOT 'category'/'status'/'resolution'.
        assert {"ck_photo_reports_category", "ck_photo_reports_status",
                "ck_photo_reports_resolution"} <= checks
        assert not await c.fetch("SELECT 1 FROM information_schema.tables WHERE table_name='content_reports'")
        await c.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{tmp}" WITH (FORCE)')
        await admin.close()
```
  Notes: subprocess (not in-process `command.upgrade`) because `env.py` does `asyncio.run(...)`, which can't run inside pytest-asyncio's loop; a **fresh temp DB** keeps the shared test DB untouched and lets us seed `photo_reports` (which no longer exists at head). Confirm `asyncpg` is importable in tests (it's the app's driver) and the DB role can `CREATE DATABASE` (the postgis dev container + CI service superuser can). If `uv run alembic` isn't resolvable in the subprocess env, use the alembic console script on PATH or `python -m alembic`.

- [ ] **Step 11: Run the full backend mirror + verify names.** Run: `cd backend && uv run alembic upgrade head && uv run alembic check` (expect drift-free), then verify the rendered `content_reports` names against `pg_constraint`/`pg_indexes` (`\d content_reports`). Expected **CHECK** connames (convention-rendered, per the `stars_range` trap): `ck_content_reports_content_type`, `ck_content_reports_category`, `ck_content_reports_status`, `ck_content_reports_resolution`. Expected **FK** connames: `fk_content_reports_fountain`, `fk_content_reports_reporter`, `fk_content_reports_resolved_by`. Expected **index** names (verbatim, not convention-rendered): `uq_content_reports_target_reporter_pending`, `ix_content_reports_target_pending`, `ix_content_reports_reporter_created`. Then `cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest`. Round-trip: `uv run alembic downgrade -1 && uv run alembic upgrade head`. Expected: all green, `photo_reports` gone, photo tests pass.

- [ ] **Step 12: Commit.**
```bash
git add backend/app backend/migrations backend/tests
git commit -m "feat(backend): replace photo_reports with polymorphic content_reports (#11)"
```

---

### Task B2: Note report endpoint

**Files:** Modify `backend/app/routers/fountains.py`; Test `backend/tests/test_content_reports.py`

**Interfaces — Consumes:** `create_content_report` (B1). **Produces:** `POST /api/v1/fountains/{fountain_id}/notes/{note_id}/report` → 204.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_content_reports.py` (seed user + fountain + a note; mirror the report assertions in `test_photos_delete_report.py`):
```python
# any signed-in user reports a note -> 204 and a content_reports row (content_type='note',
#   content_id=note_id, fountain_id) exists
# category outside {spam,abuse,inappropriate,inaccurate,other} -> 422 (e.g. 'not_a_fountain')
# note text > 500 -> 422
# duplicate pending report -> 204 AND the session still commits (no IntegrityError); exactly 1 row
# report rate limit -> 429: seed REPORTS_PER_MIN prior content_reports for the reporter (distinct
#   content_ids, in-window) so the NEXT new report (a fresh note) -> 429 with Retry-After
#   (re-reporting the SAME note would dedupe to 204, never reaching the limit)
# report on a HIDDEN note allowed (is_hidden=True note still 204)
# unknown note_id -> 404 ; note whose fountain_id != path {fountain_id} -> 404
# the raw note text is never emitted in logs (caplog assertion on the 'content reported' record)
```

- [ ] **Step 2: Run — expect FAIL.** `cd backend && uv run pytest tests/test_content_reports.py -v`

- [ ] **Step 3: Implement** in `fountains.py` (near the notes endpoints ~1058). Add `ReportContentRequest` + `create_content_report` imports:
```python
@router.post("/fountains/{fountain_id}/notes/{note_id}/report",
             status_code=status.HTTP_204_NO_CONTENT)
async def report_note(
    fountain_id: uuid.UUID, note_id: uuid.UUID, payload: ReportContentRequest,
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session),
) -> None:
    # Scoped existence (reporting a hidden note is allowed — moderators want the signal).
    note = (await session.execute(
        select(FountainNote).where(FountainNote.id == note_id,
                                   FountainNote.fountain_id == fountain_id))).scalar_one_or_none()
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="note not found")
    await create_content_report(session, content_type="note", content_id=note.id,
        fountain_id=fountain_id, reporter_user_id=user.id,
        category=payload.category, note=payload.note)
```

- [ ] **Step 4: Run — expect PASS.** `cd backend && uv run pytest tests/test_content_reports.py -v`

- [ ] **Step 5: Commit.** `git add backend/app/routers/fountains.py backend/tests/test_content_reports.py && git commit -m "feat(backend): report a note endpoint (#11)"`

---

### Task B3: Fountain report endpoint

**Files:** Modify `backend/app/routers/fountains.py`; Test `backend/tests/test_content_reports.py`

**Interfaces — Produces:** `POST /api/v1/fountains/{fountain_id}/report` → 204.

- [ ] **Step 1: Write failing tests** (append to `test_content_reports.py`):
```python
# report a fountain -> 204, row (content_type='fountain', content_id=fountain_id, fountain_id same)
# category outside {not_a_fountain,spam,inappropriate,inaccurate,other} -> 422 (e.g. 'abuse')
# an OSM-imported fountain (created_source='osm') is reportable -> 204
# duplicate pending -> 204, exactly 1 row ; rate limit -> 429 ; note>500 -> 422
# unknown fountain_id -> 404
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement:**
```python
@router.post("/fountains/{fountain_id}/report", status_code=status.HTTP_204_NO_CONTENT)
async def report_fountain(
    fountain_id: uuid.UUID, payload: ReportContentRequest,
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session),
) -> None:
    exists = (await session.execute(
        select(Fountain.id).where(Fountain.id == fountain_id))).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    await create_content_report(session, content_type="fountain", content_id=fountain_id,
        fountain_id=fountain_id, reporter_user_id=user.id,
        category=payload.category, note=payload.note)
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit.** `git add backend/app/routers/fountains.py backend/tests/test_content_reports.py && git commit -m "feat(backend): report a fountain endpoint (#11)"`

---

### Task C1: Regenerate api-client + full backend mirror

**Files:** Modify `packages/api-client/{openapi.json,src/schema.d.ts}`

- [ ] **Step 1: Regenerate.** Run (repo root): `pnpm run generate`. Expected: the report request type becomes `ReportContentRequest` and the two new endpoints appear.
- [ ] **Step 2: Full backend mirror.** `cd backend && uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest` — all green.
- [ ] **Step 3: api-client typecheck.** `pnpm exec turbo run lint typecheck test --filter=@fountainrank/api-client` (use the real package name from `packages/api-client/package.json`). Green.
- [ ] **Step 4: Commit.** `git add packages/api-client/openapi.json packages/api-client/src/schema.d.ts && git commit -m "chore(api-client): regenerate for content report endpoints (#11)"`

---

# Web

### Task W1: Style guide + generalize the report dialog

**Files:** Modify `docs/style-guide.md`; rename/generalize `web/components/fountain/ReportPhotoDialog.tsx` → `web/components/fountain/ReportContentDialog.tsx`; the report server action; Test `web/components/fountain/ReportContentDialog.test.tsx`

- [ ] **Step 1: Locate the pattern.** Read `web/components/fountain/ReportPhotoDialog.tsx` and the `reportPhoto` server action (grep `reportPhoto` in `web/app/actions/`). Note the props/category list and how it calls the api-client.
- [ ] **Step 2: Style guide.** In `docs/style-guide.md`, generalize the existing photo report-dialog entry to a **content report dialog** (props: `contentType`, `fountainId`, `contentId`, `categories`, submit/already-reported states) and document the note/fountain **flag/report control**.
- [ ] **Step 3: Write the failing test** `ReportContentDialog.test.tsx` (mirror any existing dialog test): renders the category options for a given `categories` prop; on submit calls the `reportContent` action with `{contentType, fountainId, contentId, category, note}`; shows "Reported"/"Already reported".
- [ ] **Step 4: Run — expect FAIL.** `pnpm exec turbo run test --filter=web`
- [ ] **Step 5: Implement.** Rename the component to `ReportContentDialog`, parameterize it by `{ contentType: 'photo'|'note'|'fountain'; fountainId; contentId; categories: string[] }`, and generalize the `reportPhoto` action to `reportContent(contentType, fountainId, contentId, category, note)` that POSTs the matching nested endpoint (`…/photos/{id}/report`, `…/notes/{id}/report`, `…/{fid}/report`). Keep the existing photo call site working by passing `contentType="photo"` + the photo categories.
- [ ] **Step 6: Run — expect PASS**, plus `pnpm exec turbo run lint typecheck --filter=web`.
- [ ] **Step 7: Commit.** `git add web docs/style-guide.md && git commit -m "feat(web): generalized content report dialog (#11)"`

### Task W2: Note + fountain report affordances

**Files:** Modify the web notes-list component + `web/components/fountain/FountainDetail.tsx`; Test alongside

- [ ] **Step 1: Locate.** Grep `NoteOut`/notes render in `web/components/fountain/` to find the note-row component.
- [ ] **Step 2: Failing test** — a note row renders a "Report" control that opens `ReportContentDialog` with `contentType="note"`, `contentId={note.id}`; the detail page renders a "Report this fountain" control with `contentType="fountain"`, `contentId={fountainId}`.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement** the two affordances (note categories `["spam","abuse","inappropriate","inaccurate","other"]`; fountain categories `["not_a_fountain","spam","inappropriate","inaccurate","other"]`), auth-gated like the photo report control.
- [ ] **Step 5: Run — expect PASS** + `pnpm exec turbo run lint typecheck test --filter=web` + `pnpm exec turbo run build --filter=web`.
- [ ] **Step 6: Commit.** `git add web && git commit -m "feat(web): report affordances for notes and fountains (#11)"`

---

# Mobile

### Task M1: Generalize the report button + note/fountain affordances

**Files:** rename `mobile/components/fountain/ReportPhotoButton.tsx` → `ReportContentButton.tsx`; Modify the mobile notes rows + `mobile/app/fountains/[id].tsx`; report helper; Test `mobile/**/*.test.ts`

- [ ] **Step 1: Locate.** Read `mobile/components/fountain/ReportPhotoButton.tsx` + `mobile/lib/` report helper; grep the mobile notes render.
- [ ] **Step 2: Failing test** (mobile Vitest — mirror existing pure-helper/component tests): the report helper POSTs the correct nested endpoint per `contentType`; `ReportContentButton` offers the per-type categories.
- [ ] **Step 3: Run — expect FAIL.** `pnpm exec turbo run test --filter=mobile`
- [ ] **Step 4: Implement** `ReportContentButton` parameterized by `{contentType, fountainId, contentId, categories}`; add a report control to each mobile note row (`contentType="note"`) and a "Report this fountain" action on the detail screen (`contentType="fountain"`); keep the photo call site working (`contentType="photo"`).
- [ ] **Step 5: Run — expect PASS** + `pnpm exec turbo run lint typecheck test --filter=mobile` + `cd mobile && npx expo-doctor`.
- [ ] **Step 6: Commit.** `git add mobile && git commit -m "feat(mobile): report affordances for notes and fountains (#11)"`

---

### Task Z1: Full CI mirror + open PR

- [ ] **Step 1: Full mirror.** `./run.ps1 check` (backend + workspace-js + web build + mobile). All green. If it aborts on stderr, run the scoped Bash commands from Global Constraints per workspace.
- [ ] **Step 2: Push + open PR** `feat/11-content-reporting` → `main`, body referencing #11 + the spec, summarizing the polymorphic table + note/fountain reporting + photo repoint. Monitor CI to green.
- [ ] **Step 3: Codex PR review loop** (`claude_help/codex-review-process.md`, Loop B) until `VERDICT: APPROVED`; address every PR comment.
- [ ] **Step 4: Squash-merge** once CI green + Codex approved + comments addressed.

---

## Deployment (after merge)

Per project memory, **merge does not deploy** — deploys are manual dispatch.
- **Backend + web:** `gh workflow run deploy.yml --ref main`; monitor to success (the new endpoints are backend; web ships the report UI). *(The `content_reports` migration runs as part of the backend deploy's Alembic upgrade.)*
- **Mobile store release:** dispatch the mobile store-release workflow (`gh workflow run <mobile-store-release>.yml --ref main`), confirming the release notes; monitor.

Confirm both with the user per their request for web + mobile releases.

## Self-Review (done before Codex)

- **Spec coverage:** content_reports table (B1) ✓; migrate+drop photo_reports (B1 Step 8) ✓; repoint rate/photos/admin/schemas/locks (B1) ✓; no-orphan cleanup both photo delete paths (B1 Steps 6–7,10) ✓; chokepoint + per-type categories (B1 Step 4, §6) ✓; note report (B2) ✓; fountain report (B3) ✓; api-client (C1) ✓; web dialog+affordances (W1–W2) ✓; mobile (M1) ✓; tests (each task) ✓; style guide (W1) ✓; #11/#12 boundary — admin queue stays photo-only ✓.
- **No placeholders:** endpoint/model/migration/chokepoint code is complete; repoint/test steps reference exact existing patterns + assertion lists.
- **Type consistency:** `create_content_report(...)` signature, `ReportContentRequest`, `ContentReport`, `CONTENT_REPORT_LOCK_NS`, and the category sets are used identically across B1–M1.
