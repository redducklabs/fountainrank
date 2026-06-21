# OSM / Protomaps Fountain Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest OpenStreetMap-derived public drinking-water locations as first-class, rateable `fountains` rows with separable provenance, idempotent/auditable/concurrency-safe imports, scope-limited removal, and zero pollution of contributor/gamification accounting.

**Architecture:** Extend the existing Phase-1 domain. Split **row origin** (`fountains.created_source` + nullable `added_by_user_id`) from **external provenance** (new `fountain_provenances`, 1 fountain → many). Add durable run/candidate/event tables for dry-run, audit, and rollback. A backend CLI (`python -m app.imports.cli`) parses an extract into filtered candidates, then a merge service upserts them under the **same advisory lock** the add endpoint uses, with `FOR UPDATE` on any matched row before movement decisions. Reads gain an `is_hidden` visibility filter. The first import seeds existence + location + `is_working` + provenance + preserved tags only; tag→attribute mapping (#38/#40/#42) is explicitly out of scope.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async) + asyncpg, GeoAlchemy2, Alembic, PostgreSQL 17 + PostGIS 3.x, Pydantic v2, pytest/pytest-asyncio. Source spec: `docs/specs/2026-06-21-osm-fountain-ingestion-design.md` (Codex Loop A APPROVED).

## Global Constraints

- **Python** `>=3.13,<3.14`. Do **not** add or bump dependencies. The OSM extract format is **GeoJSON** (a regional Geofabrik/PBF extract pre-converted to GeoJSON, or an Overpass GeoJSON response for fixtures); parse it with the stdlib `json` module — no new PBF/OSM libraries in this slice.
- **Windows host:** backslash paths with Read/Write/Edit (`D:\repos\fountainrank\...`). The Bash tool is Git Bash (forward slashes, `/d/repos/fountainrank/...`).
- **Local CI mirror is `./run.ps1 check -Backend`** = `ruff check` + `ruff format --check` + `alembic upgrade head` + `alembic check` (no drift) + `pytest`, against the compose `db` on port **5436** (`./run.ps1 up` starts it). `alembic check` reporting **no drift is a hard gate**. Run the full `./run.ps1 check` before opening the PR if the generated API contract changes (it does — Task 7 adds a 409 schema).
- **`alembic check` does NOT compare CHECK-constraint definitions or names** (per `claude_help/testing-ci.md`). Every CHECK/index this plan adds MUST be verified directly against `pg_constraint`/`pg_indexes` in a test.
- **Coordinate order:** the API speaks `latitude`/`longitude`; PostGIS takes `(longitude, latitude)`. All conversion goes through `app.geo.point_geography` — the importer never hand-rolls ordering.
- **Logging:** structured logs only for diagnostics (no bare `print` for diagnostics); never log secrets, full DB URLs, raw tag blobs, or unsanitized source URLs (spec §10). **Carve-out:** the importer CLI's single final JSON line to **stdout is its documented machine-readable operator-command result contract**, not a diagnostic — all diagnostics still flow through structured logging (`merge_candidates` emits the run summary as a structured log line).
- **OSM is a non-user source:** never create a rating, a #40 verification, or a #41 note from OSM; never set a synthetic `added_by_user_id`. Imported rows award no contribution credit (spec §4.3, §8).
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution** in commits/PRs. **No time estimates** anywhere.
- **Source-control:** branch `feat/osm-fountain-ingestion` → PR → CI green + Codex `VERDICT: APPROVED` + all comments addressed → squash-merge. Do not commit to `main`.

---

## File Structure

**New backend modules:**
- `backend/app/locks.py` — `ADD_FOUNTAIN_LOCK_KEY` constant (promoted from `routers/fountains.py`), shared by the add endpoint and the importer.
- `backend/app/imports/__init__.py` — package marker.
- `backend/app/imports/osm.py` — pure parsing/normalization/filtering: GeoJSON features → validated `OsmCandidate` objects (tag allow-list, size caps, coordinate validation, lifecycle/confidence rules). No DB access.
- `backend/app/imports/merge.py` — the DB merge service: idempotent provenance-id + spatial matching under the shared advisory lock, movement policy, durable events, scope-limited removal, run recording, dry-run.
- `backend/app/imports/cli.py` — argparse entry (`python -m app.imports.cli`): load extract → parse → merge (apply or dry-run) → structured run summary.

**Modified backend files:**
- `backend/app/models.py` — `Fountain` gets `created_source`, `is_hidden`, nullable `added_by_user_id`, two CHECKs; new `FountainProvenance`, `OsmImportRun`, `OsmImportCandidate`, `FountainImportEvent`.
- `backend/app/config.py` — movement thresholds + tag-size caps settings.
- `backend/app/schemas.py` — `DuplicateFountainConflict`.
- `backend/app/routers/fountains.py` — import the shared lock; add `is_hidden` filter to all read/duplicate/rating paths; typed 409 body on add.
- `backend/migrations/versions/0004_osm_ingestion.py` — **new** migration.
- `backend/tests/conftest.py` — extend `clean_db` TRUNCATE list; add an `admin`/import fixtures helper.

**New tests:**
- `backend/tests/test_locks.py`
- `backend/tests/test_osm_ingestion_migration.py` — columns, CHECK names via `pg_constraint`, index names via `pg_indexes`, nullable owner.
- `backend/tests/test_visibility_filter.py` — hidden rows excluded from nearby/bbox/detail/duplicate/rating.
- `backend/tests/test_add_fountain_conflict.py` — typed 409 body + OpenAPI component.
- `backend/tests/test_osm_parser.py` — allow-list, size caps, coord validation, lifecycle/confidence, centroid.
- `backend/tests/test_osm_merge.py` — insert, provenance-id idempotency (no churn), spatial-match-to-user (no move, origin unchanged), movement thresholds, concurrent import-vs-add, scope-limited removal, dry-run mutates nothing, rollback by run id.
- `backend/tests/test_osm_cli.py` — end-to-end CLI dry-run + apply on a fixture.
- `backend/tests/fixtures/osm_*.geojson` — small GeoJSON fixtures.

**Frontend:** `packages/api-client` is regenerated (gitignored). After Task 7, run `./run.ps1 generate` then `./run.ps1 check -ApiClient -Web -Mobile` and confirm green. The web add→verify UX consuming the 409 `fountain_id` is a **separate follow-up PR**, not this plan.

---

## Interface Reference (shared across tasks)

Exact names/signatures later tasks rely on. Defined in the noted task; repeated here so out-of-order readers agree.

**`app/locks.py`** (Task 1):
- `ADD_FOUNTAIN_LOCK_KEY: int = 0x464E5452` — the advisory-lock key for serializing fountain create/merge.

**`app/models.py`** (Task 2):
- `Fountain` adds `created_source: Mapped[str]` (default `'user'`), `is_hidden: Mapped[bool]` (default `False`), `added_by_user_id: Mapped[uuid.UUID | None]`.
- `FountainProvenance(id: UUID, fountain_id: UUID, source_system: str, source_dataset: str, scope_id: str, source_external_id: str, osm_type: str|None, osm_id: int|None, source_tags: dict|None, confidence: str|None, geometry_kind: str|None, first_seen_at: datetime, last_seen_at: datetime, removed_at: datetime|None, first_import_run_id: UUID, last_import_run_id: UUID, created_at: datetime, updated_at: datetime)` — unique index `uq_fountain_provenances_source_external` on `(source_system, source_external_id)`.
- `OsmImportRun(id: UUID, started_at, finished_at: datetime|None, status: str, dry_run: bool, source_system, source_dataset, source_build_id, source_label, scope_id: str, scope_bounds: <Geography|None>, candidate_count, inserted_count, updated_count, matched_existing_count, provenance_attached_count, skipped_count, removed_count, review_flagged_count: int, error_summary: str|None)`.
- `OsmImportCandidate(id: UUID, run_id: UUID, source_external_id: str, osm_type: str|None, osm_id: int|None, location: <Geography>, tags: dict|None, confidence: str|None, skip_reason: str|None, matched_fountain_id: UUID|None, action: str)`.
- `FountainImportEvent(id: UUID, run_id: UUID, fountain_id: UUID|None, provenance_id: UUID|None, operation: str, prior_values: dict|None, created_at: datetime)`.

**`app/config.py`** (Task 3):
- `osm_move_small_max_m: float = 25.0`, `osm_move_review_min_m: float = 100.0`
- `osm_tag_max_key_len: int = 64`, `osm_tag_max_value_len: int = 255`, `osm_tags_max_bytes: int = 4096`

**`app/schemas.py`** (Task 7):
- `DuplicateFountainConflict(detail: str = "duplicate_fountain", fountain_id: uuid.UUID)`

**`app/imports/osm.py`** (Task 5):
- `OSM_TAG_ALLOWLIST: frozenset[str]` — `{amenity, man_made, drinking_water, fee, access, bottle, wheelchair, indoor, operator, check_date, opening_hours, seasonal, description}`.
- `@dataclass(frozen=True) class OsmCandidate(source_external_id: str, osm_type: str, osm_id: int, latitude: float, longitude: float, tags: dict[str,str], confidence: str, geometry_kind: str)`.
- `@dataclass(frozen=True) class ParseResult(candidates: list[OsmCandidate], skipped: list[tuple[str, str]])` — `skipped` is `(source_external_id_or_raw, skip_reason)`.
- `parse_osm_geojson(geojson: dict, *, max_key_len: int, max_value_len: int, max_tags_bytes: int) -> ParseResult`.
- `normalize_external_id(osm_type: str, osm_id: int) -> str` → `f"osm:{osm_type}:{osm_id}"`.

**`app/imports/merge.py`** (Task 6 & 8):
- `@dataclass class RunScope(source_system: str, source_dataset: str, source_build_id: str, source_label: str, scope_id: str, scope_bounds_wkt: str | None)`.
- `@dataclass class RunSummary(run_id: uuid.UUID, candidate_count, inserted_count, updated_count, matched_existing_count, provenance_attached_count, skipped_count, removed_count, review_flagged_count: int, dry_run: bool)`.
- `async merge_candidates(session: AsyncSession, *, scope: RunScope, candidates: list[OsmCandidate], skipped: list[tuple[str,str]], dry_run: bool) -> RunSummary`.
- `async rollback_run(session: AsyncSession, run_id: uuid.UUID) -> int` — reverses a run's events; returns affected row count; never deletes rows with ratings or user provenance.

**`app/imports/cli.py`** (Task 9):
- `async run_import(path: str, *, scope: RunScope, dry_run: bool) -> RunSummary`.
- `main(argv: list[str] | None = None) -> int`.

---

## Task 1: Promote the advisory-lock key to a shared module

**Files:**
- Create: `backend/app/locks.py`
- Modify: `backend/app/routers/fountains.py:27-33,243`
- Test: `backend/tests/test_locks.py`

**Interfaces:**
- Produces: `app.locks.ADD_FOUNTAIN_LOCK_KEY`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_locks.py
from app.locks import ADD_FOUNTAIN_LOCK_KEY


def test_add_fountain_lock_key_is_fntr():
    assert ADD_FOUNTAIN_LOCK_KEY == 0x464E5452


def test_router_uses_shared_lock_key():
    import app.routers.fountains as f

    assert f.ADD_FOUNTAIN_LOCK_KEY is ADD_FOUNTAIN_LOCK_KEY
```

- [ ] **Step 2: Run test — expect failure**

Run: `./run.ps1 check -Backend` (or `cd backend; python -m pytest tests/test_locks.py -v`)
Expected: FAIL — `ImportError: cannot import name 'ADD_FOUNTAIN_LOCK_KEY' from 'app.locks'`.

- [ ] **Step 3: Create the module**

```python
# backend/app/locks.py
"""Shared Postgres advisory-lock keys.

Promoted from routers/fountains.py so the add-fountain endpoint and the OSM
importer serialize their spatial check-then-write against the SAME key (a
transaction-level advisory lock; releases on commit/rollback). Two writers
keyed differently would each pass the proximity check before the other commits
and both insert a near-duplicate.
"""

# "FNTR" — the single global add/merge serialization key (low write volume).
ADD_FOUNTAIN_LOCK_KEY = 0x464E5452
```

- [ ] **Step 4: Point the router at the shared key**

In `backend/app/routers/fountains.py`, delete the local `_ADD_FOUNTAIN_LOCK_KEY = 0x464E5452` definition (and its comment block at lines 27-33), add `from app.locks import ADD_FOUNTAIN_LOCK_KEY` near the other `app.` imports, and change the lock acquisition (line ~243) from `func.pg_advisory_xact_lock(_ADD_FOUNTAIN_LOCK_KEY)` to `func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)`.

- [ ] **Step 5: Run tests + existing add tests — expect pass**

Run: `cd backend; python -m pytest tests/test_locks.py tests/test_fountains_add.py -v`
Expected: PASS (the add path still serializes; nothing else changed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/locks.py backend/app/routers/fountains.py backend/tests/test_locks.py
git commit -m "refactor: promote add-fountain advisory lock key to app.locks for importer reuse"
```

