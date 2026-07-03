# #127 Slice 1d — membership backfill BLOCKED on a perf defect — handoff (2026-07-03)

**Source:** the session that merged Slice 1d (PR #161, see `2026-07-03-seo-pages-slice-1d-handoff.md`),
then **deployed it to prod and tried to run the one-time membership backfill** — which exposed a
country-scale performance defect in `refresh_all_memberships`. The backfill is **blocked** until the
fix below ships. Prod is clean (no partial data). **Next task = ship the `ST_Subdivide` fix, then
re-run the backfill.**

---

## ✅ Done this session (prod)
- **Deployed Slice 1d** — `gh workflow run deploy.yml --ref main` **green**. Migration `0015` ran on
  prod (`fountains.country_place_id`/`city_place_id`, `place_boundaries.fountain_count`,
  `place_scope_config` seeded us/lu). Verified live: `api.fountainrank.com/healthz`+`/readyz` = 200
  (PostGIS 3.6), apex 200. So the prod backend now HAS `app.membership` + `membership_cli`.

## ❌ Blocked: the membership backfill does NOT scale (measured on prod)
Dispatched `osm-boundary-load.yml -f scope_id=overture:lu -f overture_release_id=2026-06-17.0 -f dry_run=false`
(re-load LU idempotently + global `refresh_all_memberships`). It ran **43+ min on the ASSIGN step
alone** before I canceled it. Root cause, measured directly against prod:

- **Prod has 49,891 fountains** (not the few hundred assumed). `refresh_all_memberships` does a
  **per-fountain `ST_Covers` against `place_boundaries`**, and the country match tests every fountain
  against the **US country polygon = 136,302 vertices**. Its bbox covers all fountains, so the
  `location && boundary` GIST prefilter prunes **nothing** — each of ~50k fountains runs an exact
  point-in-polygon against a 136k-vertex polygon. Isolated `EXPLAIN ANALYZE` of just the country
  match **timed out at >180s**.
- **Geometry sizes** (`ST_NPoints(boundary)`): country max **136,302** / avg 77,191; region max
  43,034 / avg 9,215; county max 29,244 / avg 1,200; locality max 27,374 / **avg 253**.
- **Per-subtype covering-join speed** (50k fountains, 60s statement timeout): `locality` covered
  **18,894** in ~58s (borderline); `localadmin` 0 (US has none covering fountains); `county` and
  `region` **timed out** (>60s). So even mid-size polygons don't scale; only localities are near-OK.
- `_PARENT_SET_SQL` is doubly bad — it does `ST_PointOnSurface` + `ST_Covers` against country
  polygons for all ~35k non-country places. And both country laterals needlessly compute
  `ST_Area(136k-vertex polygon)` in their `ORDER BY`, per row.

## ✅ Validated fix — `ST_Subdivide` cells (measured on prod: >180s → **7.4s**)
Break every boundary into small GIST-indexed pieces so point-in-polygon is fast regardless of the
original polygon's vertex count (the canonical PostGIS pattern for point-in-huge-polygon at scale):
- `ST_Subdivide(boundary::geometry, 128)` over all 35,130 boundaries → **250,534 cells**, built +
  GIST-indexed + analyzed in **~197s** (one-time, at boundary load).
- PIP via cells for **all** fountains/subtypes: **7.4s** (vs the >180s country-polygon timeout).
  (Coverage: 25,006 fountains fall in some loaded boundary; 18,894 in a locality; the other ~25k are
  outside LU/US entirely — other countries/ocean, no boundary loaded — so they correctly get nothing.)

## 🔧 Fix design for the next session (a mini-slice; PR → Codex → CI → deploy → re-run)
1. **New table `place_boundary_cells`** (migration `0016`): `id`, `place_id` FK→`place_boundaries`
   `ON DELETE CASCADE`, `geom geometry(Geometry,4326)` **GIST-indexed**, `index on place_id`.
   Populate with `ST_Subdivide(pb.boundary::geometry, 128)` per boundary. (~250k rows for LU+US.)
2. **Rebuild cells when boundaries change** — in the boundary-load path (delete+reinsert cells for
   the loaded scope, or full rebuild; the ~197s subdivide is fine at load time). Cells are unchanged
   by a user add, so the single-fountain path just reads existing cells.
3. **Rewrite `refresh_all_memberships` assignment to PIP against cells** (join fountains → cells →
   `place_boundaries` by `place_id`), keep the §11.5 ladder (eligible subtypes, priority
   `locality`>`localadmin`>`county`, smallest-area tie via `DISTINCT ON (fountain) ORDER BY priority
   DESC, ST_Area ASC`). Test PIP in **geometry** space (`ST_Covers(cell.geom, f.location::geometry)`)
   — planar containment is correct here and avoids geography overhead.
4. **Replace `_PARENT_SET_SQL` with a `country_code` join** — a city's parent country = the
   `subtype='country'` place with the same `country_code` (every boundary carries `country_code`).
   **No spatial op** — drops the worst PIP entirely and is more correct (no border-crossing edge cases).
5. **Drop `ST_Area(country_boundary)` from the country match `ORDER BY`** (use `overture_id`) in the
   single-fountain `_ASSIGN_SQL` too — countries don't overlap, so the area tie-break is pointless and
   the huge-polygon `ST_Area` is expensive even once (adds latency to every user add today).
6. Consider storing a precomputed `area` column on `place_boundaries` (set at load) so the city
   tie-break never recomputes `ST_Area` — optional; locality areas are cheap.
7. Migration + model + loader + membership rewrite + tests (the existing `tests/test_membership.py`
   uses small polygons and validates correctness of whatever SQL structure). Then **deploy** and
   **re-run the backfill** (`osm-boundary-load.yml` LU, `dry_run=false`) — it should complete in well
   under a minute now.

## 🟢 Prod state is CLEAN (safe to leave)
The whole `refresh_all_memberships` runs in ONE transaction (advisory-locked, committed only at the
end). It was still on the first statement, so canceling the workflow + `pg_terminate_backend` the
query rolled it back **atomically**. Verified: `active_refresh=0`, `advisory_locks=0`, fountains
`country_place_id`/`city_place_id` = **NULL** for all 49,891 (unchanged from before), boundaries
intact (**35,130** = LU 114 + US 35,016). **No data lost, lock released, nothing half-written.**

⚠️ The **deployed** backend runs the SLOW membership code, but only the SINGLE-fountain path fires on
the live app (user add / admin edit) — one point-in-polygon, ~sub-second, fine. **Do NOT dispatch
`osm-boundary-load.yml` or `membership_cli` again until the `ST_Subdivide` fix ships** — a full
refresh would re-trigger the 40+ min lock-holding query. (The public place routes don't exist yet —
Slice 2+ — so nothing user-facing depends on membership being populated right now.)

## 🛠️ Repro / measurement commands (kubectl, prod, read-only)
Context is `do-sfo3-fountainrank-production-cluster` (verify with `kubectl config current-context`).
Backend pod: `kubectl -n fountainrank get pods -l app=fountainrank-backend`. Measurements were run by
`kubectl -n fountainrank exec <pod> -- python -c "<asyncio + app.db.get_sessionmaker + text(SQL)>"`
with `set statement_timeout='…'` guards. Use `EXPLAIN` (no ANALYZE) for instant plans;
`ST_NPoints(boundary::geometry)` for polygon sizes.
