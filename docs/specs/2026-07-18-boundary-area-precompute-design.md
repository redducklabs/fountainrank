# Precompute `place_boundaries.boundary_area` to unblock France's boundary load

**Status:** design → implement. First increment of #249 (publish/membership-window optimization).
**Author context:** finishing the worldwide boundary fan-out (79/80 countries loaded).

## 1. Problem

France (`overture:fr`) is the only configured country that failed to load. Its total loader
wall-clock is ~6h (region+city parenting ~2h33m in the successful-so-far run, publish ~3h). The
binding constraint is **not** the pod's `active_deadline_seconds` (raised to 8h in #252) — it is the
**hard 6-hour job-execution limit on GitHub-hosted `ubuntu-latest` runners** that babysit the pod.
Run `29630881513` reached its final publish milestone (`membership_recounted`, 37,137 places) at
5h41m and GitHub cancelled the job at 5h59m (`##[error]The operation was canceled.`), ~18 min short.
The fail-closed teardown reaped the session and France rolled back (0 committed cells). See memory
`fountainrank-boundary-load-6h-runner-cap`.

France is therefore ~18–20 minutes over one ceiling. We need to shave that off its runtime.

## 2. Root cause of the recoverable time

The city-parent step (`_staged_city_parent_sql` in `backend/app/membership.py`) parents each city to
the **smallest** canonical region covering the city's representative point, via:

```
ORDER BY ST_Area(pb.boundary) ASC, pb.overture_id ASC
```

`pb.boundary` is `Geography(MultiPolygon,4326)`, so `ST_Area` is a **geodesic** area over the full
(often large, high-vertex) region multipolygon. This runs **once per city** — for France that is
**37,026 cities** — even though France has only **13 distinct regions**. The same
`ST_Area(pb.boundary)` recompute appears in the fountain-assign laterals
(`_ASSIGN_SQL`, `_ASSIGN_CANDIDATE_SQL`) and the region/city canonical-selection order-bys. It is a
pure recompute of a value that depends only on the (immutable during a load) boundary geometry.

`ST_Area(geography, boolean)` is `IMMUTABLE` (verified in prod `pg_proc`), so the area is a stable
function of the row and can be stored once.

## 3. Design

Add a stored `boundary_area double precision` column to `place_boundaries`, populated with
`ST_Area(boundary)` at write time, and read it in the membership order-bys instead of recomputing.

**Behavior-preserving requirement:** the current expression is `ST_Area(pb.boundary)` = `ST_Area(pb.boundary, true)`
(1-arg default `use_spheroid = true`). The stored value MUST be computed the same way so ordering is
byte-identical. Order-by sites use `COALESCE(pb.boundary_area, ST_Area(pb.boundary))` so any row
without a stored value (e.g. rows loaded before this change, not yet backfilled) still orders
correctly — just without the speedup.

### 3.1 Migration (`0028_boundary_area`)

- `ALTER TABLE place_boundaries ADD COLUMN boundary_area double precision` — nullable, **metadata-only
  (rewrite-free)**: it does not rewrite the 248k rows. It is *not* lock-free — ADD COLUMN briefly
  takes `ACCESS EXCLUSIVE`, and a queued acquisition behind a conflicting long transaction would
  block ordinary reads. The migration runs `SET LOCAL lock_timeout = '3s'` first so, if the deploy's
  no-loader-in-flight precondition is ever violated, it **fails fast (retry in a quiet window)**
  instead of stalling live reads. In the normal deploy window the lock is free and the ALTER is
  near-instant.
- **No in-migration backfill.** Correctness is preserved by the `COALESCE` fallback; new/re-loaded
  boundaries populate the column on insert. This keeps the deploy migration instant and avoids
  bloating the live table during a deploy. Backfilling already-loaded countries is a separate,
  optional, batched follow-up (they are already loaded; only their *future* refreshes benefit).

### 3.2 Loader populate (`boundary_load.py` `_UPSERT_SQL`)

- Add `boundary_area` to the INSERT column list, value `ST_Area(coerced.g::geography, true)`.
- Add `boundary_area = ST_Area(EXCLUDED.boundary, true)` to the `ON CONFLICT DO UPDATE` set (the
  boundary can change on conflict, so the stored area must follow it).

France's boundaries are inserted fresh at the start of its (re-)load, so its region/city areas are
precomputed **before** the city-parent step reads them → France gets the fast path immediately.

### 3.3 Read sites (`membership.py`)

Replace `ST_Area(pb.boundary)` with `COALESCE(pb.boundary_area, ST_Area(pb.boundary))` at every
order-by over a `place_boundaries` alias:
`_ASSIGN_SQL`, `_ASSIGN_CANDIDATE_SQL` (region + city laterals), the region/city canonical-selection
order-bys, and `_staged_city_parent_sql` (region lateral). All are on the `pb` alias =
`place_boundaries`, which has the new column. No change to result ordering.

### 3.4 Model (`models.py`)

Add `boundary_area: Mapped[float | None]` to `PlaceBoundary`.

## 4. Correctness & risk

- **Behavior-preserving:** stored value equals the recomputed value; `COALESCE` guarantees identical
  ordering with or without backfill. Membership assignment (`docs/specs/...§5/§11.5`) is unchanged.
- **No live-site impact:** `/api/v1/places` does not read `boundary_area`; the migration is
  rewrite-free and bounds its `ACCESS EXCLUSIVE` acquisition with a 3s `lock_timeout` (fail-fast, no
  unbounded stall); the loader change only adds a cheap column write per boundary insert.
- **Tests:** existing `backend/tests/test_membership*.py` and boundary-load tests must stay green
  (ordering unchanged). Assert (a) a freshly loaded boundary has `boundary_area` populated and equal
  to `ST_Area(boundary, true)`, and (b) an `ON CONFLICT` reload with a different-area geometry moves
  `boundary` and `boundary_area` together (no stale precomputed area). Confirm `alembic upgrade head`
  + `alembic check` are clean.

## 5. Expected effect

Eliminates ~37k redundant geodesic `ST_Area` computations over large region multipolygons in France's
city-parent step (and the analogous recomputes in the assign/canonical order-bys). Given France was
only ~18–20 min over the 6h runner cap, this is expected to bring it under 6h with margin. If it does
not, the remaining lever is decoupling the load from the 6h-capped runner (a runner-isolation change
that is an owner decision) — out of scope here.

## 6. Out of scope

- The publish fountain-assign UPDATE's dominant cost is the `ST_Covers` PIP, not the `ST_Area`
  order-by; further optimizing it is later #249 work.
- Backfilling `boundary_area` for already-loaded countries (optional, batched).
- Any change to the runner/pod coupling or `active_deadline_seconds`.