---

## Task 2: ORM models — fountain origin/visibility + provenance/run/candidate/event tables

**Files:**
- Modify: `backend/app/models.py`
- Test: covered by Task 4's migration test (models + migration verified together after the migration exists).

**Interfaces:** see Interface Reference → `app/models.py`.

- [ ] **Step 1: Extend `Fountain`**

In `backend/app/models.py`, `CheckConstraint` and `Index` are already imported and the bool columns use inferred `Mapped[bool]` — so **no new imports are needed for `Fountain`** (do NOT add `from sqlalchemy import Boolean`; it would be unused and fail ruff `F401`). Modify the `Fountain` class:

```python
class Fountain(Base):
    __tablename__ = "fountains"
    __table_args__ = (
        # NOTE (migration): fountains already exists, so the migration ALTERs these in
        # with FULL literal names (op.create_check_constraint applies no naming
        # convention) — here the convention renders the short names to the SAME
        # ck_fountains_* names. Keep both in sync (verified via pg_constraint in Task 4).
        CheckConstraint(
            "created_source IN ('user','osm','admin_import')", name="created_source"
        ),
        CheckConstraint(
            "created_source <> 'user' OR added_by_user_id IS NOT NULL",
            name="user_source_requires_user",
        ),
        # Spec §4.1: btree index on created_source for import/audit queries.
        Index("ix_fountains_created_source", "created_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True), nullable=False
    )
    is_working: Mapped[bool] = mapped_column(nullable=False, server_default=text("true"))
    is_hidden: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    created_source: Mapped[str] = mapped_column(nullable=False, server_default=text("'user'"))
    comments: Mapped[str | None] = mapped_column(String, nullable=True)
    # Nullable now: imported rows have no human owner. The CHECK above enforces that a
    # created_source='user' row still has an owner.
    added_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_rated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rating_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    average_rating: Mapped[float | None] = mapped_column(Double, nullable=True)
    ranking_score: Mapped[float | None] = mapped_column(Double, nullable=True)
```

- [ ] **Step 2: Add the new models** (append after `Rating`)

```python
from sqlalchemy import BigInteger  # add to the sqlalchemy import block
from sqlalchemy.dialects.postgresql import JSONB  # add near the PgUUID import


class FountainProvenance(Base):
    __tablename__ = "fountain_provenances"
    __table_args__ = (
        Index(
            "uq_fountain_provenances_source_external",
            "source_system",
            "source_external_id",
            unique=True,
        ),
        Index("ix_fountain_provenances_fountain_id", "fountain_id"),
        Index("ix_fountain_provenances_scope", "source_system", "scope_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountains.id", ondelete="CASCADE"), nullable=False
    )
    source_system: Mapped[str] = mapped_column(String, nullable=False)
    source_dataset: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str] = mapped_column(String, nullable=False)
    source_external_id: Mapped[str] = mapped_column(String, nullable=False)
    osm_type: Mapped[str | None] = mapped_column(String, nullable=True)
    osm_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    source_tags: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String, nullable=True)
    geometry_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_import_run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("osm_fountain_import_runs.id"), nullable=False
    )
    last_import_run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("osm_fountain_import_runs.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class OsmImportRun(Base):
    __tablename__ = "osm_fountain_import_runs"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'running'"))
    dry_run: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    source_system: Mapped[str] = mapped_column(String, nullable=False)
    source_dataset: Mapped[str] = mapped_column(String, nullable=False)
    source_build_id: Mapped[str] = mapped_column(String, nullable=False)
    source_label: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str] = mapped_column(String, nullable=False)
    scope_bounds: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POLYGON", srid=4326, spatial_index=False), nullable=True
    )
    candidate_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    inserted_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    updated_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    matched_existing_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    provenance_attached_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    skipped_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    removed_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    review_flagged_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    error_summary: Mapped[str | None] = mapped_column(String, nullable=True)


class OsmImportCandidate(Base):
    __tablename__ = "osm_fountain_import_candidates"
    __table_args__ = (Index("ix_osm_fountain_import_candidates_run_id", "run_id"),)

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("osm_fountain_import_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_external_id: Mapped[str] = mapped_column(String, nullable=False)
    osm_type: Mapped[str | None] = mapped_column(String, nullable=True)
    osm_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    location: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=True
    )
    tags: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String, nullable=True)
    skip_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    matched_fountain_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)


class FountainImportEvent(Base):
    __tablename__ = "fountain_import_events"
    __table_args__ = (Index("ix_fountain_import_events_run_id", "run_id"),)

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("osm_fountain_import_runs.id"), nullable=False
    )
    # Nullable FKs (spec): a candidate may be skipped (no fountain), and rollback may delete
    # a provenance row — ON DELETE SET NULL keeps the audit event without dangling refs.
    fountain_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountains.id", ondelete="SET NULL"), nullable=True
    )
    provenance_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountain_provenances.id", ondelete="SET NULL"), nullable=True
    )
    operation: Mapped[str] = mapped_column(String, nullable=False)
    prior_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
```

- [ ] **Step 3: Lint only (no DB yet)**

