# #127 Slice 1d — membership backfill perf fix SHIPPED + backfill DONE — handoff (2026-07-03)

**Supersedes** `2026-07-03-membership-backfill-perf-blocker-handoff.md`. That handoff diagnosed the
country-scale perf defect in `refresh_all_memberships` and validated the `ST_Subdivide` fix. This
session **implemented, shipped, and re-ran the backfill in prod — successfully.** The blocker is
resolved.

---

## ✅ Done this session

### The fix (PR #162, squash-merged as `e8fcf43`)
Membership point-in-polygon at country scale now runs against **`place_boundary_cells`** — every
boundary broken into small `ST_Subdivide` pieces — instead of the whole 136k-vertex polygon.
- **Migration `0016_place_boundary_cells`**: `id`, `place_id` FK→`place_boundaries` `ON DELETE
  CASCADE`, `geom geometry(Geometry,4326)` GiST-indexed, btree on `place_id`. Created empty (a
  rebuildable derivative of `place_boundaries`). ORM model `PlaceBoundaryCell` in `app/models.py`.
- **`app/membership.py`**: `rebuild_place_boundary_cells()` = `TRUNCATE` + `INSERT
  ST_Subdivide(boundary,128)` + **`ANALYZE`** (fresh in-txn stats so the following PIP uses the cell
  GiST index, not a seq scan on a post-TRUNCATE "0-row" table). `_ASSIGN_SQL` now does planar
  `ST_Covers(cell.geom, location::geometry)` joined back to `place_boundaries` by `place_id`; country
  match tie-breaks on `overture_id` (dropped the pointless `ST_Area` over the huge polygon).
  `_PARENT_SET_SQL` derives `parent_id` by **`country_code` join** (no spatial op — faster + more
  correct, no border-crossing edge cases). `refresh_all_memberships(rebuild_cells: bool = True)`.
- **`app/imports/merge.py`**: OSM import + rollback pass `rebuild_cells=False` (they change
  fountains, not boundaries — skip the ~200s subdivide; the boundary-load path is the only rebuilder).
- **Tests**: new `test_place_boundary_cells_migration.py` + a multi-cell-subdivide/PIP test; existing
  incremental/OSM-import tests build cells first. Full backend local check green; **pytest 568
  passed**, `alembic check` no drift. Codex `VERDICT: APPROVED` (PR #162). CI green except the
  **pre-existing** `mobile-doctor` Expo-SDK-56 patch drift (unrelated; red on `main` too — owner
  authorized merging despite it).

### Deployed + backfilled (prod)
- **Deploy** `deploy.yml` run `28686374152` **success** — migration `0016` ran on prod (created
  `place_boundary_cells`). `api.fountainrank.com/healthz`+`/readyz` = 200.
- **Backfill** `osm-boundary-load.yml` (`overture:lu`, release `2026-06-17.0`, `dry_run=false`) run
  `28686512741` **success** — reloaded LU (114 features, idempotent) → full cell rebuild + assign.
  It **COMPLETED** (job 6m43s incl. S3/deploy plumbing; membership refresh finished ~86s after the
  cell rebuild) vs the **43+ min canceled** run that exposed the defect.

### Prod result (from `membership_refresh_complete`, read off the committed DB)
- `place_boundary_cells` = **250,534** cells (matches the pre-validated measurement exactly).
- fountains_total **49,891**; matched_country **24,630**; matched_city **18,694**; country_only
  **5,936**; unmatched **25,261** (outside LU/US — other countries/ocean, correctly no boundary);
  canonical_places **18,086**. Internally consistent (24,630 + 25,261 = 49,891).

## 🟢 Prod state
Membership is fully populated. The deployed backend now runs the fast cells-based PIP on **both**
the full refresh AND the single-fountain path (user add / admin edit read the same cells). Cells are
rebuilt automatically on every boundary load / backfill; a plain OSM import/rollback skips the
rebuild (`rebuild_cells=False`).

## 🔭 Next
- **Slice 2+ (public place routes)** — the precomputed membership (`fountains.country_place_id` /
  `city_place_id`, `place_boundaries.fountain_count` / `is_canonical` / `parent_id`) is now populated
  and ready for the public `/drinking-fountains/[country]/[city]` pages to read (never a live
  `ST_Covers`). See `docs/plans/2026-07-02-crawlable-seo-pages.md`.
- **Pre-existing blocker unrelated to this work:** `mobile-doctor` is red on `main` (Expo SDK 56
  patch drift — `expo 56.0.13` vs `~56.0.14` + 4 other `expo-*` patches). Fix with `expo install
  --fix` in the mobile workspace in its own PR; until then every PR shows one red check.
- **Loading more countries later:** each `osm-boundary-load.yml` run rebuilds ALL cells (full
  rebuild from all `place_boundaries`) and re-assigns every fountain. If loading several countries,
  use `--skip-membership-refresh` per load then one final `membership_cli` (or a final load) to
  rebuild once.
