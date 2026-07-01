# Runbook — OSM / Protomaps fountain import

Operational guide for importing OpenStreetMap drinking-water locations into FountainRank.

- **Design:** `docs/specs/2026-06-21-osm-fountain-ingestion-design.md` (Codex Loop A approved).
- **Importer:** `backend/app/imports/` (`osm.py` parser, `merge.py` merge service, `cli.py` entry).
- **No secrets in this doc.** Reference env var names only; never paste credentials or signed URLs.

Imported rows are first-class `fountains` with `created_source = 'osm'` and a **null owner**.
They award no contribution/gamification credit, render as standard unrated pins, and are
rateable like any fountain. OSM provenance lives in `fountain_provenances` (separable for
ODbL); `source_tags` is **internal/admin-only** until a display surface filters it.

## Prerequisites

- A GeoJSON extract with **stable OSM feature ids** (`node/…`, `way/…`, `relation/…`) — e.g. a
  Geofabrik/PBF regional extract converted to GeoJSON, or an Overpass GeoJSON response.
  PMTiles/tile inspection is diagnostic-only (it does not carry stable ids).
- Start **bounded** (a launch region / state / country), not the whole planet.
- A reachable database (`DATABASE_URL`). The importer uses the same config as the backend.

## PBF mode — large-scale imports (state → country → continent)

For anything bigger than a metro, use **Geofabrik `.osm.pbf` extracts** via the
`osm-import-pbf.yml` workflow, not Overpass. Overpass (the `osm-import.yml` workflow) caps the bbox
at 6°/side and times out on large extents; the PBF path scales and derives an **exact scope
boundary** from the extract polygon. Both paths feed the same importer, provenance, dedup, and
scope-limited-removal engine (§4–§6 below apply unchanged).

**Region registry — the one-owner control (`.github/osm-import-regions.yml`).** Exactly one
`active` row may own a given area. Both workflows validate their dispatched inputs against it
**before any download**; unknown, retired, or aggregate scopes fail closed. Each row is
`{ key, scope_id, dataset, source: pbf|overpass, status: active|retired }`:

- `source: pbf` — `key` is the Geofabrik path (e.g. `north-america/us/california`). Validated as the
  exact `(key, scope_id, dataset)` triple.
- `source: overpass` — `key` is the canonical bbox `"S,W,N,E"`. Validated as `(scope_id, dataset)`
  and the dispatched bbox must equal the registry bbox; the Overpass workflow derives a fail-closed
  `scope_bounds` rectangle from it.

**Adding a scope:** open a PR adding an `active` row (per-state / per-country, never an aggregate
like `us-latest` that would overlap sub-scopes). To stop importing a scope, set its `status` to
`retired` (rejected for both dry-run and apply). Never leave two `active` rows owning overlapping
areas.

**`scope_bounds` is mandatory and fail-closed (PBF).** The workflow converts the extract `.poly` to
a WKT `MULTIPOLYGON` (`backend/app/imports/poly_to_wkt.py`), validates it in a `postgis/postgis`
service container (`ST_IsValid` + a half-Earth area sanity check), and passes it to the importer
with `--require-scope-bounds`. There is **no bbox / removal-disabled fallback**: without a validated
polygon the run fails before touching the cluster (a missing `scope_bounds` would otherwise broaden
removal to the whole `scope_id` with no spatial guard).

**Dispatch (dry-run first, always):**

```
gh workflow run osm-import-pbf.yml \
  -f geofabrik_path=north-america/us/california \
  -f scope_id=geofabrik:us/california \
  -f dataset=geofabrik:us/california \
  -f label="California" \
  -f dry_run=true
```

Review the dry-run summary (candidate / insert / match / skip / removal counts) as in §1, then
re-dispatch with `-f dry_run=false`. The workflow runs Class B on `ubuntu-latest`, gates on the
`production` environment, size/disk-preflights the download, verifies the Geofabrik `.md5`
(transport integrity only — the PBF stays untrusted), and sets `source_build_id` from the extract's
data timestamp (`osmium fileinfo`), never the wall clock.

**San Diego bootstrap → California.** The original `us/ca/san-diego` Overpass scope is **retired** in
the registry (it can no longer be dispatched). The first California PBF apply **re-owns** those rows
automatically — the provenance ids (`osm:<type>:<id>`) match, so their `scope_id` is rewritten to
`geofabrik:us/california`. After that, refresh San Diego only via the California scope.

### Worldwide rollout (#131)

Roll the pipeline out to the world by importing **per-country/region** scopes, **smaller-first**.
Each is an `active` `source: pbf` row in `.github/osm-import-regions.yml`; to expand coverage, append
rows and dispatch — the workflow reads the registry from its checkout, so a **merge to `main` is
enough (no deploy)** and the importer image is already deployed.