Run: `cd backend; python -m ruff check app/models.py && python -m ruff format --check app/models.py`
Expected: PASS. (Full verification happens in Task 4 with the migration.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(models): fountain origin/visibility + provenance/run/candidate/event ORM models"
```

---

## Task 3: Config settings (movement thresholds + tag caps)

**Files:**
- Modify: `backend/app/config.py:54-65` (after the Phase 1 block)
- Test: `backend/tests/test_osm_parser.py` (Task 5) and `test_osm_merge.py` (Task 6) consume these; a small direct assertion here.

- [ ] **Step 1: Add settings**

In `backend/app/config.py`, after the `max_results` line (inside `Settings`):

```python
    # --- OSM ingestion (see docs/specs/2026-06-21-osm-fountain-ingestion-design.md) ---
    # Auto-update an imported-only, unrated fountain's location only if it moved <= this.
    osm_move_small_max_m: float = 25.0
    # Movement at/above this flags a review candidate instead of moving.
    osm_move_review_min_m: float = 100.0
    # Untrusted-tag guards for the allow-listed source_tags jsonb.
    osm_tag_max_key_len: int = 64
    osm_tag_max_value_len: int = 255
    osm_tags_max_bytes: int = 4096
```

- [ ] **Step 2: Write + run a defaults test**

```python
# add to backend/tests/test_osm_parser.py later, or a quick check now:
from app.config import Settings


def test_osm_settings_defaults():
    s = Settings()
    assert s.osm_move_small_max_m == 25.0
    assert s.osm_move_review_min_m == 100.0
    assert s.osm_tags_max_bytes == 4096
```

Run: `cd backend; python -m pytest tests/test_osm_parser.py -k osm_settings_defaults -v` (after the file exists in Task 5) — or defer this assertion into Task 5's file.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/config.py
git commit -m "feat(config): OSM ingestion movement thresholds and tag-size caps"
```

---

## Task 4: Alembic migration `0004_osm_ingestion`

**Files:**
- Create: `backend/migrations/versions/0004_osm_ingestion.py`
- Modify: `backend/tests/conftest.py:30` (extend TRUNCATE)
- Test: `backend/tests/test_osm_ingestion_migration.py`

**Interfaces:**
- Consumes: the ORM models from Task 2 (names must match exactly so `alembic check` is drift-free).

- [ ] **Step 1: Write the migration**

```python
# backend/migrations/versions/0004_osm_ingestion.py
"""osm ingestion: fountain origin/visibility + provenance/run/candidate/event tables

Revision ID: 0004_osm_ingestion
Revises: 0003_seed_rating_types
Create Date: 2026-06-21
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0004_osm_ingestion"
down_revision = "0003_seed_rating_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) fountains: new columns (server_default backfills existing rows), then nullable owner.
    op.add_column(
        "fountains",
        sa.Column("is_hidden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "fountains",
        sa.Column(
            "created_source", sa.String(), server_default=sa.text("'user'"), nullable=False
        ),
    )
    op.alter_column("fountains", "added_by_user_id", existing_type=PgUUID(as_uuid=True), nullable=True)
    # 2) CHECKs added LAST, after backfill. FULL literal names (op applies no naming
    #    convention on ALTER) so they match the ORM's conventioned ck_fountains_* names.
    op.create_check_constraint(
        "ck_fountains_created_source",
        "fountains",
        "created_source IN ('user','osm','admin_import')",
    )
    op.create_check_constraint(
        "ck_fountains_user_source_requires_user",
        "fountains",
        "created_source <> 'user' OR added_by_user_id IS NOT NULL",
    )
    op.create_index("ix_fountains_created_source", "fountains", ["created_source"], unique=False)

    # 3) import runs (referenced by provenance/candidate/event FKs — create first).
    op.create_table(
        "osm_fountain_import_runs",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), server_default=sa.text("'running'"), nullable=False),
        sa.Column("dry_run", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("source_system", sa.String(), nullable=False),
        sa.Column("source_dataset", sa.String(), nullable=False),
        sa.Column("source_build_id", sa.String(), nullable=False),
        sa.Column("source_label", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column(
            "scope_bounds",
            geoalchemy2.types.Geography(
                geometry_type="POLYGON", srid=4326, from_text="ST_GeogFromText", name="geography",
                spatial_index=False,
            ),
            nullable=True,
        ),
        *[
            sa.Column(c, sa.Integer(), server_default=sa.text("0"), nullable=False)
            for c in (
                "candidate_count", "inserted_count", "updated_count", "matched_existing_count",
                "provenance_attached_count", "skipped_count", "removed_count", "review_flagged_count",
            )
        ],
        sa.Column("error_summary", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_osm_fountain_import_runs"),
    )

    # 4) provenance
    op.create_table(
        "fountain_provenances",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("source_system", sa.String(), nullable=False),
        sa.Column("source_dataset", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column("source_external_id", sa.String(), nullable=False),
        sa.Column("osm_type", sa.String(), nullable=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=True),
        sa.Column("source_tags", JSONB(), nullable=True),
        sa.Column("confidence", sa.String(), nullable=True),
        sa.Column("geometry_kind", sa.String(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_import_run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("last_import_run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_fountain_provenances"),
        sa.ForeignKeyConstraint(["fountain_id"], ["fountains.id"], ondelete="CASCADE", name="fk_fountain_provenances_fountain_id_fountains"),
        sa.ForeignKeyConstraint(["first_import_run_id"], ["osm_fountain_import_runs.id"], name="fk_fountain_provenances_first_import_run_id_osm_fountain_import_runs"),
        sa.ForeignKeyConstraint(["last_import_run_id"], ["osm_fountain_import_runs.id"], name="fk_fountain_provenances_last_import_run_id_osm_fountain_import_runs"),
    )
    op.create_index("uq_fountain_provenances_source_external", "fountain_provenances", ["source_system", "source_external_id"], unique=True)
    op.create_index("ix_fountain_provenances_fountain_id", "fountain_provenances", ["fountain_id"], unique=False)
    op.create_index("ix_fountain_provenances_scope", "fountain_provenances", ["source_system", "scope_id"], unique=False)

    # 5) candidates (staging)
    op.create_table(
        "osm_fountain_import_candidates",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("source_external_id", sa.String(), nullable=False),
        sa.Column("osm_type", sa.String(), nullable=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "location",
            geoalchemy2.types.Geography(
                geometry_type="POINT", srid=4326, from_text="ST_GeogFromText", name="geography",
                spatial_index=False,
            ),
            nullable=True,
        ),
        sa.Column("tags", JSONB(), nullable=True),
        sa.Column("confidence", sa.String(), nullable=True),
        sa.Column("skip_reason", sa.String(), nullable=True),
        sa.Column("matched_fountain_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_osm_fountain_import_candidates"),
        sa.ForeignKeyConstraint(["run_id"], ["osm_fountain_import_runs.id"], ondelete="CASCADE", name="fk_osm_fountain_import_candidates_run_id_osm_fountain_import_runs"),
    )
    op.create_index("ix_osm_fountain_import_candidates_run_id", "osm_fountain_import_candidates", ["run_id"], unique=False)

    # 6) events (durable rollback log)
    op.create_table(
        "fountain_import_events",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("provenance_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("prior_values", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_fountain_import_events"),
        sa.ForeignKeyConstraint(["run_id"], ["osm_fountain_import_runs.id"], name="fk_fountain_import_events_run_id_osm_fountain_import_runs"),
        sa.ForeignKeyConstraint(["fountain_id"], ["fountains.id"], ondelete="SET NULL", name="fk_fountain_import_events_fountain_id_fountains"),
        sa.ForeignKeyConstraint(["provenance_id"], ["fountain_provenances.id"], ondelete="SET NULL", name="fk_fountain_import_events_provenance_id_fountain_provenances"),
    )
    op.create_index("ix_fountain_import_events_run_id", "fountain_import_events", ["run_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_fountain_import_events_run_id", table_name="fountain_import_events")
    op.drop_table("fountain_import_events")
    op.drop_index("ix_osm_fountain_import_candidates_run_id", table_name="osm_fountain_import_candidates")
    op.drop_table("osm_fountain_import_candidates")
    op.drop_index("ix_fountain_provenances_scope", table_name="fountain_provenances")
    op.drop_index("ix_fountain_provenances_fountain_id", table_name="fountain_provenances")
    op.drop_index("uq_fountain_provenances_source_external", table_name="fountain_provenances")
    op.drop_table("fountain_provenances")
    op.drop_table("osm_fountain_import_runs")
    op.drop_constraint("ck_fountains_user_source_requires_user", "fountains", type_="check")
    op.drop_constraint("ck_fountains_created_source", "fountains", type_="check")
    op.drop_index("ix_fountains_created_source", table_name="fountains")
    # DESTRUCTIVE: imported rows have a NULL owner, so restoring NOT NULL on
    # added_by_user_id requires removing them first. This cascades to any ratings on
    # imported rows (FK ON DELETE CASCADE). Downgrade is a schema-rollback last resort,
    # NOT a data-preserving path for imported data — this migration is intentionally
    # only reversible on a database with no surviving imported rows' provenance.
    op.execute("DELETE FROM fountains WHERE created_source <> 'user'")
    op.alter_column("fountains", "added_by_user_id", existing_type=PgUUID(as_uuid=True), nullable=False)
    op.drop_column("fountains", "created_source")
    op.drop_column("fountains", "is_hidden")
```

> **Reversibility note (resolves plan-review-1 MAJOR):** this downgrade is data-safe for the *schema* but **deletes imported fountains** (and cascades to ratings on them) because a NULL-owner row cannot satisfy the restored NOT NULL. Do not describe the migration as fully reversible. The Step-5 downgrade test below covers BOTH the empty round-trip and a downgrade-after-import (proving the `ALTER ... SET NOT NULL` succeeds once imported rows are removed).

- [ ] **Step 2: Extend the test DB truncation**

In `backend/tests/conftest.py`, change the `clean_db` TRUNCATE (line ~30) to include the new tables so each test starts clean:

```python
        await conn.execute(
            _sa_text(
                "TRUNCATE fountain_import_events, osm_fountain_import_candidates, "
                "fountain_provenances, osm_fountain_import_runs, ratings, fountains, users "
                "RESTART IDENTITY CASCADE"
            )
        )
```

- [ ] **Step 3: Write the migration verification test**

```python
# backend/tests/test_osm_ingestion_migration.py
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_fountain_origin_columns_and_nullable_owner(session):
    cols = (await session.execute(text(
        "SELECT column_name, is_nullable FROM information_schema.columns "
        "WHERE table_name='fountains' AND column_name IN "
        "('created_source','is_hidden','added_by_user_id')"
    ))).all()
    by = {c: n for (c, n) in cols}
    assert by["created_source"] == "NO"
    assert by["is_hidden"] == "NO"
    assert by["added_by_user_id"] == "YES"  # now nullable


@pytest.mark.asyncio
async def test_fountains_check_constraints_present_by_definition(session):
    # alembic check compares NEITHER CHECK names NOR definitions. Assert the names plus KEY
    # TOKENS of each definition here; the negative-insert tests below are the authoritative
    # behavioral guard against expression drift (this token check is a fast smoke, not a
    # full expression-equivalence proof).
    rows = (await session.execute(text(
        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid='fountains'::regclass AND contype='c'"
    ))).all()
    defs = {name: definition for (name, definition) in rows}
    # Normalize whitespace; Postgres renders e.g. CHECK ((created_source = ANY (ARRAY[...])))
    cs = defs["ck_fountains_created_source"].lower()
    assert "created_source" in cs and "user" in cs and "osm" in cs and "admin_import" in cs
    owner = defs["ck_fountains_user_source_requires_user"].lower().replace(" ", "")
    assert "added_by_user_idisnotnull" in owner and "created_source" in owner


@pytest.mark.asyncio
async def test_fountain_and_provenance_indexes_present(session):
    fidx = set((await session.execute(text(
        "SELECT indexname FROM pg_indexes WHERE tablename='fountains'"
    ))).scalars().all())
    assert "ix_fountains_created_source" in fidx
    pidx = set((await session.execute(text(
        "SELECT indexname FROM pg_indexes WHERE tablename='fountain_provenances'"
    ))).scalars().all())
    assert "uq_fountain_provenances_source_external" in pidx


@pytest.mark.asyncio
async def test_user_source_requires_user_check_enforced(session):
    # Inserting a user-source fountain with no owner must violate the owner CHECK.
    with pytest.raises(Exception):
        await session.execute(text(
            "INSERT INTO fountains (id, location, is_working, created_source, added_by_user_id) "
            "VALUES (gen_random_uuid(), ST_GeogFromText('SRID=4326;POINT(0 0)'), true, 'user', NULL)"
        ))
        await session.flush()


@pytest.mark.asyncio
async def test_invalid_created_source_rejected(session):
    # An out-of-domain created_source must violate ck_fountains_created_source.
    with pytest.raises(Exception):
        await session.execute(text(
            "INSERT INTO fountains (id, location, is_working, created_source, added_by_user_id) "
            "VALUES (gen_random_uuid(), ST_GeogFromText('SRID=4326;POINT(0 0)'), true, 'bogus', NULL)"
        ))
        await session.flush()
```

- [ ] **Step 4: Apply + check drift + run tests**

Run:
```
cd backend
python -m alembic upgrade head
python -m alembic check        # MUST report no drift
python -m pytest tests/test_osm_ingestion_migration.py -v
```
Expected: upgrade applies; `alembic check` → "No new upgrade operations detected."; tests PASS. If `alembic check` reports drift, the ORM (Task 2) and migration column/type/index names disagree — reconcile names until clean.

- [ ] **Step 5: Verify downgrade — empty round-trip AND after-import**

Empty round-trip first:
```
python -m alembic downgrade -1 && python -m alembic upgrade head && python -m alembic check
```
Then prove the destructive-but-successful downgrade after an imported row exists (the `ALTER ... SET NOT NULL` would fail if the DELETE didn't run):
```
python -m alembic upgrade head
python - <<'PY'
import asyncio
from sqlalchemy import text
from app.db import get_sessionmaker
async def main():
    async with get_sessionmaker()() as s:
        await s.execute(text(
            "INSERT INTO fountains (id, location, is_working, created_source, added_by_user_id) "
            "VALUES (gen_random_uuid(), ST_GeogFromText('SRID=4326;POINT(0 0)'), true, 'osm', NULL)"
        ))
        await s.commit()
asyncio.run(main())
PY
python -m alembic downgrade -1     # must SUCCEED (deletes the imported row, then SET NOT NULL)
python -m alembic upgrade head && python -m alembic check
```
Expected: every command exits 0; `alembic check` clean. (Clean up the test row is automatic — downgrade deleted it; the `clean_db` fixture truncates for tests.)

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/0004_osm_ingestion.py backend/tests/conftest.py backend/tests/test_osm_ingestion_migration.py
git commit -m "feat(db): migration for OSM ingestion (origin/visibility + provenance/run/candidate/event)"
```

---

## Task 5: OSM GeoJSON parser + filtering (pure, no DB)

**Files:**
- Create: `backend/app/imports/__init__.py` (empty), `backend/app/imports/osm.py`
- Create: `backend/tests/fixtures/osm_basic.geojson`, `backend/tests/fixtures/osm_messy.geojson`
- Test: `backend/tests/test_osm_parser.py`

**Interfaces:** see Interface Reference → `app/imports/osm.py`.

- [ ] **Step 1: Write fixtures**

`backend/tests/fixtures/osm_basic.geojson` — two valid drinking_water nodes:

```json
{"type":"FeatureCollection","features":[
 {"type":"Feature","id":"node/1","properties":{"amenity":"drinking_water","wheelchair":"yes"},"geometry":{"type":"Point","coordinates":[-122.4194,37.7749]}},
 {"type":"Feature","id":"node/2","properties":{"man_made":"water_tap","drinking_water":"yes"},"geometry":{"type":"Point","coordinates":[-122.4000,37.7700]}}
]}
```

`backend/tests/fixtures/osm_messy.geojson` — exercises every skip/sanitize path:

```json
{"type":"FeatureCollection","features":[
 {"type":"Feature","id":"node/10","properties":{"disused:amenity":"drinking_water"},"geometry":{"type":"Point","coordinates":[1,1]}},
 {"type":"Feature","id":"node/11","properties":{"amenity":"drinking_water"},"geometry":{"type":"Point","coordinates":[200,99]}},
 {"type":"Feature","id":"node/12","properties":{"amenity":"fountain"},"geometry":{"type":"Point","coordinates":[2,2]}},
 {"type":"Feature","id":"way/13","properties":{"amenity":"drinking_water","secret_tag":"x","description":"clean water"},"geometry":{"type":"Polygon","coordinates":[[[3,3],[3,4],[4,4],[3,3]]]}}
]}
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_osm_parser.py
import json
from pathlib import Path

from app.config import Settings
from app.imports.osm import OSM_TAG_ALLOWLIST, normalize_external_id, parse_osm_geojson

FIX = Path(__file__).parent / "fixtures"
CAPS = dict(max_key_len=64, max_value_len=255, max_tags_bytes=4096)


def _load(name):
    return json.loads((FIX / name).read_text())


def test_osm_settings_defaults():
    s = Settings()
    assert s.osm_move_small_max_m == 25.0
    assert s.osm_move_review_min_m == 100.0
    assert s.osm_tags_max_bytes == 4096


def test_normalize_external_id():
    assert normalize_external_id("node", 5) == "osm:node:5"


def test_parses_valid_drinking_water():
    r = parse_osm_geojson(_load("osm_basic.geojson"), **CAPS)
    ids = {c.source_external_id for c in r.candidates}
    assert ids == {"osm:node:1", "osm:node:2"}
    c = next(c for c in r.candidates if c.source_external_id == "osm:node:1")
    assert c.latitude == 37.7749 and c.longitude == -122.4194
    assert c.tags["wheelchair"] == "yes"
    assert c.geometry_kind == "point"


def test_messy_features_are_skipped_or_sanitized():
    r = parse_osm_geojson(_load("osm_messy.geojson"), **CAPS)
    skipped = dict(r.skipped)
    # disused: lifecycle -> skipped
    assert any("disused" in reason or "lifecycle" in reason for reason in skipped.values())
    # out-of-range coords -> skipped
    assert "osm:node:11" in skipped
    # amenity=fountain WITHOUT drinking_water=yes -> skipped (not potable signal)
    assert "osm:node:12" in skipped
    # polygon -> centroid candidate, allow-list strips secret_tag, keeps description
    way = next((c for c in r.candidates if c.source_external_id == "osm:way:13"), None)
    assert way is not None and way.geometry_kind == "centroid"
    assert "secret_tag" not in way.tags and way.tags.get("description") == "clean water"


def test_allowlist_is_frozen_and_minimal():
    assert "amenity" in OSM_TAG_ALLOWLIST and "secret_tag" not in OSM_TAG_ALLOWLIST


def _feature(ext_num, access):
    return {"type": "FeatureCollection", "features": [{
        "type": "Feature", "id": f"node/{ext_num}",
        "properties": {"amenity": "drinking_water", "access": access},
        "geometry": {"type": "Point", "coordinates": [1.0, 2.0]},
    }]}


@pytest.mark.parametrize("access", ["private", "no", "customers", "permit"])
def test_non_public_access_is_skipped(access):
    r = parse_osm_geojson(_feature(1, access), **CAPS)
    assert r.candidates == []
    assert dict(r.skipped).get("osm:node:1") == "not_public"


def test_permissive_access_imported_at_medium_confidence():
    r = parse_osm_geojson(_feature(2, "permissive"), **CAPS)
    assert len(r.candidates) == 1 and r.candidates[0].confidence == "medium"


def test_public_access_imported_at_high_confidence():
    r = parse_osm_geojson(_feature(3, "yes"), **CAPS)
    assert len(r.candidates) == 1 and r.candidates[0].confidence == "high"
```

- [ ] **Step 3: Run — expect failure**

Run: `cd backend; python -m pytest tests/test_osm_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.imports'`.

- [ ] **Step 4: Implement the parser**

```python
# backend/app/imports/__init__.py
```
(empty file)

```python
# backend/app/imports/osm.py
"""Pure OSM GeoJSON parsing + filtering. No DB access — deterministic and unit-testable.

Turns a GeoJSON FeatureCollection into validated OsmCandidate objects, applying the
target-set rules (spec §2), an untrusted-tag allow-list with size caps (spec §6), and
coordinate validation. Non-point geometry is reduced to its centroid and recorded as
geometry_kind='centroid'.
"""

from __future__ import annotations

import json
import math
import unicodedata
from dataclasses import dataclass

OSM_TAG_ALLOWLIST: frozenset[str] = frozenset({
    "amenity", "man_made", "drinking_water", "fee", "access", "bottle", "wheelchair",
    "indoor", "operator", "check_date", "opening_hours", "seasonal", "description",
})
_LIFECYCLE_PREFIXES = ("disused:", "abandoned:", "construction:", "proposed:", "razed:", "removed:")
# access values that mean the public cannot freely use the feature (spec §2: exclude
# non-public). `permissive` IS publicly usable (by the owner's grace) -> imported at medium
# confidence. `yes`/`public`/unset -> public.
_NON_PUBLIC_ACCESS = frozenset({"private", "no", "customers", "permit"})


@dataclass(frozen=True)
class OsmCandidate:
    source_external_id: str
    osm_type: str
    osm_id: int
    latitude: float
    longitude: float
    tags: dict[str, str]
    confidence: str
    geometry_kind: str


@dataclass(frozen=True)
class ParseResult:
    candidates: list[OsmCandidate]
    skipped: list[tuple[str, str]]


def normalize_external_id(osm_type: str, osm_id: int) -> str:
    return f"osm:{osm_type}:{osm_id}"


def _parse_feature_id(raw_id: object) -> tuple[str | None, int | None]:
    # Accepts "node/123" (Overpass/osmtogeojson) or {"@id":...}; returns (type, id).
    if isinstance(raw_id, str) and "/" in raw_id:
        kind, _, num = raw_id.partition("/")
        if kind in ("node", "way", "relation") and num.isdigit():
            return kind, int(num)
    return None, None


def _centroid(coords: list) -> tuple[float, float] | None:
    # Average the flattened ring/line vertices — adequate for a POI centroid.
    pts: list[tuple[float, float]] = []

    def walk(x: object) -> None:
        if (
            isinstance(x, list) and len(x) == 2
            and all(isinstance(v, (int, float)) for v in x)
        ):
            pts.append((float(x[0]), float(x[1])))
        elif isinstance(x, list):
            for y in x:
                walk(y)

    walk(coords)
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _geometry_lonlat(geom: dict) -> tuple[float, float, str] | None:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Point" and isinstance(coords, list) and len(coords) >= 2:
        return float(coords[0]), float(coords[1]), "point"
    if gtype in ("Polygon", "MultiPolygon", "LineString", "MultiLineString") and coords:
        c = _centroid(coords)
        if c:
            return c[0], c[1], "centroid"
    return None


def _valid_lonlat(lon: float, lat: float) -> bool:
    return (
        math.isfinite(lon) and math.isfinite(lat)
        and -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0
    )


def _sanitize_value(v: object, max_value_len: int) -> str | None:
    if not isinstance(v, str):
        v = str(v)
    # Strip control characters; normalize; cap length.
    cleaned = "".join(ch for ch in v if unicodedata.category(ch)[0] != "C")
    cleaned = unicodedata.normalize("NFC", cleaned).strip()
    if not cleaned:
        return None
    return cleaned[:max_value_len]


def _build_tags(props: dict, *, max_key_len: int, max_value_len: int, max_tags_bytes: int) -> dict[str, str]:
    tags: dict[str, str] = {}
    for k, v in props.items():
        if not isinstance(k, str) or len(k) > max_key_len or k not in OSM_TAG_ALLOWLIST:
            continue
        sv = _sanitize_value(v, max_value_len)
        if sv is not None:
            tags[k] = sv
    # Cap total serialized size; drop largest values until under the byte cap.
    while tags and len(json.dumps(tags, ensure_ascii=False).encode("utf-8")) > max_tags_bytes:
        biggest = max(tags, key=lambda k: len(tags[k]))
        del tags[biggest]
    return tags


def _is_potable_candidate(props: dict) -> bool:
    if props.get("amenity") == "drinking_water":
        return True
    if props.get("man_made") == "water_tap" and props.get("drinking_water") == "yes":
        return True
    if props.get("amenity") == "fountain" and props.get("drinking_water") == "yes":
        return True
    return False


def _is_public_candidate(props: dict) -> bool:
    return props.get("access") not in _NON_PUBLIC_ACCESS


def _confidence(props: dict) -> str:
    if props.get("access") == "permissive":
        return "medium"  # publicly usable but not a public right -> lower confidence
    if props.get("amenity") == "drinking_water" and props.get("drinking_water") != "no":
        return "high"
    if props.get("drinking_water") == "yes":
        return "high"
    return "medium"


def parse_osm_geojson(geojson: dict, *, max_key_len: int, max_value_len: int, max_tags_bytes: int) -> ParseResult:
    candidates: list[OsmCandidate] = []
    skipped: list[tuple[str, str]] = []
    for feat in geojson.get("features", []):
        props = feat.get("properties") or {}
        osm_type, osm_id = _parse_feature_id(feat.get("id"))
        ext = normalize_external_id(osm_type, osm_id) if osm_type else str(feat.get("id"))
        if osm_type is None:
            skipped.append((ext, "unparseable_feature_id"))
            continue
        if any(any(k.startswith(p) for p in _LIFECYCLE_PREFIXES) for k in props):
            skipped.append((ext, "lifecycle_inactive"))
            continue
        if not _is_potable_candidate(props):
            skipped.append((ext, "not_potable_signal"))
            continue
        if not _is_public_candidate(props):
            skipped.append((ext, "not_public"))
            continue
        geom = _geometry_lonlat(feat.get("geometry") or {})
        if geom is None:
            skipped.append((ext, "no_usable_geometry"))
            continue
        lon, lat, kind = geom
        if not _valid_lonlat(lon, lat):
            skipped.append((ext, "invalid_coordinates"))
            continue
        candidates.append(OsmCandidate(
            source_external_id=ext, osm_type=osm_type, osm_id=osm_id,
            latitude=lat, longitude=lon,
            tags=_build_tags(props, max_key_len=max_key_len, max_value_len=max_value_len, max_tags_bytes=max_tags_bytes),
            confidence=_confidence(props), geometry_kind=kind,
        ))
    return ParseResult(candidates=candidates, skipped=skipped)
```

- [ ] **Step 5: Run — expect pass**

Run: `cd backend; python -m pytest tests/test_osm_parser.py -v`
Expected: PASS (all parser tests green).

- [ ] **Step 6: Commit**

```bash
git add backend/app/imports/__init__.py backend/app/imports/osm.py backend/tests/test_osm_parser.py backend/tests/fixtures/osm_basic.geojson backend/tests/fixtures/osm_messy.geojson
git commit -m "feat(imports): pure OSM GeoJSON parser with tag allow-list, size caps, coord validation"
```

---

## Task 6: Merge service — insert/match/idempotency under the shared lock

**Files:**
- Create: `backend/app/imports/merge.py`
- Test: `backend/tests/test_osm_merge.py` (this task: insert, provenance-id idempotency, spatial-match-to-user)

**Interfaces:** see Interface Reference → `app/imports/merge.py`. Consumes `app.locks.ADD_FOUNTAIN_LOCK_KEY`, `app.geo.point_geography`, Task 2 models, Task 5 `OsmCandidate`.

**Design notes for the implementer:**
- One DB transaction per `merge_candidates` call. Acquire `pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)` ONCE at the start (it's held to commit), then process candidates. This serializes the whole run against concurrent user adds — correct and simplest for the low write volume.
- Always create the `OsmImportRun` row first (so candidates/events can FK to it), even in dry-run.
- For each candidate, in order: (1) provenance-id match → update; else (2) spatial match within `duplicate_threshold_m` (ignoring `is_hidden=true` rows) → attach/movement; else (3) insert. Record an `OsmImportCandidate` (action + skip_reason/matched_fountain_id) for every candidate, and a `FountainImportEvent` for every **material** production mutation (insert, provenance_attach, provenance_update, update_location, mark_removed).
- **Freshness bookkeeping is exempt (deliberate):** `fountain_provenances.last_seen_at` and `last_import_run_id` advance on *every* observation of a feature (so audits know when it was last confirmed present). These two fields are pure bookkeeping — they carry no user-facing semantics, so they are intentionally NOT event-logged and NOT rolled back (reversing "we saw it" would corrupt audit history). A re-run with identical geometry/tags therefore advances `last_seen_at` but emits no event and does not touch the `fountains` row — that is the idempotency contract.
- **Before any movement/`rating_count` read on a matched row, `SELECT ... FOR UPDATE` that fountain row.**
- **dry_run=True:** still write the run + candidate rows (audit), but make ZERO changes to `fountains`, `fountain_provenances`, `fountain_import_events`. Implement by computing the action and writing only the candidate row when `dry_run`.
- Use `app.geo.point_geography(lat, lng)` for all geography literals. Distance via `func.ST_Distance`.

- [ ] **Step 1: Write the failing tests (this task's slice)**

```python
# backend/tests/test_osm_merge.py
import pytest
from sqlalchemy import func, select

from app.geo import point_geography
from app.imports.merge import RunScope, merge_candidates
from app.imports.osm import OsmCandidate
from app.models import Fountain, FountainProvenance, User

SCOPE = RunScope(
    source_system="osm", source_dataset="test:sf", source_build_id="b1",
    source_label="SF test", scope_id="test:sf", scope_bounds_wkt=None,
)


def _cand(ext_id, lat, lng, tags=None):
    t, n = ext_id.split(":")[1], int(ext_id.split(":")[2])
    return OsmCandidate(
        source_external_id=ext_id, osm_type=t, osm_id=n, latitude=lat, longitude=lng,
        tags=tags or {"amenity": "drinking_water"}, confidence="high", geometry_kind="point",
    )


@pytest.mark.asyncio
async def test_insert_creates_osm_fountain_with_provenance(session):
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    assert s.inserted_count == 1
    f = (await session.execute(select(Fountain))).scalar_one()
    assert f.created_source == "osm" and f.added_by_user_id is None and f.is_working is True
    assert f.rating_count == 0 and f.ranking_score is None
    prov = (await session.execute(select(FountainProvenance))).scalar_one()
    assert prov.source_external_id == "osm:node:1" and prov.fountain_id == f.id


@pytest.mark.asyncio
async def test_reimport_same_feature_is_idempotent(session):
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    f1 = (await session.execute(select(Fountain))).scalar_one()
    loc_before = f1.created_at
    s2 = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    count = (await session.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert count == 1  # no duplicate
    assert s2.inserted_count == 0 and s2.updated_count == 0  # nothing changed
    f2 = (await session.execute(select(Fountain))).scalar_one()
    assert f2.created_at == loc_before  # row untouched


@pytest.mark.asyncio
async def test_reimport_advances_last_seen_without_event(session):
    # A no-material re-run advances provenance freshness bookkeeping (last_seen_at) but
    # emits NO new FountainImportEvent and does not touch the fountain row.
    from app.models import FountainImportEvent
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    seen1 = (await session.execute(select(FountainProvenance.last_seen_at))).scalar_one()
    events1 = (await session.execute(select(func.count()).select_from(FountainImportEvent))).scalar_one()
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    seen2 = (await session.execute(select(FountainProvenance.last_seen_at))).scalar_one()
    events2 = (await session.execute(select(func.count()).select_from(FountainImportEvent))).scalar_one()
    assert seen2 >= seen1       # freshness advanced (bookkeeping)
    assert events2 == events1   # no NEW event for a pure freshness touch


@pytest.mark.asyncio
async def test_spatial_match_to_user_fountain_attaches_provenance_without_moving(session, test_user):
    # A user fountain at a point; OSM candidate ~5 m away (within duplicate threshold).
    uf = Fountain(location=point_geography(37.7700, -122.4000), is_working=True,
                  created_source="user", added_by_user_id=test_user.id)
    session.add(uf)
    await session.commit()
    before = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:9", 37.77004, -122.40000)], skipped=[], dry_run=False)
    await session.commit()
    assert s.provenance_attached_count == 1 and s.inserted_count == 0
    f = (await session.execute(select(Fountain))).scalar_one()
    assert f.created_source == "user" and f.added_by_user_id == test_user.id  # origin unchanged
    after = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    assert after == before  # NOT moved
    prov = (await session.execute(select(FountainProvenance))).scalar_one()
    assert prov.fountain_id == f.id and prov.source_external_id == "osm:node:9"
```

- [ ] **Step 2: Run — expect failure**

Run: `cd backend; python -m pytest tests/test_osm_merge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.imports.merge'`.

- [ ] **Step 3: Implement `merge.py` (insert/match/idempotency; movement + removal land in Task 8)**

```python
# backend/app/imports/merge.py
"""DB merge service for OSM candidates. Idempotent, concurrency-safe, auditable.

One transaction per call. A single advisory lock (shared with POST /fountains)
serializes the run's spatial check-then-write against concurrent user adds. Every
candidate yields a staging row; every production mutation yields a durable event.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.geo import point_geography
from app.imports.osm import OsmCandidate
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.models import (
    Fountain,
    FountainImportEvent,
    FountainProvenance,
    OsmImportCandidate,
    OsmImportRun,
)

log = logging.getLogger(__name__)


@dataclass
class RunScope:
    source_system: str
    source_dataset: str
    source_build_id: str
    source_label: str
    scope_id: str
    scope_bounds_wkt: str | None


@dataclass
class RunSummary:
    run_id: uuid.UUID
    candidate_count: int = 0
    inserted_count: int = 0
    updated_count: int = 0
    matched_existing_count: int = 0
    provenance_attached_count: int = 0
    skipped_count: int = 0
    removed_count: int = 0
    review_flagged_count: int = 0
    dry_run: bool = False


async def merge_candidates(
    session: AsyncSession,
    *,
    scope: RunScope,
    candidates: list[OsmCandidate],
    skipped: list[tuple[str, str]],
    dry_run: bool,
) -> RunSummary:
    now = datetime.now(tz=UTC)
    run = OsmImportRun(
        status="running", dry_run=dry_run, source_system=scope.source_system,
        source_dataset=scope.source_dataset, source_build_id=scope.source_build_id,
        source_label=scope.source_label, scope_id=scope.scope_id,
        scope_bounds=scope.scope_bounds_wkt,  # WKT text is accepted by the geography column on insert
    )
    session.add(run)
    await session.flush()  # assign run.id
    summary = RunSummary(run_id=run.id, dry_run=dry_run)

    if not dry_run:
        await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))

    settings = get_settings()
    for cand in candidates:
        summary.candidate_count += 1
        action, matched_id = await _merge_one(
            session, run=run, cand=cand, scope=scope, now=now,
            dry_run=dry_run, summary=summary, settings=settings,
        )
        session.add(OsmImportCandidate(
            run_id=run.id, source_external_id=cand.source_external_id,
            osm_type=cand.osm_type, osm_id=cand.osm_id,
            location=point_geography(cand.latitude, cand.longitude),
            tags=cand.tags, confidence=cand.confidence,
            skip_reason=None, matched_fountain_id=matched_id, action=action,
        ))

    for ext_id, reason in skipped:
        summary.skipped_count += 1
        session.add(OsmImportCandidate(
            run_id=run.id, source_external_id=ext_id, osm_type=None, osm_id=None,
            location=None, tags=None, confidence=None, skip_reason=reason,
            matched_fountain_id=None, action="skip",
        ))

    # Removal pass (scope-limited) is added in Task 8.

    run.status = "dry_run" if dry_run else "completed"
    run.finished_at = datetime.now(tz=UTC)
    run.candidate_count = summary.candidate_count
    run.inserted_count = summary.inserted_count
    run.updated_count = summary.updated_count
    run.matched_existing_count = summary.matched_existing_count
    run.provenance_attached_count = summary.provenance_attached_count
    run.skipped_count = summary.skipped_count
    run.removed_count = summary.removed_count
    run.review_flagged_count = summary.review_flagged_count
    await session.flush()
    log.info(
        "osm_import_run_complete",
        extra={"run_id": str(run.id), "dry_run": dry_run, "scope_id": scope.scope_id,
               "candidates": summary.candidate_count, "inserted": summary.inserted_count,
               "updated": summary.updated_count, "provenance_attached": summary.provenance_attached_count,
               "skipped": summary.skipped_count, "removed": summary.removed_count,
               "review_flagged": summary.review_flagged_count},
    )
    return summary


async def _merge_one(
    session: AsyncSession, *, run, cand, scope, now, dry_run, summary, settings
) -> tuple[str, uuid.UUID | None]:
    # Returns (action, matched_fountain_id) so the staging candidate row records WHICH
    # fountain a candidate matched — required for a precise/inspectable dry-run.
    # 1) provenance-id match
    prov = (await session.execute(
        select(FountainProvenance).where(
            FountainProvenance.source_system == scope.source_system,
            FountainProvenance.source_external_id == cand.source_external_id,
        )
    )).scalar_one_or_none()
    if prov is not None:
        summary.matched_existing_count += 1
        if dry_run:
            return "update", prov.fountain_id
        # Lock the owning fountain before any decision (movement lands in Task 8).
        await session.execute(select(Fountain).where(Fountain.id == prov.fountain_id).with_for_update())
        changed, prior = _refresh_provenance(prov, cand, run, now, scope)
        if changed:
            summary.updated_count += 1
            session.add(FountainImportEvent(
                run_id=run.id, fountain_id=prov.fountain_id, provenance_id=prov.id,
                operation="provenance_update", prior_values=prior,
            ))
        return "update", prov.fountain_id

    # 2) spatial match (ignore hidden rows)
    point = point_geography(cand.latitude, cand.longitude)
    match = (await session.execute(
        select(Fountain.id)
        .where(Fountain.is_hidden.is_(False))
        .where(func.ST_DWithin(Fountain.location, point, settings.duplicate_threshold_m))
        .order_by(func.ST_Distance(Fountain.location, point))
        .limit(1)
    )).scalar_one_or_none()
    if match is not None:
        summary.provenance_attached_count += 1
        if dry_run:
            return "match_provenance", match
        await session.execute(select(Fountain).where(Fountain.id == match).with_for_update())
        new_prov = _new_provenance(match, cand, run, now, scope)
        session.add(new_prov)
        await session.flush()
        session.add(FountainImportEvent(
            run_id=run.id, fountain_id=match, provenance_id=new_prov.id,
            operation="provenance_attach", prior_values=None,
        ))
        return "match_provenance", match

    # 3) insert
    summary.inserted_count += 1
    if dry_run:
        return "insert", None
    fountain = Fountain(
        location=point, is_working=True, created_source="osm", added_by_user_id=None,
    )
    session.add(fountain)
    await session.flush()
    new_prov = _new_provenance(fountain.id, cand, run, now, scope)
    session.add(new_prov)
    await session.flush()
    session.add(FountainImportEvent(
        run_id=run.id, fountain_id=fountain.id, provenance_id=new_prov.id,
        operation="insert", prior_values=None,
    ))
    return "insert", fountain.id


def _new_provenance(fountain_id, cand, run, now, scope) -> FountainProvenance:
    return FountainProvenance(
        fountain_id=fountain_id, source_system=scope.source_system,
        source_dataset=scope.source_dataset, scope_id=scope.scope_id,
        source_external_id=cand.source_external_id, osm_type=cand.osm_type, osm_id=cand.osm_id,
        source_tags=cand.tags, confidence=cand.confidence, geometry_kind=cand.geometry_kind,
        first_seen_at=now, last_seen_at=now, removed_at=None,
        first_import_run_id=run.id, last_import_run_id=run.id,
    )


def _refresh_provenance(prov, cand, run, now, scope) -> tuple[bool, dict | None]:
    # Update tags/scope; capture prior values so a provenance_update event can be reversed
    # by rollback. Returns (changed, prior_values_or_None). NOTE: last_seen_at and
    # last_import_run_id are freshness BOOKKEEPING — they advance every run, are NOT part of
    # `changed`, are NOT captured in prior_values, and are NOT rolled back (by design).
    changed = (
        prov.source_tags != cand.tags
        or prov.confidence != cand.confidence
        or prov.removed_at is not None
        or prov.scope_id != scope.scope_id
        or prov.source_dataset != scope.source_dataset
    )
    prior = None
    if changed:
        prior = {
            "source_tags": prov.source_tags,
            "confidence": prov.confidence,
            "removed_at": prov.removed_at.isoformat() if prov.removed_at else None,
            "scope_id": prov.scope_id,
            "source_dataset": prov.source_dataset,
        }
    prov.source_tags = cand.tags
    prov.confidence = cand.confidence
    prov.last_seen_at = now
    prov.removed_at = None
    prov.last_import_run_id = run.id
    prov.source_dataset = scope.source_dataset
    prov.scope_id = scope.scope_id
    return changed, prior
```

- [ ] **Step 4: Run — expect pass**

Run: `cd backend; python -m pytest tests/test_osm_merge.py -v`
Expected: the three Step-1 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/imports/merge.py backend/tests/test_osm_merge.py
git commit -m "feat(imports): OSM merge service — insert, provenance-id idempotency, spatial match to user fountain"
```

---

## Task 7: Visibility filter + typed 409 conflict on the fountains API

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/fountains.py`
- Test: `backend/tests/test_visibility_filter.py`, `backend/tests/test_add_fountain_conflict.py`, extend `backend/tests/test_openapi.py`

- [ ] **Step 1: Add the conflict schema**

In `backend/app/schemas.py`:

```python
class DuplicateFountainConflict(BaseModel):
    detail: str = "duplicate_fountain"
    fountain_id: uuid.UUID
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_visibility_filter.py
import pytest
from sqlalchemy import select

from app.geo import point_geography
from app.models import Fountain


async def _mk(session, lat, lng, hidden, user_id):
    f = Fountain(location=point_geography(lat, lng), is_working=True,
                 created_source="user", added_by_user_id=user_id, is_hidden=hidden)
    session.add(f)
    await session.commit()
    await session.refresh(f)
    return f


@pytest.mark.asyncio
async def test_hidden_excluded_from_bbox_nearby_detail(client, session, test_user):
    visible = await _mk(session, 37.77, -122.41, False, test_user.id)
    hidden = await _mk(session, 37.7701, -122.4101, True, test_user.id)
    r = await client.get("/api/v1/fountains/bbox", params={"min_lat": 37.0, "min_lng": -123.0, "max_lat": 38.0, "max_lng": -122.0})
    ids = {x["id"] for x in r.json()}
    assert str(visible.id) in ids and str(hidden.id) not in ids
    r2 = await client.get("/api/v1/fountains", params={"lat": 37.77, "lng": -122.41, "radius_m": 5000})
    ids2 = {x["id"] for x in r2.json()}
    assert str(hidden.id) not in ids2
    assert (await client.get(f"/api/v1/fountains/{hidden.id}")).status_code == 404


@pytest.mark.asyncio
async def test_hidden_does_not_block_add_and_cannot_be_rated(client, session, test_user):
    hidden = await _mk(session, 37.77, -122.41, True, test_user.id)
    # add at the same point succeeds (hidden row ignored by duplicate check)
    r = await client.post("/api/v1/fountains", json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True})
    assert r.status_code == 201
    # rating the hidden row 404s
    rr = await client.post(f"/api/v1/fountains/{hidden.id}/ratings", json={"ratings": [{"rating_type_id": 1, "stars": 5}]})
    assert rr.status_code == 404
```

```python
# backend/tests/test_add_fountain_conflict.py
import pytest

from app.geo import point_geography
from app.models import Fountain


@pytest.mark.asyncio
async def test_duplicate_add_returns_typed_conflict_with_fountain_id(client, session, test_user):
    existing = Fountain(location=point_geography(37.77, -122.41), is_working=True,
                        created_source="user", added_by_user_id=test_user.id)
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    r = await client.post("/api/v1/fountains", json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True})
    assert r.status_code == 409
    body = r.json()
    assert body["detail"] == "duplicate_fountain"
    assert body["fountain_id"] == str(existing.id)


def test_openapi_declares_typed_conflict_schema():
    from app.main import app

    schema = app.openapi()
    assert "DuplicateFountainConflict" in schema["components"]["schemas"]
    post = schema["paths"]["/api/v1/fountains"]["post"]
    ref = post["responses"]["409"]["content"]["application/json"]["schema"]["$ref"]
    assert ref == "#/components/schemas/DuplicateFountainConflict"
```

- [ ] **Step 3: Run — expect failure**

Run: `cd backend; python -m pytest tests/test_visibility_filter.py tests/test_add_fountain_conflict.py -v`
Expected: FAIL (hidden rows still returned; 409 body is `{"detail": "a fountain already exists..."}` without `fountain_id`; no schema component).

- [ ] **Step 4: Apply the filter + typed conflict**

In `backend/app/routers/fountains.py`:

1. Add imports: `from fastapi.responses import JSONResponse` and `from app.schemas import DuplicateFountainConflict` (extend the existing schemas import).
2. **nearby** (`nearby_fountains`): add `.where(Fountain.is_hidden.is_(False))` to the `select(...)` before `.where(func.ST_DWithin(...))`.
3. **bbox** (`fountains_in_bbox`): add `.where(Fountain.is_hidden.is_(False))` alongside the `ST_Intersects` filter.
4. **detail** (`fountain_detail`): change the query to `select(Fountain).where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))` so a hidden row 404s.
5. **add** (`add_fountain`): change the route decorator to declare the conflict response, the duplicate query to ignore hidden rows and return the id, and return a typed JSONResponse:

```python
@router.post(
    "/fountains",
    response_model=FountainDetail,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": DuplicateFountainConflict}},
)
async def add_fountain(...):
    ...
    conflict = (
        await session.execute(
            select(Fountain.id)
            .where(Fountain.is_hidden.is_(False))
            .where(func.ST_DWithin(Fountain.location, point, settings.duplicate_threshold_m))
            .limit(1)
        )
    ).scalar_one_or_none()
    if conflict is not None:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=DuplicateFountainConflict(fountain_id=conflict).model_dump(mode="json"),
        )
    ...
```

6. **rate** (`submit_ratings`): change the lookup to `select(Fountain).where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False)).with_for_update()` so rating a hidden fountain 404s.

- [ ] **Step 5: Run — expect pass + no regressions**

Run: `cd backend; python -m pytest tests/test_visibility_filter.py tests/test_add_fountain_conflict.py tests/test_fountains_query.py tests/test_fountains_add.py tests/test_ratings_api.py tests/test_fountains_detail.py -v`
Expected: PASS.

- [ ] **Step 6: Regenerate the API contract + verify frontend**

Run: `./run.ps1 generate` then `./run.ps1 check -ApiClient -Web -Mobile`
Expected: green (the new 409 schema is additive; no client breakage).

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/fountains.py backend/tests/test_visibility_filter.py backend/tests/test_add_fountain_conflict.py
git commit -m "feat(api): is_hidden visibility filter across reads + typed 409 duplicate conflict with fountain_id"
```

---

## Task 8: Merge service — movement policy, scope-limited removal, rollback

**Files:**
- Modify: `backend/app/imports/merge.py`
- Test: extend `backend/tests/test_osm_merge.py`

**Interfaces:** adds `rollback_run`; extends `_merge_one` with movement; adds `_mark_scope_removals`.

- [ ] **Step 1: Write the failing tests**

```python
# append to backend/tests/test_osm_merge.py
from app.imports.merge import rollback_run


@pytest.mark.asyncio
async def test_small_move_updates_unrated_osm_row(session):
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77000, -122.41000)], skipped=[], dry_run=False)
    await session.commit()
    # ~10 m move (well under osm_move_small_max_m=25) -> location updated
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77009, -122.41000)], skipped=[], dry_run=False)
    await session.commit()
    lat = (await session.execute(select(func.ST_Y(func.cast(Fountain.location, __import__("geoalchemy2").Geometry()))))).scalar_one()
    assert round(lat, 5) == 37.77009


