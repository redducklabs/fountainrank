# SEO coverage report + per-scope readiness gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 1e of #127 — a read-only per-scope SEO coverage report and a per-scope
`city_routes_ready` gate that controls whether a scope's *city* routes are indexed/sitemapped.

**Architecture:** One new boolean column on `place_scope_config` (seeded `true` for the already-live
`us`/`lu`); a two-point backend gate (`list_places` cities branch + `city_fountains.indexable`) that
the web + sitemap inherit unchanged; a new `app/seo_coverage.py` read module + `app/imports/seo_coverage_cli.py` (run under a session advisory lock in a `READ ONLY REPEATABLE READ` transaction); and a manual-dispatch `seo-coverage-report.yml` workflow that `kubectl exec`s the report against prod.

**Tech Stack:** FastAPI, SQLAlchemy 2.0.51 async, asyncpg, PostGIS, Alembic, pytest (local PostGIS
container mirror), GitHub Actions (`kubectl`/`doctl`).

**Design spec:** `docs/specs/2026-07-04-seo-coverage-gate-design.md` (Codex-approved, spec-review round 3). **Parent spec:** `docs/specs/2026-07-02-crawlable-seo-pages-design.md` §4.2/§7/§11.5. **Runbook:** `docs/runbooks/seo.md`.

## Global Constraints