Per scope: **dry-run first**, check the summary against these **anomaly gates** (pause + investigate,
don't apply, if any trips), then apply, then live-verify:

- workflow step failure — a 404 (wrong Geofabrik path), a `.poly`/`ST_Area` validation fail
  (often an **antimeridian**-crossing extract — excluded on purpose), or a size/disk/md5 failure;
- `candidate_count == 0` — likely a wrong path or filter;
- on a **refresh**, a `removed_count` out of proportion to prior candidates.

**Antimeridian:** do not register extracts whose `.poly` crosses ±180° (Fiji, NZ Chathams, far-east
Russia) — `poly_to_wkt.py`'s planar orientation + the PostGIS half-Earth `ST_Area` guard fail closed
on them. Split further or handle specially instead.

**Live-verify** one city per continent after its apply, via
`GET https://api.fountainrank.com/api/v1/fountains/bbox?min_lat=&min_lng=&max_lat=&max_lng=`
(San Diego/SF for N. America, Monaco for Europe, Singapore/Seoul for Asia, Nairobi for Africa,
Montevideo for S. America, Nouméa/Sydney for Oceania).

## 1. Dry-run first (no production mutation)

```
cd backend
python -m app.imports.cli --path <extract>.geojson \
  --scope-id <region-key> --dataset <dataset-id> --build-id <extract-checksum-or-date> \
  --label "<human label>" --dry-run
```

A dry-run writes an `osm_fountain_import_runs` row (`dry_run = true`) and
`osm_fountain_import_candidates` rows recording the computed `action` /
`skip_reason` / `matched_fountain_id` for every feature — but makes **zero** changes to
`fountains`, `fountain_provenances`, or `fountain_import_events`. The stdout JSON summary
reports would-insert / would-match / skipped counts.

Inspect the candidate decisions:

```sql
SELECT action, skip_reason, count(*)
FROM osm_fountain_import_candidates
WHERE run_id = '<run-id-from-summary>'
GROUP BY action, skip_reason ORDER BY count(*) DESC;
```

Look for unexpected `skip_reason`s (`not_potable_signal`, `not_public`, `lifecycle_inactive`,
`invalid_coordinates`, `no_usable_geometry`) and a sane insert/match split.

## 2. Apply (staging/dev first)

Drop `--dry-run`. Then verify the public surfaces behave:

- `GET /api/v1/fountains/bbox?…` and `…/fountains?lat=&lng=` return the imported pins.
- `GET /api/v1/fountains/{id}` shows "Not yet rated".
- Adding a fountain within `duplicate_threshold_m` of an import returns `409`
  `{ "detail": "duplicate_fountain", "fountain_id": … }` (the add→verify hook).
- A rating on an imported fountain succeeds and the first rater is credited.

## 3. Production apply

Run the same command (no `--dry-run`) from the operator/CI path — **never** a public endpoint.
Secrets come from the environment and are never logged. Promote through the normal
branch → PR → CI → Codex flow for any code change; the import run itself is an operator action.

## 4. Refresh (repeatable)

Re-running the same `--scope-id` is **idempotent**: unchanged features cause no churn (only
provenance `last_seen_at` freshness advances). Small location moves of imported-only, unrated
rows auto-update (≤ `OSM_MOVE_SMALL_MAX_M`); larger moves are review-flagged, never silently
applied; user-created or rated rows are never auto-moved.

**Scope-limited removal:** a feature absent from a refresh of scope X is marked
`fountain_provenances.removed_at` **only** within that same `source_system` + `scope_id`
(and `scope_bounds` if set). A region-A refresh never marks region-B provenance removed.
`removed_at` does **not** hide the fountain — removal-from-source ≠ hidden.

## 5. Audit

```sql
-- run summary
SELECT * FROM osm_fountain_import_runs ORDER BY started_at DESC LIMIT 10;
-- per-row production effects of a run
SELECT operation, count(*) FROM fountain_import_events
WHERE run_id = '<run-id>' GROUP BY operation;
```

## 6. Rollback a bad run

```python
# backend, async session:
from app.imports.merge import rollback_run
await rollback_run(session, run_id)   # then commit
```

Rollback is lock-protected (shares the add advisory lock, `FOR UPDATE`s affected rows) and
**never deletes user rows or ratings**. It reverses a run's durable events:

- `insert` → the imported fountain is **hidden** (`is_hidden = true`), not deleted (preserves
  any ratings users added to it).
- `update_location` → restores the prior coordinates.
- `provenance_attach` → detaches the OSM provenance from a user-created fountain, leaving the
  user row untouched.
- `provenance_update` → restores prior tags/confidence/scope/removed_at.
- `mark_removed` → clears `removed_at`.

Freshness bookkeeping (`last_seen_at`, `last_import_run_id`) is intentionally not rolled back.

## Deferred (not in the first import)

Mapping OSM tags → first-class structured attributes / access / operational status (#38/#40/#42)
is a separate follow-up that consumes the preserved `source_tags` as lowest-precedence,
non-user seed values that crowd consensus always overrides. See design spec §4.3.