@pytest.mark.asyncio
async def test_large_move_is_review_flagged_not_moved(session):
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    before = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.78, -122.41)], skipped=[], dry_run=False)  # ~1.1 km
    await session.commit()
    assert s.review_flagged_count == 1
    after = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    assert after == before  # not moved


@pytest.mark.asyncio
async def test_rated_osm_row_is_never_auto_moved(session, test_user):
    from app.models import Rating
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77000, -122.41000)], skipped=[], dry_run=False)
    await session.commit()
    f = (await session.execute(select(Fountain))).scalar_one()
    session.add(Rating(fountain_id=f.id, user_id=test_user.id, rating_type_id=1, stars=5))
    f.rating_count = 1
    await session.commit()
    before = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77009, -122.41000)], skipped=[], dry_run=False)
    await session.commit()
    after = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    assert after == before  # rated row: no auto-move even for a small move


@pytest.mark.asyncio
async def test_scope_limited_removal_does_not_touch_other_scope(session):
    scope_a = RunScope("osm", "test:a", "b1", "A", "test:a", None)
    scope_b = RunScope("osm", "test:b", "b1", "B", "test:b", None)
    await merge_candidates(session, scope=scope_a, candidates=[_cand("osm:node:1", 10.0, 10.0)], skipped=[], dry_run=False)
    await merge_candidates(session, scope=scope_b, candidates=[_cand("osm:node:2", 20.0, 20.0)], skipped=[], dry_run=False)
    await session.commit()
    # Refresh scope A with node:1 absent -> node:1 removed, node:2 (scope B) untouched.
    await merge_candidates(session, scope=scope_a, candidates=[], skipped=[], dry_run=False)
    await session.commit()
    p1 = (await session.execute(select(FountainProvenance).where(FountainProvenance.source_external_id == "osm:node:1"))).scalar_one()
    p2 = (await session.execute(select(FountainProvenance).where(FountainProvenance.source_external_id == "osm:node:2"))).scalar_one()
    assert p1.removed_at is not None
    assert p2.removed_at is None  # other scope NOT touched


