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

- [ ] **Step 3: Repoint the rate limiter.** In `backend/app/rate_limit.py`: change the import `PhotoReport` → `ContentReport` and `PHOTO_REPORT_LOCK_NS` → `CONTENT_REPORT_LOCK_NS`; in `_count_reports_since` use `ContentReport`/`ContentReport.reporter_user_id`; `check_report_rate` uses `CONTENT_REPORT_LOCK_NS`. Update the module docstring line that says "count `photo_reports`" → "count `content_reports`". Limits unchanged.

- [ ] **Step 4: Add the chokepoint** `backend/app/reports.py`:
```python
import logging
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContentReport
from app.rate_limit import RateLimited, check_report_rate

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
    """Rate-limited, idempotent report insert (spec §7). Category validated per content_type
    BEFORE consuming rate budget; a duplicate pending report is a silent no-op (idempotent).
    Commits. NEVER logs the raw note (PII)."""
    if category not in ALLOWED_CATEGORIES[content_type]:
        raise HTTPException(
            http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"invalid category for {content_type}: {category}",
        )
    try:
        await check_report_rate(session, reporter_user_id)  # acquires CONTENT_REPORT_LOCK_NS
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
        .on_conflict_do_nothing(
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
  - `report_photo`: change the body param type to `ReportContentRequest`; **replace** the inline rate-check + `pg_insert(PhotoReport)` block with: load the scoped photo first (keep `_load_scoped_photo` → 404), then `await create_content_report(session, content_type="photo", content_id=photo.id, fountain_id=fountain_id, reporter_user_id=user.id, category=payload.category, note=payload.note)`; return 204. (Order refinement: target-existence 404 now precedes the 429; a rate-limited report on a valid photo still 429s — verified by the repointed tests in Step 9.)
  - `delete_own_photo`: **before** `delete(FountainPhoto)`, add
    `await session.execute(delete(ContentReport).where(ContentReport.content_type == "photo", ContentReport.content_id == photo_id))`; delete the now-false "cascades to `photo_reports`" comments (photos.py ~484, ~540). Import `ContentReport`.

- [ ] **Step 7: Repoint the admin photo queue/actions.** In `backend/app/routers/admin.py`, mechanical `PhotoReport` → `ContentReport` and add `ContentReport.content_type == "photo"` to every report query (queue group-by, summary count, hide-resolve, dismiss). In `admin_delete_photo`: **before** `delete(FountainPhoto)`, add the same explicit `delete(ContentReport).where(content_type=="photo", content_id==photo_id)`; delete the "cascades to `photo_reports`" comment (admin.py ~585). The queue still joins `fountain_photos` (photo-only) — unchanged behavior; `ReportedPhotoOut` unchanged.

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

- [ ] **Step 9: Repoint the existing tests.** In `conftest.py`, `test_rate_limit.py`, `test_photos_delete_report.py`, `test_admin_photos.py`: replace `PhotoReport`→`ContentReport`, `photo_reports`→`content_reports`, and any direct-construct of a report row to include `content_type="photo"`, `content_id=<photo_id>`, `fountain_id=<fountain_id>` (was `photo_id=`). Keep every assertion. Adjust only if a test asserts 429-*before*-404 on the photo report (order changed in Step 6 to 404-first) — update it to target a valid photo for the rate-limit case.

- [ ] **Step 10: Add migration + cleanup tests** `backend/tests/test_content_reports_migration.py` and extend the delete tests. Assert:
  - **No-orphan cleanup — owner delete:** create a photo + a pending content report on it; `DELETE /fountains/{fid}/photos/{pid}` (owner); then `SELECT count(*) FROM content_reports WHERE content_type='photo' AND content_id=:pid` == 0.
  - **No-orphan cleanup — admin delete:** same, via `DELETE /admin/photos/{pid}`; 0 orphans.
  - **Fountain cascade:** create reports on a fountain's photo AND on the fountain itself; delete the fountain (`admin.py::delete_fountain`); all its `content_reports` gone.
  - **Photo-delete isolation:** deleting photo A's row leaves a report on unrelated photo B intact.
  - *(Migration data-integrity is covered by the alembic round-trip in Step 11 against a DB seeded with a photo report; if the CI DB is empty, add a pytest that inserts a photo_reports-shaped row pre-migration is impractical mid-suite — instead assert the schema post-migration: `content_reports` exists, `photo_reports` does not, and a photo report round-trips through the chokepoint.)*

- [ ] **Step 11: Run the full backend mirror + verify names.** Run: `cd backend && uv run alembic upgrade head && uv run alembic check` (expect drift-free), then verify the 4 CHECK names + 3 index names against `pg_indexes`/`pg_constraint` (`\d content_reports` or a `select … from pg_indexes where tablename='content_reports'`), then `cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest`. Round-trip: `uv run alembic downgrade -1 && uv run alembic upgrade head`. Expected: all green, `photo_reports` gone, photo tests pass.

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
# report rate limit -> 429 (fire REPORTS_PER_MIN+1)
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