- **Branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → squash-merge.** One task at a time, TDD, frequent Conventional Commits. **No AI attribution. No time estimates.**
- **Backend local checks on Windows** use an isolated `UV_PROJECT_ENVIRONMENT` (a path OUTSIDE the repo — the repo `.venv` is Codex's WSL env and breaks `uv run` on Windows). After `uv sync` once, from `backend/`: `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`. `run.ps1` uses the default `.venv`, so it fails here.
- **JS/web checks are CI-gated, not locally runnable on this host.** The `web/` (and `mobile/`) `node_modules` are Codex's WSL install (eslint EACCES, vitest missing win32 binding), so the `workspace-js` job (lint + vitest + `next build`) is the **gating web verification** — the PR is not mergeable until it is green. This is a documented host limitation, not a skipped check; every web change in this plan (Task 6) is verified there.
- **Local PostGIS**: `./run.ps1 up` → `postgis/postgis:17-3.5` on `:5436`. The test DB is migrated to head, so `place_scope_config` already has the seeded `us`/`lu` rows.
- **`boundary` is `Geography(MULTIPOLYGON,4326)`** — any geometry predicate needs `::geometry` (`ST_IsValid(boundary::geometry)`, `ST_SnapToGrid(location::geometry, …)`).
- **lon/lat ordering stays centralized in `app/geo.py`** (`latitude_of`/`longitude_of`, which cast to `Geometry`). PostGIS takes `(lon, lat)`.
- **Production reads go through the CI-only path** (`kubectl exec` the deployed backend pod). No local prod DB access. IaC read-only locally.
- **Structured logging**, no bare `print()` for diagnostics (the ONE `print()` in a CLI is its documented machine-readable result contract, mirroring `membership_cli.py`). No secrets/PII/full DB URLs in logs.
- **Readiness default = not ready:** a country with no `place_scope_config` row (or `city_routes_ready=false`) is NOT ready. `us`/`lu` are seeded `true`.
- **`ADD_FOUNTAIN_LOCK_KEY`** = `app.locks.ADD_FOUNTAIN_LOCK_KEY` (`0x464E5452`). The same key that `refresh_all_memberships`, POST /fountains, admin patch/delete, and the OSM import take as a transaction-scoped lock.

---

### Task 1: Migration 0017 + model — `place_scope_config.city_routes_ready`

**Files:**
- Create: `backend/migrations/versions/0017_place_scope_config_ready.py`
- Modify: `backend/app/models.py` (the `PlaceScopeConfig` class, ~line 717-733)
- Create: `backend/tests/test_place_scope_ready_migration.py`

**Interfaces:**
- Produces: `PlaceScopeConfig.city_routes_ready: Mapped[bool]` (non-null, server default `false`); DB column `place_scope_config.city_routes_ready`; `us` + `lu` rows seeded `true`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_place_scope_ready_migration.py`:

```python
"""Slice 1e — place_scope_config.city_routes_ready column + seed (migration 0017)."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.models import PlaceScopeConfig


@pytest.mark.asyncio
async def test_us_and_lu_seeded_city_routes_ready(session):
    """Migration 0017 adds the column and marks the already-live scopes ready."""
    rows = (
        await session.execute(
            text(
                "SELECT country_code, city_routes_ready FROM place_scope_config "
                "WHERE country_code IN ('us', 'lu') ORDER BY country_code"
            )
        )
    ).all()
    assert {(r.country_code, r.city_routes_ready) for r in rows} == {("lu", True), ("us", True)}


@pytest.mark.asyncio
async def test_model_roundtrip_defaults_false(session):
    """A new row with no explicit flag defaults to NOT ready (server_default false)."""
    session.add(PlaceScopeConfig(country_code="zz", eligible_city_subtypes=["locality"]))
    await session.commit()
    row = await session.get(PlaceScopeConfig, "zz")
    assert row is not None
    assert row.city_routes_ready is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_place_scope_ready_migration.py -v`
Expected: FAIL — `column place_scope_config.city_routes_ready does not exist` / `AttributeError: city_routes_ready`.

- [ ] **Step 3: Add the model column**

In `backend/app/models.py`, in `class PlaceScopeConfig`, after the `eligible_city_subtypes` mapped column, add (confirm `text` is already imported in `models.py` — it is, used by the partial index):

```python
    # Slice 1e per-scope readiness gate (spec docs/specs/2026-07-04-seo-coverage-gate-design.md):
    # a scope's CITY routes (cities sitemap chunk + each city page's indexability) are live only when
    # this is true. Owner signoff after reading the coverage report; set via a reviewed migration.
    # A country with no row here is NOT ready. Seeded true for us/lu in migration 0017.
    city_routes_ready: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
```

- [ ] **Step 4: Write the migration**

Create `backend/migrations/versions/0017_place_scope_config_ready.py`:

```python
"""place_scope_config.city_routes_ready: per-scope city-routes readiness gate (#127 Slice 1e).

Adds the boolean owner-signoff flag that gates a scope's CITY routes (cities sitemap + city page
indexability). Seeds it true for the already-live scopes (us, lu) so nothing regresses; every other
(current or future) scope defaults to NOT ready until an owner signs off in a reviewed migration.
Spec: docs/specs/2026-07-04-seo-coverage-gate-design.md.
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_place_scope_config_ready"
down_revision = "0016_place_boundary_cells"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "place_scope_config",
        sa.Column(
            "city_routes_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # The scopes already serving live city routes are signed off as ready.
    op.execute(
        "UPDATE place_scope_config SET city_routes_ready = true "
        "WHERE country_code IN ('us', 'lu')"
    )


def downgrade() -> None:
    op.drop_column("place_scope_config", "city_routes_ready")
```

- [ ] **Step 5: Apply the migration and run the tests**

Run: `uv run alembic upgrade head && uv run pytest tests/test_place_scope_ready_migration.py -v`
Expected: migration applies; both tests PASS.

- [ ] **Step 6: Verify reversibility + no drift**

Run: `uv run alembic downgrade -1 && uv run alembic upgrade head && uv run alembic check`
Expected: down then up both succeed; `alembic check` reports no new operations (no model drift).

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/versions/0017_place_scope_config_ready.py backend/app/models.py backend/tests/test_place_scope_ready_migration.py
git commit -m "feat(backend): add place_scope_config.city_routes_ready gate column (#127 Slice 1e)"
```

---

### Task 2: Gate the two read paths on scope readiness

**Files:**
- Modify: `backend/app/routers/places.py` (add a readiness helper; gate `list_places` cities branch and `city_fountains.indexable`)
- Modify: `backend/tests/test_places_api.py` (add not-ready tests + a small seed helper)

**Interfaces:**
- Consumes: `PlaceScopeConfig.city_routes_ready` (Task 1).
- Produces: `async def _scope_city_routes_ready(session, country_code: str) -> bool` in `places.py` (module-private; `False` when no row). `list_places(country=cc)` returns `[]` for a not-ready scope; `CityFountainsOut.indexable` ANDs in readiness.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_places_api.py`, add a seed helper near the other helpers (after `_sq`):

```python
async def _set_scope_ready(session, country_code: str, ready: bool, *, subtypes=("locality", "localadmin")):
    """Insert/patch a place_scope_config row so a test scope is (not) city-routes-ready. us/lu are
    seeded ready=true by migration 0017; use this for other test country codes."""
    await session.execute(
        text(
            """
            INSERT INTO place_scope_config (country_code, eligible_city_subtypes, city_routes_ready)
            VALUES (:cc, :subs, :ready)
            ON CONFLICT (country_code)
            DO UPDATE SET eligible_city_subtypes = EXCLUDED.eligible_city_subtypes,
                          city_routes_ready = EXCLUDED.city_routes_ready
            """
        ),
        {"cc": country_code, "subs": list(subtypes), "ready": ready},
    )
```

Then add these tests at the end of the file:

```python
@pytest.mark.asyncio
async def test_cities_hidden_for_not_ready_scope(session, api):
    """A scope with city_routes_ready=false returns NO cities from /places?country=cc even when a
    city clears K — the per-scope gate (spec §4.2/§7)."""
    zy = await _add_place(
        session, overture_id="zy", subtype="country", country_code="zy",
        name="Zedland", slug="zedland", fountain_count=50, is_canonical=False,
    )
    await _add_place(
        session, overture_id="zy-town", subtype="locality", country_code="zy",
        name="Zed Town", slug="zed-town", fountain_count=9, is_canonical=True, parent_id=zy,
    )
    await _set_scope_ready(session, "zy", ready=False)
    await session.commit()

    body = (await api.get("/api/v1/places", params={"country": "zy"})).json()
    assert body == []


@pytest.mark.asyncio
async def test_cities_shown_for_ready_scope(session, api):
    """Flipping the same scope to ready surfaces its canonical cities >= K."""
    zy = await _add_place(
        session, overture_id="zy", subtype="country", country_code="zy",
        name="Zedland", slug="zedland", fountain_count=50, is_canonical=False,
    )
    await _add_place(
        session, overture_id="zy-town", subtype="locality", country_code="zy",
        name="Zed Town", slug="zed-town", fountain_count=9, is_canonical=True, parent_id=zy,
    )
    await _set_scope_ready(session, "zy", ready=True)
    await session.commit()

    body = (await api.get("/api/v1/places", params={"country": "zy"})).json()
    assert [c["slug"] for c in body] == ["zed-town"]


@pytest.mark.asyncio
async def test_city_fountains_not_indexable_for_not_ready_scope(session, api):
    """city_fountains still SERVES its fountains (reachable), but indexable=false when the scope
    isn't ready, even though fountain_count (9) >= K (3)."""
    zy = await _add_place(
        session, overture_id="zy", subtype="country", country_code="zy",
        name="Zedland", slug="zedland", fountain_count=50, is_canonical=False,
    )
    city = await _add_place(
        session, overture_id="zy-town", subtype="locality", country_code="zy",
        name="Zed Town", slug="zed-town", fountain_count=9, is_canonical=True, parent_id=zy,
    )
    await _set_scope_ready(session, "zy", ready=False)
    # One visible fountain assigned to the city so the row is genuinely reachable. clean_db truncates
    # fountains between tests, so this UPDATE targets exactly the one row just inserted.
    await _add_fountain(session, 0.5, 0.5)
    await session.execute(text("UPDATE fountains SET city_place_id = :cid"), {"cid": city})
    await session.commit()

    resp = await api.get("/api/v1/places/zy/zed-town/fountains")
    assert resp.status_code == 200
    body = resp.json()
    assert body["indexable"] is False
    assert len(body["fountains"]) == 1  # reachable with its assigned fountain
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `uv run pytest tests/test_places_api.py -k "not_ready or ready_scope" -v`
Expected: FAIL — the gate doesn't exist yet, so cities are returned and `indexable` is `true`.

- [ ] **Step 3: Add the readiness helper**

In `backend/app/routers/places.py`, add `PlaceScopeConfig` to the models import and add the helper (near `_set_cache`):

```python
from app.models import Fountain, PlaceBoundary, PlaceScopeConfig  # add PlaceScopeConfig


async def _scope_city_routes_ready(session: AsyncSession, country_code: str) -> bool:
    """Whether this scope's CITY routes are signed off as ready (spec §4.2/§7). A missing
    place_scope_config row (or city_routes_ready=false) means NOT ready — the safe default that keeps
    a new scope's city routes out of the index/sitemap until an owner signs off in a migration."""
    return bool(
        await session.scalar(
            select(PlaceScopeConfig.city_routes_ready).where(
                PlaceScopeConfig.country_code == country_code
            )
        )
    )
```

- [ ] **Step 4: Gate the `list_places` cities branch**

In `list_places`, inside the `else:` (country given) branch, AFTER the `parent_id is None` short-circuit and BEFORE building the cities `stmt`, add:

```python
        if not await _scope_city_routes_ready(session, country_code):
            _set_cache(response, settings)
            logger.info(
                "places served",
                extra={"scope": "cities", "country": country_code, "rows": 0, "scope_ready": False},
            )
            return []
```

- [ ] **Step 5: Gate `city_fountains.indexable`**

In `city_fountains`, change the `indexable` computation:

```python
    indexable = place.fountain_count >= settings.seo_place_min_fountains and await _scope_city_routes_ready(
        session, cc
    )
```

- [ ] **Step 6: Run the full places suite**

Run: `uv run pytest tests/test_places_api.py tests/test_fountain_place_api.py -v`
Expected: the new not-ready/ready tests PASS; all existing tests still PASS (they use `us`/`lu`, seeded ready).

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/places.py backend/tests/test_places_api.py
git commit -m "feat(backend): gate city routes on place_scope_config.city_routes_ready (#127 Slice 1e)"
```

---

### Task 3: Coverage report core — `app/seo_coverage.py`

**Files:**
- Create: `backend/app/seo_coverage.py`
- Modify: `backend/app/config.py` (add three report constants)
- Create: `backend/tests/test_seo_coverage.py`

**Interfaces:**
- Consumes: `PlaceScopeConfig.city_routes_ready` (Task 1); `app.membership.DEFAULT_ELIGIBLE_CITY_SUBTYPES`; `app.geo.latitude_of`/`longitude_of`; the report constants below.
- Produces: dataclasses `Cluster`, `SubtypeShare`, `ScopeCoverage`, `CoverageReport`; `async def compute_coverage(bind, *, country: str | None = None) -> CoverageReport` (where `bind` is an `AsyncConnection` OR `AsyncSession` — uses only `.execute`); `CoverageReport.to_dict() -> dict` (JSON-ready).

- [ ] **Step 1: Add the config constants**

In `backend/app/config.py`, in the `Settings` class in the SEO section (after `seo_cache_max_age_seconds`), add:

```python
    # --- SEO coverage report (Slice 1e, docs/specs/2026-07-04-seo-coverage-gate-design.md) ---
    # A scope is *recommended* ready when this fraction of its (non-hidden) fountains resolved to a
    # city. A recommendation the owner reads before the signoff migration — never an automatic action.
    seo_coverage_ready_pct: float = 0.5
    # Grid size (degrees) for coarse ST_SnapToGrid binning of unmatched fountains — deterministic,
    # no k parameter (unlike ST_ClusterKMeans). ~0.5 degrees ~= a metro-scale cell.
    seo_coverage_grid_deg: float = 0.5
    # How many top unmatched grid cells to report per scope (and globally).
    seo_coverage_top_clusters: int = 10
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_seo_coverage.py`:

```python
"""Slice 1e — per-scope SEO coverage report (app.seo_coverage)."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.membership import refresh_all_memberships
from app.seo_coverage import compute_coverage


def _sq(x0, y0, x1, y1):
    return f"POLYGON(({x0} {y0}, {x1} {y0}, {x1} {y1}, {x0} {y1}, {x0} {y0}))"


async def _boundary(session, *, oid, subtype, cc, name, slug, wkt):
    await session.execute(
        text(
            """
            INSERT INTO place_boundaries
                (id, overture_id, subtype, class, name, country_code, slug, is_canonical,
                 fountain_count, boundary, created_at, updated_at)
            VALUES (gen_random_uuid(), :oid, :subtype, 'land', :name, :cc, :slug, false, 0,
                    ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
            """
        ),
        {"oid": oid, "subtype": subtype, "cc": cc, "name": name, "slug": slug, "wkt": wkt},
    )


async def _fountain(session, lat, lng, *, hidden=False):
    await session.execute(
        text(
            "INSERT INTO fountains (id, location, is_hidden, created_source) VALUES "
            "(gen_random_uuid(), ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :h, 'admin_import')"
        ),
        {"lat": lat, "lng": lng, "h": hidden},
    )


async def _scope(session, cc, subtypes, ready):
    await session.execute(
        text(
            "INSERT INTO place_scope_config (country_code, eligible_city_subtypes, city_routes_ready) "
            "VALUES (:cc, :s, :r) ON CONFLICT (country_code) DO UPDATE SET "
            "eligible_city_subtypes = EXCLUDED.eligible_city_subtypes, "
            "city_routes_ready = EXCLUDED.city_routes_ready"
        ),
        {"cc": cc, "s": list(subtypes), "r": ready},
    )


@pytest.fixture
async def _fixture(session):
    # Country AA (0..10) with one locality city AA-1 covering 0..2. Ready.
    await _boundary(session, oid="aa", subtype="country", cc="aa", name="Aaland",
                    slug="aaland", wkt=_sq(0, 0, 10, 10))
    await _boundary(session, oid="aa-1", subtype="locality", cc="aa", name="Aatown",
                    slug="aatown", wkt=_sq(0, 0, 2, 2))
    await _scope(session, "aa", ["locality", "localadmin"], ready=True)
    # 3 fountains in the city, 1 in-country-but-no-city (country_only).
    for lng, lat in [(1, 1), (0.5, 0.5), (1.5, 1.5), (5, 5)]:
        await _fountain(session, lat, lng)
    # A no-row country BB (default eligible set) with its own country + locality, one city fountain.
    await _boundary(session, oid="bb", subtype="country", cc="bb", name="Beeland",
                    slug="beeland", wkt=_sq(20, 20, 30, 30))
    await _boundary(session, oid="bb-1", subtype="locality", cc="bb", name="Beetown",
                    slug="beetown", wkt=_sq(20, 20, 22, 22))
    await _fountain(session, 21, 21)
    # An unmatched fountain outside every country.
    await _fountain(session, 80, 80)
    await refresh_all_memberships(session)
    await session.commit()


@pytest.mark.asyncio
async def test_scope_counts_and_coverage(session, _fixture):
    report = await compute_coverage(session)
    aa = next(s for s in report.scopes if s.country_code == "aa")
    assert aa.city_routes_ready is True
    assert aa.effective_eligible_city_subtypes == ["locality", "localadmin"]
    assert aa.eligible_from_config is True
    assert aa.fountains_in_country == 4
    assert aa.city_matched == 3
    assert aa.country_only == 1
    assert aa.city_coverage_pct == pytest.approx(0.75)
    assert aa.boundary_counts.get("locality") == 1
    assert aa.invalid_boundaries == 0
    assert aa.recommended_ready is True  # 0.75 >= 0.5
    shares = {s.subtype: s.count for s in aa.city_assignment_by_subtype}
    assert shares == {"locality": 3}


@pytest.mark.asyncio
async def test_no_config_row_reports_default_eligible_set(session, _fixture):
    report = await compute_coverage(session)
    bb = next(s for s in report.scopes if s.country_code == "bb")
    assert bb.city_routes_ready is False
    assert bb.eligible_from_config is False
    assert bb.effective_eligible_city_subtypes == ["locality", "localadmin"]


@pytest.mark.asyncio
async def test_global_unmatched_tail(session, _fixture):
    report = await compute_coverage(session)
    assert report.unmatched_no_country == 1
    assert len(report.unmatched_no_country_clusters) >= 1


@pytest.mark.asyncio
async def test_country_filter(session, _fixture):
    report = await compute_coverage(session, country="aa")
    assert [s.country_code for s in report.scopes] == ["aa"]


@pytest.mark.asyncio
async def test_coverage_pct_null_when_no_matched(session):
    await _boundary(session, oid="cc", subtype="country", cc="cc", name="Ceeland",
                    slug="ceeland", wkt=_sq(40, 40, 50, 50))
    await refresh_all_memberships(session)
    await session.commit()
    report = await compute_coverage(session)
    cc = next(s for s in report.scopes if s.country_code == "cc")
    assert cc.fountains_in_country == 0
    assert cc.city_coverage_pct is None


@pytest.mark.asyncio
async def test_compute_coverage_performs_no_writes(session, _fixture):
    before = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    fc_before = (await session.execute(
        text("SELECT coalesce(sum(fountain_count),0) FROM place_boundaries"))).scalar_one()
    await compute_coverage(session)
    after = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    fc_after = (await session.execute(
        text("SELECT coalesce(sum(fountain_count),0) FROM place_boundaries"))).scalar_one()
    assert (before, fc_before) == (after, fc_after)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/test_seo_coverage.py -v`
Expected: FAIL — `ModuleNotFoundError: app.seo_coverage`.

- [ ] **Step 4: Implement `app/seo_coverage.py`**

Create `backend/app/seo_coverage.py` (this is the complete file — no placeholders):

```python
"""Per-scope SEO coverage report (#127 Slice 1e, spec docs/specs/2026-07-04-seo-coverage-gate-design.md).

Read-only. For each loaded scope (a subtype='country' place) it reports boundary counts, how many of
the scope's non-hidden fountains resolved to a city vs country-only, the city-assignment split by
subtype, coarse clusters of where city coverage is missing, an invalid-geometry health check, and a
ready/not-ready RECOMMENDATION the owner reads before the signoff migration. Plus a global tail for
fountains in no loaded country.

`compute_coverage` issues plain reads against the given ``bind`` (an ``AsyncConnection`` or
``AsyncSession``) — no writes, no commit. The CLI (app/imports/seo_coverage_cli) wraps a whole run in
a session advisory lock + one READ ONLY REPEATABLE READ transaction so a production report can never
certify a half-loaded state (see the CLI and the spec's Consistency contract). Counting is over
NON-HIDDEN fountains throughout — the population that drives the public fountain_count and SEO surfaces.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession
from sqlalchemy.orm import aliased

from app.config import get_settings
from app.geo import latitude_of, longitude_of
from app.membership import DEFAULT_ELIGIBLE_CITY_SUBTYPES
from app.models import Fountain, PlaceBoundary

log = logging.getLogger(__name__)


@dataclass
class Cluster:
    lat: float
    lon: float
    count: int


@dataclass
class SubtypeShare:
    subtype: str
    count: int
    pct: float | None


@dataclass
class ScopeCoverage:
    country_code: str
    country_name: str
    city_routes_ready: bool
    effective_eligible_city_subtypes: list[str]
    eligible_from_config: bool
    boundary_counts: dict[str, int] = field(default_factory=dict)
    fountains_in_country: int = 0
    city_matched: int = 0
    country_only: int = 0
    city_coverage_pct: float | None = None
    city_assignment_by_subtype: list[SubtypeShare] = field(default_factory=list)
    top_unmatched_clusters: list[Cluster] = field(default_factory=list)
    invalid_boundaries: int = 0
    recommended_ready: bool = False


@dataclass
class CoverageReport:
    scopes: list[ScopeCoverage] = field(default_factory=list)
    unmatched_no_country: int = 0
    unmatched_no_country_clusters: list[Cluster] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _pct(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


async def compute_coverage(
    bind: AsyncConnection | AsyncSession, *, country: str | None = None
) -> CoverageReport:
    """Compute the coverage report from CURRENT DB state. Plain reads; no writes, no commit."""
    settings = get_settings()
    grid = settings.seo_coverage_grid_deg
    top_n = settings.seo_coverage_top_clusters

    # 1) The scopes: one per subtype='country' row (optionally filtered).
    country_q = select(PlaceBoundary.country_code, PlaceBoundary.name).where(
        PlaceBoundary.subtype == "country"
    )
    if country is not None:
        country_q = country_q.where(PlaceBoundary.country_code == country.lower())
    country_rows = (await bind.execute(country_q.order_by(PlaceBoundary.country_code))).all()

    # 2) place_scope_config: eligible sets + readiness, keyed by country_code.
    cfg = {
        r.country_code: (list(r.eligible_city_subtypes), r.city_routes_ready)
        for r in (
            await bind.execute(
                text(
                    "SELECT country_code, eligible_city_subtypes, city_routes_ready "
                    "FROM place_scope_config"
                )
            )
        ).all()
    }

    # 3) boundary counts by (country_code, subtype).
    bcounts: dict[str, dict[str, int]] = {}
    for r in (
        await bind.execute(
            text("SELECT country_code, subtype, count(*) AS n FROM place_boundaries "
                 "GROUP BY country_code, subtype")
        )
    ).all():
        bcounts.setdefault(r.country_code, {})[r.subtype] = r.n

    # 4) invalid geometry health by country_code (boundary is geography -> ::geometry).
    invalid = {
        r.country_code: r.n
        for r in (
            await bind.execute(
                text("SELECT country_code, count(*) AS n FROM place_boundaries "
                     "WHERE NOT ST_IsValid(boundary::geometry) GROUP BY country_code")
            )
        ).all()
    }

    # 5) per-scope fountain aggregates (non-hidden), keyed by the country place's country_code.
    agg = {
        r.cc: (r.in_country, r.city_matched, r.country_only)
        for r in (
            await bind.execute(
                text(
                    """
                    SELECT cpb.country_code AS cc,
                           count(*) AS in_country,
                           count(*) FILTER (WHERE f.city_place_id IS NOT NULL) AS city_matched,
                           count(*) FILTER (WHERE f.city_place_id IS NULL) AS country_only
                    FROM fountains f
                    JOIN place_boundaries cpb
                      ON cpb.id = f.country_place_id AND cpb.subtype = 'country'
                    WHERE f.is_hidden = false
                    GROUP BY cpb.country_code
                    """
                )
            )
        ).all()
    }

    # 6) city-assignment split by the city place's subtype, per country_code.
    by_subtype: dict[str, dict[str, int]] = {}
    for r in (
        await bind.execute(
            text(
                """
                SELECT cpb.country_code AS cc, citypb.subtype AS subtype, count(*) AS n
                FROM fountains f
                JOIN place_boundaries cpb ON cpb.id = f.country_place_id
                JOIN place_boundaries citypb ON citypb.id = f.city_place_id
                WHERE f.is_hidden = false AND f.city_place_id IS NOT NULL
                GROUP BY cpb.country_code, citypb.subtype
                """
            )
        )
    ).all():
        by_subtype.setdefault(r.cc, {})[r.subtype] = r.n

    # 7) unmatched clusters: country_only fountains, coarse-binned by grid, per country_code.
    #    Uses app.geo for lat/lon; casts to geometry for ST_SnapToGrid. The snapped-cell WKT is a
    #    deterministic tie-break so equal-count cells order stably (no flaky JSON / tests).
    country_pb = aliased(PlaceBoundary)
    cell = func.ST_AsText(func.ST_SnapToGrid(cast(Fountain.location, Geometry), grid))
    clusters: dict[str, list[Cluster]] = {}
    for r in (
        await bind.execute(
            select(
                country_pb.country_code.label("cc"),
                func.count().label("n"),
                func.avg(latitude_of(Fountain.location)).label("lat"),
                func.avg(longitude_of(Fountain.location)).label("lon"),
            )
            .select_from(Fountain)
            .join(country_pb, country_pb.id == Fountain.country_place_id)
            .where(Fountain.is_hidden.is_(False), Fountain.city_place_id.is_(None))
            .group_by(country_pb.country_code, cell)
            .order_by(country_pb.country_code, func.count().desc(), cell)
        )
    ).all():
        bucket = clusters.setdefault(r.cc, [])
        if len(bucket) < top_n:
            bucket.append(Cluster(lat=float(r.lat), lon=float(r.lon), count=int(r.n)))

    scopes: list[ScopeCoverage] = []
    for cr in country_rows:
        cc = cr.country_code
        eligible, ready = cfg.get(cc, (list(DEFAULT_ELIGIBLE_CITY_SUBTYPES), False))
        in_country, city_matched, country_only = agg.get(cc, (0, 0, 0))
        shares = [
            SubtypeShare(subtype=st, count=n, pct=_pct(n, city_matched))
            for st, n in sorted(by_subtype.get(cc, {}).items())
        ]
        pct = _pct(city_matched, in_country)
        scopes.append(
            ScopeCoverage(
                country_code=cc,
                country_name=cr.name,
                city_routes_ready=ready,
                effective_eligible_city_subtypes=eligible,
                eligible_from_config=cc in cfg,
                boundary_counts=bcounts.get(cc, {}),
                fountains_in_country=in_country,
                city_matched=city_matched,
                country_only=country_only,
                city_coverage_pct=pct,
                city_assignment_by_subtype=shares,
                top_unmatched_clusters=clusters.get(cc, []),
                invalid_boundaries=invalid.get(cc, 0),
                recommended_ready=pct is not None and pct >= settings.seo_coverage_ready_pct,
            )
        )

    # 8) global tail: non-hidden fountains in NO loaded country.
    unmatched = (
        await bind.execute(
            text("SELECT count(*) AS n FROM fountains "
                 "WHERE is_hidden = false AND country_place_id IS NULL")
        )
    ).scalar_one()
    gclusters: list[Cluster] = []
    for r in (
        await bind.execute(
            select(
                func.count().label("n"),
                func.avg(latitude_of(Fountain.location)).label("lat"),
                func.avg(longitude_of(Fountain.location)).label("lon"),
            )
            .where(Fountain.is_hidden.is_(False), Fountain.country_place_id.is_(None))
            .group_by(cell)
            .order_by(func.count().desc(), cell)
        )
    ).all():
        if len(gclusters) < top_n:
            gclusters.append(Cluster(lat=float(r.lat), lon=float(r.lon), count=int(r.n)))

    report = CoverageReport(
        scopes=scopes,
        unmatched_no_country=int(unmatched),
        unmatched_no_country_clusters=gclusters,
    )
    log.info(
        "seo_coverage_computed",
        extra={"scopes": len(scopes), "unmatched_no_country": report.unmatched_no_country},
    )
    return report
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_seo_coverage.py -v`
Expected: all PASS.

- [ ] **Step 6: Lint/format**

Run: `uv run ruff check app/seo_coverage.py tests/test_seo_coverage.py && uv run ruff format --check app/seo_coverage.py tests/test_seo_coverage.py`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/app/seo_coverage.py backend/app/config.py backend/tests/test_seo_coverage.py
git commit -m "feat(backend): per-scope SEO coverage report core (#127 Slice 1e)"
```

---

### Task 4: Locked CLI — `app/imports/seo_coverage_cli.py`

**Files:**
- Create: `backend/app/imports/seo_coverage_cli.py`
- Modify: `backend/tests/test_seo_coverage.py` (add locked-wrapper + CLI tests)

**Interfaces:**
- Consumes: `compute_coverage` (Task 3); `app.db.get_engine`; `app.locks.ADD_FOUNTAIN_LOCK_KEY`.
- Produces: `async def collect_locked_coverage(*, country: str | None = None) -> CoverageReport`; `_COUNTRY_RE`; `def main(argv=None) -> int`.

> **Why the lock ordering is written this way (load-bearing).** The consistency contract requires the
> read snapshot to be established *after* the advisory lock is held. A `REPEATABLE READ` snapshot is
> fixed by the transaction's **first statement**, so we must NOT take the lock as that first statement.
> Instead: acquire a **session-level** `pg_advisory_lock` and **commit that transaction** — a session
> lock survives the commit (it is tied to the connection, not the transaction) — *then* set
> `REPEATABLE READ, READ ONLY` and run the reads, whose first statement now fixes the snapshot after
> the lock wait completed. (In SQLAlchemy 2.0.51 you cannot change `isolation_level` while a
> transaction is active — the initial `commit()` clears it, which is why the isolation is set only
> after that commit.)

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_seo_coverage.py` (add `import json` at the top):

```python
@pytest.mark.asyncio
async def test_collect_locked_coverage_matches_and_releases_lock(session, _fixture):
    from app.imports.seo_coverage_cli import collect_locked_coverage
    from app.locks import ADD_FOUNTAIN_LOCK_KEY

    report = await collect_locked_coverage()
    assert {s.country_code for s in report.scopes} >= {"aa", "bb"}

    # The session advisory lock must be released after the run: another session can take it.
    got = (await session.execute(
        text("SELECT pg_try_advisory_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})).scalar_one()
    assert got is True
    await session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
    await session.commit()


@pytest.mark.asyncio
async def test_lock_is_held_during_read(session, _fixture, monkeypatch):
    """Regression guard for the lock-then-snapshot contract: while the report reads, the advisory
    lock is HELD (a separate connection's pg_try_advisory_lock fails). If the lock were taken as the
    read transaction's first statement / not held across the read, this would fail."""
    import app.imports.seo_coverage_cli as cli
    from app.db import get_engine
    from app.locks import ADD_FOUNTAIN_LOCK_KEY

    real = cli.compute_coverage
    seen = {}

    async def probe(bind, **kw):
        async with get_engine().connect() as other:
            got = (await other.execute(
                text("SELECT pg_try_advisory_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})).scalar_one()
            seen["held"] = got is False
            if got:  # defensive: if we somehow acquired it, release so we don't leak the lock
                await other.execute(
                    text("SELECT pg_advisory_unlock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
            await other.rollback()
        return await real(bind, **kw)

    monkeypatch.setattr(cli, "compute_coverage", probe)
    await cli.collect_locked_coverage()
    assert seen["held"] is True


@pytest.mark.asyncio
async def test_collect_locked_coverage_no_writes(session, _fixture):
    from app.imports.seo_coverage_cli import collect_locked_coverage

    before = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    await collect_locked_coverage()
    after = (await session.execute(text("SELECT count(*) FROM fountains"))).scalar_one()
    assert before == after


def test_country_regex_validation():
    from app.imports.seo_coverage_cli import _COUNTRY_RE

    assert _COUNTRY_RE.fullmatch("us") and _COUNTRY_RE.fullmatch("US")
    assert not _COUNTRY_RE.fullmatch("usa")
    assert not _COUNTRY_RE.fullmatch("u")
    assert not _COUNTRY_RE.fullmatch("u1")
    assert not _COUNTRY_RE.fullmatch("us\n")


def test_cli_main_prints_json(capsys, monkeypatch):
    """main() is a sync entrypoint (argparse + asyncio.run + print). Stub the DB-touching collector
    so this stays a pure sync test — no nested event loop, no DB."""
    import app.imports.seo_coverage_cli as cli
    from app.seo_coverage import CoverageReport

    async def fake(*, country=None):
        return CoverageReport(scopes=[], unmatched_no_country=0)

    monkeypatch.setattr(cli, "collect_locked_coverage", fake)
    rc = cli.main([])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload == {"scopes": [], "unmatched_no_country": 0, "unmatched_no_country_clusters": []}


def test_cli_main_rejects_bad_country():
    import app.imports.seo_coverage_cli as cli

    with pytest.raises(SystemExit):
        cli.main(["--country", "usa"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_seo_coverage.py -k "locked or lock_is_held or country_regex or cli_main" -v`
Expected: FAIL — `ModuleNotFoundError: app.imports.seo_coverage_cli`.

- [ ] **Step 3: Implement the CLI**

Create `backend/app/imports/seo_coverage_cli.py` (complete file):

```python
"""SEO coverage report CLI (#127 Slice 1e). Read-only; the CI-only prod path kubectl-execs this in
the backend pod (mirrors membership_cli). Prints ONE machine-readable JSON line — the result contract.

Consistency (spec docs/specs/2026-07-04-seo-coverage-gate-design.md): acquire a SESSION-level advisory
lock (ADD_FOUNTAIN_LOCK_KEY) and COMMIT that transaction BEFORE the read transaction, so the read's
REPEATABLE READ snapshot is established only after the lock wait completes (a session lock survives
the commit). Then read inside one READ ONLY REPEATABLE READ transaction. Release the lock in finally.

Usage:
  python -m app.imports.seo_coverage_cli [--country us]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re

from sqlalchemy import text

from app.db import get_engine
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.logging_config import configure_logging
from app.seo_coverage import CoverageReport, compute_coverage

log = logging.getLogger(__name__)

# fullmatch (below) is used, not match — a `$`-anchored pattern would accept a trailing newline
# ("us\n"), so validate against the WHOLE string instead.
_COUNTRY_RE = re.compile(r"[A-Za-z]{2}")


async def collect_locked_coverage(*, country: str | None = None) -> CoverageReport:
    """Run compute_coverage under the session advisory lock + one READ ONLY REPEATABLE READ txn."""
    engine = get_engine()
    async with engine.connect() as conn:
        # (1) Acquire the SESSION lock, then COMMIT — the lock survives (session-scoped), and the
        # commit clears the transaction so (a) isolation can be changed and (b) the next transaction's
        # snapshot is fixed AFTER the lock wait completed (the load-bearing ordering).
        await conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
        await conn.commit()
        try:
            # (2) One READ ONLY REPEATABLE READ transaction — a single consistent snapshot. Isolation
            # is set now that no transaction is active; the first read below autobegins it.
            ro = await conn.execution_options(
                isolation_level="REPEATABLE READ", postgresql_readonly=True
            )
            report = await compute_coverage(ro, country=country)
            await ro.commit()
            return report
        finally:
            await conn.rollback()
            await conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY})
            await conn.commit()


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(prog="seo_coverage_cli")
    parser.add_argument("--country", default=None, help="optional ISO-3166-1 alpha-2 scope filter")
    args = parser.parse_args(argv)
    if args.country is not None and not _COUNTRY_RE.fullmatch(args.country):
        parser.error("--country must be a 2-letter code")
    report = asyncio.run(collect_locked_coverage(country=args.country))
    log.info("seo_coverage_cli_done", extra={"scopes": len(report.scopes)})
    print(json.dumps(report.to_dict(), default=str))  # documented CLI result contract
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

> IMPLEMENTER VERIFICATION: in this repo's SQLAlchemy 2.0.51, `AsyncConnection.execution_options(...)`
> is a coroutine — it MUST be awaited (`ro = await conn.execution_options(...)`). The load-bearing
> invariant, guarded by `test_lock_is_held_during_read` +
> `test_collect_locked_coverage_matches_and_releases_lock`: the `pg_advisory_lock` + `commit()` happen
> BEFORE the `REPEATABLE READ` reads, and the lock is released in `finally`. If
> `execution_options(isolation_level=...)` ever raises "isolation_level may not be altered" here, it
> means a transaction is still active — ensure the step-1 `commit()` ran.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_seo_coverage.py -k "locked or lock_is_held or country_regex or cli_main" -v`
Expected: all PASS.

- [ ] **Step 5: Run the whole coverage suite + lint**

Run: `uv run pytest tests/test_seo_coverage.py -v && uv run ruff check app/imports/seo_coverage_cli.py && uv run ruff format --check app/imports/seo_coverage_cli.py`
Expected: all PASS, lint clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/imports/seo_coverage_cli.py backend/tests/test_seo_coverage.py
git commit -m "feat(backend): SEO coverage CLI under session lock + read-only snapshot (#127 Slice 1e)"
```

---

### Task 5: Workflow — `seo-coverage-report.yml`

**Files:**
- Create: `.github/workflows/seo-coverage-report.yml`

**Interfaces:**
- Consumes: the deployed `seo_coverage_cli` in the backend pod; the `boundary-load-production` concurrency group (shared with `osm-boundary-load.yml`).

- [ ] **Step 1: Read the mandatory infra docs + the sibling workflow**

Read `claude_help/kubernetes-infra.md` + `claude_help/github-environments.md` (mandatory before touching CI/infra), then `.github/workflows/osm-boundary-load.yml` for the exact runner class (`ubuntu-latest # Class B: handles cluster credentials`), the workflow-level `env` (`CLUSTER_NAME: fountainrank-production-cluster`, `NAMESPACE: fountainrank`), `permissions: contents: read`, `environment: production`, and the `doctl`/kubeconfig/find-pod/exec pattern.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/seo-coverage-report.yml`:

```yaml
name: SEO coverage report

# Read-only per-scope SEO coverage report (#127 Slice 1e, spec:
# docs/specs/2026-07-04-seo-coverage-gate-design.md). Manual dispatch, NO inputs — always emits the
# full report (a handful of scopes; no injectable input surface). kubectl-execs the deployed
# seo_coverage_cli in the backend pod (the CI-only prod read path). The CLI itself takes the
# membership advisory lock + a READ ONLY REPEATABLE READ snapshot; this workflow additionally SHARES
# osm-boundary-load's concurrency group so a report can never interleave a boundary load's
# between-batch (un-locked) window.
on:
  workflow_dispatch: {}

concurrency:
  group: boundary-load-production
  cancel-in-progress: false

permissions:
  contents: read

env:
  CLUSTER_NAME: fountainrank-production-cluster
  NAMESPACE: fountainrank

jobs:
  coverage:
    name: SEO coverage report (read-only)
    runs-on: ubuntu-latest # Class B: handles cluster credentials
    environment: production
    steps:
      - uses: digitalocean/action-doctl@v2.5.2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Save kubeconfig
        run: doctl kubernetes cluster kubeconfig save "$CLUSTER_NAME"

      - name: Run the SEO coverage report in the backend pod
        run: |
          set -euo pipefail
          POD="$(kubectl -n "$NAMESPACE" get pod -l app=fountainrank-backend \
            --field-selector=status.phase=Running \
            -o jsonpath='{.items[0].metadata.name}')"
          if [ -z "$POD" ]; then echo "::error::no Running backend pod found"; exit 1; fi
          echo "backend pod: $POD"
          echo "::group::seo coverage report (read-only)"
          kubectl -n "$NAMESPACE" exec "$POD" -- python -m app.imports.seo_coverage_cli
          echo "::endgroup::"
```

- [ ] **Step 3: Verify against the sibling workflow**

Diff the `env`, `runs-on`, `environment`, `permissions`, `action-doctl` version, and the pod
selector against `osm-boundary-load.yml` — they MUST match (backend pod label `app=fountainrank-backend`, cluster name, namespace). The only intentional differences: no `checkout` (the CLI is already in the pod image), no inputs, no DuckDB/S3/file-streaming steps.

- [ ] **Step 4: Lint the workflow (if actionlint is available)**

Run (optional): `actionlint .github/workflows/seo-coverage-report.yml`
Expected: no errors. (Otherwise rely on the CI workflow-lint job.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/seo-coverage-report.yml
git commit -m "ci: add read-only SEO coverage report workflow (#127 Slice 1e)"
```

---

### Task 6: Web verification — city noindex + sitemap exclusion inherit the gate

The gate is entirely backend: a not-ready scope makes the backend return an empty city list and
`indexable=false`, which is **behaviorally identical** to a below-`K` place — the web has no
not-ready-specific code. This task makes the spec §6 web assertions explicit and ensures they run in
CI (the gating `workspace-js` job; JS can't run on this Windows host — see Global Constraints).

**Files:**
- Modify: `web/app/drinking-fountains/[country]/[city]/page.test.tsx` (assert noindex when `indexable=false`)
- Modify: `web/app/sitemap.test.ts` (assert a country whose city list is empty contributes no city URLs)

- [ ] **Step 1: Add/confirm the city-page noindex test**

In `web/app/drinking-fountains/[country]/[city]/page.test.tsx`, mirroring the file's existing
`vi.mock("../../../../lib/places")` + `getCityFountainsServer.mockResolvedValue(...)` pattern, ensure a
test asserts: when the mocked `getCityFountainsServer` resolves `{ data: { place, fountains: [...], indexable: false }, status: 200 }`, `generateMetadata(...)` returns `robots: { index: false, follow: true }`. If an equivalent assertion already exists (the below-`K` case), add a comment noting it also covers the not-ready scope (same `indexable=false` path) and move on — do not duplicate.

- [ ] **Step 2: Add/confirm the cities-sitemap exclusion test**

In `web/app/sitemap.test.ts`, mirroring its existing `getCountriesServer`/`getCountryCitiesServer`
mocks, ensure a test asserts: when `getCountryCitiesServer` resolves `{ data: [], status: 200 }` for a
country, the cities sitemap output contains no `/[country]/[city]` URLs for it (the not-ready scope
yields no city URLs). If the empty-list case is already covered, add the clarifying comment and move on.

- [ ] **Step 3: Verify in CI**

These run in the `workspace-js` job (vitest). They cannot run on this Windows host. Confirm green in
the PR's CI (Task 7) — that is the web verification gate.

- [ ] **Step 4: Commit**

```bash
git add web/app/drinking-fountains/[country]/[city]/page.test.tsx web/app/sitemap.test.ts
git commit -m "test(web): assert city noindex + sitemap exclusion inherit the readiness gate (#127 Slice 1e)"
```

---

### Task 7: Full local CI mirror, PR, Codex review, merge, deploy

**Files:** none (verification + process)

- [ ] **Step 1: Run the full backend CI mirror**

From `backend/` (isolated `UV_PROJECT_ENVIRONMENT`):
`uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`
Expected: all green, no drift.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: SEO coverage report + per-scope city-routes readiness gate (#127 Slice 1e)" \
  --body "Implements Slice 1e per docs/specs/2026-07-04-seo-coverage-gate-design.md (Codex spec-approved). Per-scope coverage report (app/seo_coverage.py + seo_coverage_cli + seo-coverage-report.yml, read-only under session lock + READ ONLY REPEATABLE READ) and the place_scope_config.city_routes_ready gate (list_places cities branch + city_fountains.indexable; web/sitemap inherit it). us/lu seeded ready — no regression. Runbook: docs/runbooks/seo.md."
```

- [ ] **Step 3: Get CI green** (backend + `workspace-js` web tests from Task 6), then run the Codex PR-review loop (`claude_help/codex-review-process.md` Loop B): bypass mode, WSL `cwd`, repo-relative paths; address every finding + any other PR comment; loop to `VERDICT: APPROVED`.

- [ ] **Step 4: Squash-merge** once CI is green AND Codex `VERDICT: APPROVED` AND every comment addressed: `gh pr merge <N> --squash`.

- [ ] **Step 5: Deploy + verify (post-merge, owner-gated)**

Deploy backend (`gh workflow run deploy.yml --ref main`), then `gh workflow run seo-coverage-report.yml --ref main` and confirm the JSON for `us`/`lu` (both ready, high country match, `invalid_boundaries=0`). Confirm the live cities sitemap still lists US/LU cities and a US city page is still indexable (the gate only ever *removes* not-ready scopes, which us/lu are not).

---

## Self-Review

**Spec coverage:**
- §3 data model (`city_routes_ready` + seed us/lu) → Task 1. ✓
- §4 report content (boundary counts, coverage %, by-subtype, clusters, invalid-geometry, effective eligible + `eligible_from_config`, global tail, `recommended_ready`) → Task 3. ✓
- §4 delivery + consistency contract (session lock committed → RO RR txn; no workflow country input; workflow concurrency group) → Task 4 (CLI) + Task 5 (workflow). ✓
- §5 gate wiring (`list_places` cities branch + `city_fountains.indexable`; web inherits) → Task 2 + Task 6. ✓
- §6 testing (report fixtures, gate tests, no-row default, div-by-zero null, read-only, lock contract, migration up/down + alembic check + us/lu seeded, web noindex + sitemap exclusion) → Tasks 1–4, 6. ✓
- §7 decisions (SnapToGrid clustering w/ deterministic tie-break, `ST_IsValid(boundary::geometry)`, git-declared signoff via migration) → Tasks 1, 3. ✓
- §8 rollout → Task 7. ✓

**Placeholder scan:** no `TBD`/`TODO`/"handle edge cases". Every code block is the complete artifact; the two IMPLEMENTER notes are verification guidance (`AsyncConnection.execution_options(...)` is a coroutine and must be awaited; how to confirm the migration seed state), not missing code.

**Type consistency:** `_scope_city_routes_ready` (Task 2) ↔ `city_routes_ready` column (Task 1); `compute_coverage(bind, ...)` accepts `AsyncConnection | AsyncSession` and is called with an `AsyncSession` (tests) and an `AsyncConnection` (Task 4) — both expose `.execute`; `CoverageReport`/`Cluster`/`SubtypeShare`/`ScopeCoverage`/`collect_locked_coverage`/`_COUNTRY_RE` names match across Tasks 3–4; constants `seo_coverage_ready_pct`/`_grid_deg`/`_top_clusters` defined in Task 3, consumed in Task 3.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-04-seo-coverage-gate.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