@pytest.mark.asyncio
async def test_dry_run_mutates_no_production_tables(session):
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=True)
    await session.commit()
    assert s.dry_run is True and s.inserted_count == 1  # would-insert reported
    assert (await session.execute(select(func.count()).select_from(Fountain))).scalar_one() == 0
    assert (await session.execute(select(func.count()).select_from(FountainProvenance))).scalar_one() == 0
    # candidate rows ARE written for audit
    from app.models import OsmImportCandidate
    assert (await session.execute(select(func.count()).select_from(OsmImportCandidate))).scalar_one() == 1


@pytest.mark.asyncio
async def test_rollback_run_hides_inserts_and_keeps_user_rows(session, test_user):
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    n = await rollback_run(session, s.run_id)
    await session.commit()
    assert n >= 1
    f = (await session.execute(select(Fountain))).scalar_one()
    assert f.is_hidden is True  # inserted row hidden, not deleted


@pytest.mark.asyncio
async def test_dry_run_records_matched_fountain_id(session, test_user):
    # A dry-run over an existing fountain must record WHICH fountain matched.
    from app.models import OsmImportCandidate
    uf = Fountain(location=point_geography(37.77, -122.41), is_working=True,
                  created_source="user", added_by_user_id=test_user.id)
    session.add(uf)
    await session.commit()
    await session.refresh(uf)
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:5", 37.77, -122.41)], skipped=[], dry_run=True)
    await session.commit()
    cand = (await session.execute(select(OsmImportCandidate).where(OsmImportCandidate.source_external_id == "osm:node:5"))).scalar_one()
    assert cand.action == "match_provenance" and cand.matched_fountain_id == uf.id
    # ...and dry-run wrote no provenance row.
    assert (await session.execute(select(func.count()).select_from(FountainProvenance))).scalar_one() == 0


@pytest.mark.asyncio
async def test_rollback_detaches_provenance_from_user_fountain(session, test_user):
    uf = Fountain(location=point_geography(37.77, -122.41), is_working=True,
                  created_source="user", added_by_user_id=test_user.id)
    session.add(uf)
    await session.commit()
    await session.refresh(uf)
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:7", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    await rollback_run(session, s.run_id)
    await session.commit()
    # provenance detached; the user fountain row is intact (not hidden, owner unchanged).
    assert (await session.execute(select(func.count()).select_from(FountainProvenance))).scalar_one() == 0
    f = (await session.execute(select(Fountain).where(Fountain.id == uf.id))).scalar_one()
    assert f.is_hidden is False and f.created_source == "user" and f.added_by_user_id == test_user.id


@pytest.mark.asyncio
async def test_rollback_preserves_ratings_on_imported_row(session, test_user):
    from app.models import Rating
    s = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False)
    await session.commit()
    f = (await session.execute(select(Fountain))).scalar_one()
    session.add(Rating(fountain_id=f.id, user_id=test_user.id, rating_type_id=1, stars=5))
    f.rating_count = 1
    await session.commit()
    await rollback_run(session, s.run_id)
    await session.commit()
    # Row hidden but the rating is preserved (never deleted).
    f2 = (await session.execute(select(Fountain).where(Fountain.id == f.id))).scalar_one()
    assert f2.is_hidden is True
    assert (await session.execute(select(func.count()).select_from(Rating))).scalar_one() == 1


@pytest.mark.asyncio
async def test_rollback_restores_moved_location_and_mark_removed(session):
    # run1 inserts at A; run2 small-moves to B; rollback run2 restores A.
    await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77000, -122.41000)], skipped=[], dry_run=False)
    await session.commit()
    a = (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one()
    s2 = await merge_candidates(session, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77009, -122.41000)], skipped=[], dry_run=False)
    await session.commit()
    await rollback_run(session, s2.run_id)
    await session.commit()
    assert (await session.execute(select(func.ST_AsText(Fountain.location)))).scalar_one() == a
    # run3 (empty, same scope) marks removed; rollback restores removed_at=None.
    s3 = await merge_candidates(session, scope=SCOPE, candidates=[], skipped=[], dry_run=False)
    await session.commit()
    p = (await session.execute(select(FountainProvenance))).scalar_one()
    assert p.removed_at is not None
    await rollback_run(session, s3.run_id)
    await session.commit()
    p2 = (await session.execute(select(FountainProvenance))).scalar_one()
    assert p2.removed_at is None
```

- [ ] **Step 2: Run — expect failure**

Run: `cd backend; python -m pytest tests/test_osm_merge.py -v`
Expected: the new tests FAIL (movement/removal/rollback not implemented).

- [ ] **Step 3: Implement movement in `_merge_one`'s provenance-id branch**

Replace the provenance-id `if prov is not None:` block's post-lock body so that, after `_refresh_provenance`, it evaluates movement against the locked fountain:

```python
    if prov is not None:
        summary.matched_existing_count += 1
        if dry_run:
            return "update", prov.fountain_id
        fountain = (await session.execute(
            select(Fountain).where(Fountain.id == prov.fountain_id).with_for_update()
        )).scalar_one()
        changed, prior = _refresh_provenance(prov, cand, run, now, scope)
        if changed:
            session.add(FountainImportEvent(
                run_id=run.id, fountain_id=prov.fountain_id, provenance_id=prov.id,
                operation="provenance_update", prior_values=prior,
            ))
        moved = await _maybe_move(session, fountain, cand, run, settings, summary)
        if changed or moved:
            summary.updated_count += 1
        return "update", prov.fountain_id
```

Add the movement helper:

```python
async def _maybe_move(session, fountain, cand, run, settings, summary) -> bool:
    # The fountain row is already locked FOR UPDATE by the caller. Compute distance and the
    # prior location via the column (by id) — robust vs. using a loaded WKBElement literal.
    point = point_geography(cand.latitude, cand.longitude)
    dist = (await session.execute(
        select(func.ST_Distance(Fountain.location, point)).where(Fountain.id == fountain.id)
    )).scalar_one()
    if dist is None or dist == 0:
        return False
    # Never auto-move user-created or rated rows; flag large moves for review.
    if fountain.created_source != "osm" or fountain.rating_count > 0:
        if dist >= settings.osm_move_review_min_m:
            summary.review_flagged_count += 1
        return False
    if dist <= settings.osm_move_small_max_m:
        prior = (await session.execute(
            select(func.ST_AsText(Fountain.location)).where(Fountain.id == fountain.id)
        )).scalar_one()
        fountain.location = point
        session.add(FountainImportEvent(
            run_id=run.id, fountain_id=fountain.id, provenance_id=None,
            operation="update_location", prior_values={"location_wkt": prior},
        ))
        return True
    if dist >= settings.osm_move_review_min_m:
        summary.review_flagged_count += 1
    return False
```

- [ ] **Step 4: Implement scope-limited removal**

Add a removal pass invoked before the run-summary finalization in `merge_candidates` (only when `not dry_run`):

```python
    if not dry_run:
        await _mark_scope_removals(session, run=run, scope=scope, seen_ext_ids={c.source_external_id for c in candidates}, now=now, summary=summary)
```

```python
async def _mark_scope_removals(session, *, run, scope, seen_ext_ids, now, summary) -> None:
    stmt = select(FountainProvenance).where(
        FountainProvenance.source_system == scope.source_system,
        FountainProvenance.scope_id == scope.scope_id,
        FountainProvenance.removed_at.is_(None),
    )
    if seen_ext_ids:
        stmt = stmt.where(FountainProvenance.source_external_id.not_in(seen_ext_ids))
    rows = (await session.execute(stmt)).scalars().all()
    for prov in rows:
        # Scope-bounds guard: if the run declares bounds, only remove provenance whose
        # fountain falls within them (a sub-region refresh can't remove what it didn't cover).
        if scope.scope_bounds_wkt is not None:
            inside = (await session.execute(
                select(func.ST_Covers(
                    func.ST_GeogFromText(scope.scope_bounds_wkt),
                    select(Fountain.location).where(Fountain.id == prov.fountain_id).scalar_subquery(),
                ))
            )).scalar_one()
            if not inside:
                continue
        prov.removed_at = now
        prov.last_import_run_id = run.id
        summary.removed_count += 1
        session.add(FountainImportEvent(
            run_id=run.id, fountain_id=prov.fountain_id, provenance_id=prov.id,
            operation="mark_removed", prior_values={"removed_at": None},
        ))
```

- [ ] **Step 5: Implement `rollback_run`**

```python
async def rollback_run(session: AsyncSession, run_id: uuid.UUID) -> int:
    # Serialize against concurrent user adds/imports via the shared advisory lock, and
    # SELECT ... FOR UPDATE each affected row before inspecting/mutating it so rollback
    # never races a rating recompute or a movement. Never deletes user rows or ratings.
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    events = (await session.execute(
        select(FountainImportEvent).where(FountainImportEvent.run_id == run_id)
        .order_by(FountainImportEvent.created_at.desc())  # reverse order
    )).scalars().all()
    affected = 0
    for ev in events:
        if ev.operation == "insert" and ev.fountain_id is not None:
            f = (await session.execute(
                select(Fountain).where(Fountain.id == ev.fountain_id).with_for_update()
            )).scalar_one_or_none()
            if f is not None:
                f.is_hidden = True  # hide, never delete — preserves any user ratings; audit-safe
                affected += 1
        elif ev.operation == "update_location" and ev.prior_values and ev.fountain_id is not None:
            f = (await session.execute(
                select(Fountain).where(Fountain.id == ev.fountain_id).with_for_update()
            )).scalar_one_or_none()
            if f is not None:
                f.location = func.ST_GeogFromText(ev.prior_values["location_wkt"])
                affected += 1
        elif ev.operation == "provenance_attach" and ev.provenance_id is not None:
            prov = (await session.execute(
                select(FountainProvenance).where(FountainProvenance.id == ev.provenance_id).with_for_update()
            )).scalar_one_or_none()
            if prov is not None:
                await session.delete(prov)  # detach OSM provenance; the user fountain row is untouched
                affected += 1
        elif ev.operation == "provenance_update" and ev.provenance_id is not None and ev.prior_values:
            prov = (await session.execute(
                select(FountainProvenance).where(FountainProvenance.id == ev.provenance_id).with_for_update()
            )).scalar_one_or_none()
            if prov is not None:
                prov.source_tags = ev.prior_values.get("source_tags")
                prov.confidence = ev.prior_values.get("confidence")
                rv = ev.prior_values.get("removed_at")
                prov.removed_at = datetime.fromisoformat(rv) if rv else None
                prov.scope_id = ev.prior_values.get("scope_id")
                prov.source_dataset = ev.prior_values.get("source_dataset")
                affected += 1
        elif ev.operation == "mark_removed" and ev.provenance_id is not None:
            prov = (await session.execute(
                select(FountainProvenance).where(FountainProvenance.id == ev.provenance_id).with_for_update()
            )).scalar_one_or_none()
            if prov is not None:
                prov.removed_at = None
                affected += 1
    await session.flush()
    log.info("osm_import_run_rolled_back", extra={"run_id": str(run_id), "affected": affected})
    return affected
```

- [ ] **Step 6: Run — expect pass**

Run: `cd backend; python -m pytest tests/test_osm_merge.py -v`
Expected: all merge tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/imports/merge.py backend/tests/test_osm_merge.py
git commit -m "feat(imports): movement thresholds, scope-limited removal, and run rollback in OSM merge"
```

---

## Task 9: Concurrency test + importer CLI

**Files:**
- Create: `backend/app/imports/cli.py`
- Test: extend `backend/tests/test_osm_merge.py` (concurrency), create `backend/tests/test_osm_cli.py`

- [ ] **Step 1: Write the concurrent import-vs-add test**

```python
# append to backend/tests/test_osm_merge.py
import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.locks import ADD_FOUNTAIN_LOCK_KEY


async def _advisory_lock_waiters(maker, key: int) -> int:
    # Count sessions BLOCKED (ungranted) on our advisory lock. A single bigint key splits
    # into classid (high 32 bits) / objid (low 32 bits) with objsubid=1 in pg_locks
    # (objsubid=2 would be the two-int form — filter it out to avoid collisions).
    async with maker() as s:
        return (await s.execute(
            text(
                "SELECT count(*) FROM pg_locks WHERE locktype='advisory' "
                "AND classid=:c AND objid=:o AND objsubid=1 AND NOT granted"
            ),
            {"c": (key >> 32) & 0xFFFFFFFF, "o": key & 0xFFFFFFFF},
        )).scalar_one()


@pytest.mark.asyncio
async def test_real_add_endpoint_and_import_serialize_via_advisory_lock(client, engine, test_user):
    # Drive the ACTUAL POST /api/v1/fountains concurrently with merge_candidates at the
    # SAME point. A gate transaction holds the shared advisory lock so BOTH operations are
    # forced to queue behind it (deterministic overlap at the check-then-write point). When
    # released they run serialized -> exactly ONE fountain, and the loser reconciles
    # (the add gets 409, or the import attaches provenance to the user row).
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def do_import():
        async with maker() as s:
            await merge_candidates(
                s, scope=SCOPE, candidates=[_cand("osm:node:1", 37.77, -122.41)], skipped=[], dry_run=False
            )
            await s.commit()

    add_result: dict[str, int] = {}

    async def do_add():
        r = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 37.77, "longitude": -122.41}, "is_working": True},
        )
        add_result["status"] = r.status_code

    async with maker() as gate:
        await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
        t_import = asyncio.create_task(do_import())
        t_add = asyncio.create_task(do_add())
        # Deterministic overlap: wait until BOTH workers are observably blocked on the lock
        # in pg_locks (poll, not a fixed sleep), then release the gate.
        for _ in range(200):
            if await _advisory_lock_waiters(maker, ADD_FOUNTAIN_LOCK_KEY) >= 2:
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("both workers did not block on the advisory lock in time")
        await gate.commit()  # release -> serialized execution
    await asyncio.gather(t_import, t_add)

    async with maker() as s:
        count = (await s.execute(select(func.count()).select_from(Fountain))).scalar_one()
        prov = (await s.execute(select(func.count()).select_from(FountainProvenance))).scalar_one()
    assert count == 1  # serialized: exactly one fountain, no near-duplicate
    # Whichever committed first, the other reconciled.
    assert add_result["status"] in (201, 409)
    assert add_result["status"] == 409 or prov == 1
```

> The advisory-lock gate is the database-side blocking point that forces overlap; the `pg_locks` poll makes the overlap deterministic (no fixed-sleep guess). The invariant (`count == 1`) holds for either commit order — never weaken it.

- [ ] **Step 2: Write the CLI test**

```python
# backend/tests/test_osm_cli.py
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.imports.cli import RunScope, run_import
from app.models import Fountain

FIX = Path(__file__).parent / "fixtures"
SCOPE = RunScope("osm", "test:sf", "b1", "SF test", "test:sf", None)


@pytest.mark.asyncio
async def test_cli_dry_run_then_apply(session):
    # The CLI opens its OWN session via app.db.get_sessionmaker() and commits; the test's
    # `session` fixture (separate connection, same DB on 5436) reads the committed result.
    path = str(FIX / "osm_basic.geojson")
    dry = await run_import(path, scope=SCOPE, dry_run=True)
    assert dry.dry_run is True and dry.inserted_count == 2
    assert (await session.execute(select(func.count()).select_from(Fountain))).scalar_one() == 0
    applied = await run_import(path, scope=SCOPE, dry_run=False)
    assert applied.inserted_count == 2
    assert (await session.execute(select(func.count()).select_from(Fountain))).scalar_one() == 2
```

- [ ] **Step 3: Run — expect failure**

Run: `cd backend; python -m pytest tests/test_osm_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.imports.cli'`.

- [ ] **Step 4: Implement the CLI**

```python
# backend/app/imports/cli.py
"""OSM fountain importer CLI.

Usage:
  python -m app.imports.cli --path extract.geojson --scope-id us/ca --dataset geofabrik:us/california \
      --build-id 2026-06-21 --label "California" [--dry-run]

Parses a GeoJSON extract, merges candidates (apply or dry-run), prints a JSON run
summary. Never logs secrets or raw source URLs (spec §10).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

from app.config import get_settings
from app.db import get_sessionmaker
from app.imports.merge import RunScope, RunSummary, merge_candidates
from app.imports.osm import parse_osm_geojson
from app.logging_config import configure_logging

log = logging.getLogger(__name__)


async def run_import(path: str, *, scope: RunScope, dry_run: bool) -> RunSummary:
    s = get_settings()
    with open(path, encoding="utf-8") as fh:
        geojson = json.load(fh)
    parsed = parse_osm_geojson(
        geojson,
        max_key_len=s.osm_tag_max_key_len,
        max_value_len=s.osm_tag_max_value_len,
        max_tags_bytes=s.osm_tags_max_bytes,
    )
    maker = get_sessionmaker()
    async with maker() as session:
        summary = await merge_candidates(
            session, scope=scope, candidates=parsed.candidates, skipped=parsed.skipped, dry_run=dry_run
        )
        await session.commit()
    return summary


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    p = argparse.ArgumentParser(prog="app.imports.cli")
    p.add_argument("--path", required=True)
    p.add_argument("--scope-id", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--build-id", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--system", default="osm")
    p.add_argument("--scope-bounds-wkt", default=None)
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    scope = RunScope(
        source_system=a.system, source_dataset=a.dataset, source_build_id=a.build_id,
        source_label=a.label, scope_id=a.scope_id, scope_bounds_wkt=a.scope_bounds_wkt,
    )
    summary = asyncio.run(run_import(a.path, scope=scope, dry_run=a.dry_run))
    # Diagnostics already went through structured logging (merge_candidates emits the run
    # summary). This ONE stdout line is the CLI's machine-readable RESULT contract for
    # operators/CI — intentionally not a diagnostic print (see Global Constraints carve-out).
    log.info("osm_import_cli_done", extra={"run_id": str(summary.run_id), "dry_run": summary.dry_run})
    print(json.dumps(summary.__dict__, default=str))  # documented CLI result contract (Global Constraints)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

> **Confirmed accessors (no new code needed):** `app.db.get_sessionmaker() -> async_sessionmaker` and `app.logging_config.configure_logging(level="INFO", fmt="json")` both already exist with these signatures. The CLI uses them directly.

- [ ] **Step 5: Run — expect pass**

Run: `cd backend; python -m pytest tests/test_osm_cli.py tests/test_osm_merge.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/imports/cli.py backend/tests/test_osm_cli.py backend/tests/test_osm_merge.py
git commit -m "feat(imports): importer CLI (parse -> merge, dry-run/apply) + concurrent import-vs-add test"
```

---

## Task 10: Operational runbook + backend README

**Files:**
- Create: `docs/runbooks/osm-fountain-import.md`
- Modify: `backend/README.md` (add an "OSM import" subsection + the new settings)

- [ ] **Step 1: Write the runbook**

Document, with copy-paste commands and NO secrets: prerequisites (a GeoJSON extract with stable OSM IDs); dry-run (`python -m app.imports.cli --path … --dry-run`) and how to read the JSON summary + inspect `osm_fountain_import_candidates`; staging/dev apply and how to verify bbox/nearby/detail/add-conflict; production apply via operator/CI (never a public endpoint); refresh (idempotent re-run); audit (query `osm_fountain_import_runs` / `fountain_import_events`); rollback (`rollback_run` by run id) and its guarantees (hides inserts, restores moves, detaches provenance from user rows, never deletes user rows/ratings). State that `source_tags` is internal/admin-only until a display surface filters it (spec §4.3), and that tag→attribute mapping is a deferred follow-up.

- [ ] **Step 2: Update `backend/README.md`**

Add an "OSM import" subsection pointing at the runbook and the spec, and document the new settings by **name only** (`OSM_MOVE_SMALL_MAX_M`, `OSM_MOVE_REVIEW_MIN_M`, `OSM_TAG_MAX_KEY_LEN`, `OSM_TAG_MAX_VALUE_LEN`, `OSM_TAGS_MAX_BYTES`) with their safe defaults.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/osm-fountain-import.md backend/README.md
git commit -m "docs: OSM fountain import runbook + backend settings documentation"
```

---

## Task 11: Final full CI mirror + PR

- [ ] **Step 1: Run the FULL local mirror**

Run: `./run.ps1 check`
Expected: backend (ruff + format + `alembic upgrade head` + `alembic check` no drift + pytest), workspace-js (lint/typecheck/test incl. mobile), web build, mobile-doctor — all green. Fix anything red before proceeding.

- [ ] **Step 2: Commit the approved spec + plan (docs) if not already on the branch**

```bash
git add docs/specs/2026-06-21-osm-fountain-ingestion-design.md docs/plans/2026-06-21-osm-fountain-ingestion.md
git commit -m "docs: OSM ingestion design spec (Codex Loop A approved) + implementation plan"
```

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/osm-fountain-ingestion
gh pr create --title "feat: OSM/Protomaps fountain ingestion" --body "<summary; closes #34; references #38–#43 for the deferred tag→attribute mapping>"
```

- [ ] **Step 4: CI green, then Codex Loop B**

Watch CI to green (`gh run watch`), then run the Codex PR review loop (`claude_help/codex-review-process.md`) until `VERDICT: APPROVED`, address every PR comment, then squash-merge.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §4 origin/provenance → Tasks 2/4; §4.3 structured-data boundary → enforced by "OSM never writes ratings/verifications/notes" in Task 6 + runbook Task 10; §5 architecture/staging/dry-run/events → Tasks 4/6/9; §5.4 scope → Tasks 2/4/8; §6 merge/locking/movement/validation/tags → Tasks 5/6/8; §7 visibility + typed 409 → Task 7; §8 gamification (zero credit, origin-keyed) → guaranteed structurally by `created_source`/null owner in Tasks 2/6; §9 licensing separability → provenance table (Task 2) + runbook (Task 10); §10 ops/rollback → Tasks 8/10; §13 DoD → Task 11.
- **Deferred (not this slice):** tag→attribute mapping (#38/#40/#42), web add→verify UX (#39 client), public provenance UI — all explicitly out of scope per spec §4.3/§12.
- **Type consistency:** `RunScope`/`RunSummary`/`OsmCandidate`/`merge_candidates`/`rollback_run` names match across Tasks 5/6/8/9 and the Interface Reference; constraint/index names match between Task 2 (ORM) and Task 4 (migration).
- **Accessors confirmed:** `app.db.get_sessionmaker()` and `app.logging_config.configure_logging()` both exist with the signatures the CLI uses — no new plumbing required.
