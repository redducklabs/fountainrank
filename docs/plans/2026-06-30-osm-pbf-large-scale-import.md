# OSM PBF Large-Scale Import — Implementation Plan (issue #48)

**Date:** 2026-06-30
**Spec:** `docs/specs/2026-06-21-osm-pbf-large-scale-import-design.md` (Codex Loop A **APPROVED**).
**Parent spec:** `docs/specs/2026-06-21-osm-fountain-ingestion-design.md`.
**Issue:** #48 (prerequisite for #131 worldwide rollout).
**Status:** Draft — Codex Loop A (plan) round 2. R1 findings addressed inline (see "R1 resolutions").

This plan turns the approved design's §7 outline into bite-sized, testable tasks. It designs
**only the source side** (Geofabrik `.osm.pbf` + `osmium` → the shipped importer). The merge,
provenance, scope-limited removal, dry-run, and rollback code
(`backend/app/imports/{osm,merge,cli}.py`, `docs/runbooks/osm-fountain-import.md`) already ship and
are **not modified** except two additive, backward-compatible CLI flags (Task 4). California
production validation is post-merge (Task 9) and is gated by the user "checkpoint at California"
decision.

### R1 resolutions (Codex plan-review-1)

- **[MAJOR] Overpass registry binding** → the registry now **binds the bbox to the scope**: an
  overpass row's `key` is its canonical bbox; both workflows validate the *full* active row, the
  dispatched bbox must numerically equal the registry bbox, and the Overpass path now **derives a
  `scope_bounds` rectangle from that bbox** and passes it fail-closed. No more "any bbox under a
  valid scope." (Tasks 3, 5.)
- **[MAJOR] San Diego / no overlap window** → the committed registry ships `us/ca/san-diego` as
  **`status: retired`** in the *same* PR that adds California `active`. Never two active owners of an
  overlapping area on `main`; retired rows are rejected for both dry-run and apply. (Task 3, Task 9.)
- **[MAJOR] Real-osmium proof pre-merge** → a dedicated PR-triggered CI job installs `osmium-tool`
  and runs the normalizer on **real `osmium export -u type_id` output** generated from a committed
  tiny source, recording relation/area counts. Hand-authored cases remain for fast local runs.
  (Task 1, Task 1b.)
- **[MAJOR] `source_build_id`** → derived from the **original downloaded** `.osm.pbf` (not
  `filtered.pbf`), from a named header with an explicit fallback chain and **fail-closed** if
  absent. (Task 6.)
- **[MINOR] Preflight** → concrete cap + multiplier + headroom + work-disk. (Task 6.)
- **[MINOR] Fail-closed guard** → new CLI flag `--require-scope-bounds` makes the importer **refuse
  a non-dry-run without a non-empty validated WKT**; both workflows pass it. Executable, not prose.
  (Task 4, Tasks 5–6.)
- **[MINOR] Antimeridian** → explicitly scoped out for the planar-orientation step; the PostGIS
  `ST_Area` guard is the fail-closed backstop; #131 revisits Oceania/Asia. (Task 2.)
- **[NIT] PyYAML** → added as an **explicit** backend dependency (locked), and the workflows install
  it **pinned** (no floating install). (Task 3, Tasks 5–6.)

---

## Guiding constraints (do not violate)

- **`scope_bounds` is mandatory and fail-closed** on every non-dry-run import (both paths). Passing
  *no* `scope_bounds` does **not** disable removal — `merge._mark_scope_removals` then broadens
  removal to the entire `scope_id` with **no spatial guard** (verified `merge.py:135-143,307-333`).
  So a valid polygon is a hard precondition, enforced both in the workflow (validate before cluster
  access) and at the importer boundary (`--require-scope-bounds`). No bbox/removal-disabled fallback.
- **One canonical scope owns each area**, enforced by the committed registry
  `.github/osm-import-regions.yml`. Both workflows reject unknown / retired / aggregate inputs
  *before any download*, and the registry binds each scope's exact geographic extent.
- **Idempotent + dry-run default true.** Re-running a scope causes no churn (only provenance
  freshness advances).
- **PBF is untrusted input.** md5 is transport/corruption only (same-origin HTTPS), never trust.
- **No new backend settings** (keeps `test_config` default assertions intact). PyYAML is a new
  dependency, not a setting. **No AI attribution**, **no time estimates**, structured logging only,
  secrets/URLs never logged.
- **Runner policy:** the PBF workflow is Class B (cloud creds) → `ubuntu-latest`. The
  normalizer-check CI job is Class A **but** needs the `osmium-tool` apt package (absent from the
  self-hosted fleet) and handles **no secrets**, so it runs on `ubuntu-latest` — an explicit,
  documented exception (blast radius nil).

---

## Component overview

New files:

| File | Purpose | Deps |
|---|---|---|
| `backend/app/imports/osmium_geojson.py` | Decode osmium `-u type_id` ids (`n`/`w`/`a` + area parity) → canonical `type/id` GeoJSON; dedup by geometry priority. | stdlib only |
| `backend/app/imports/poly_to_wkt.py` | Geofabrik `.poly` → WKT `MULTIPOLYGON` (orientation-normalized, rings closed). | stdlib only |
| `backend/app/imports/regions.py` | Load + validate `.github/osm-import-regions.yml`; enforce one-owner (pbf: full triple; overpass: scope+dataset+numeric-bbox equality). | PyYAML (CLI); pure fns stdlib |
| `.github/osm-import-regions.yml` | The canonical region registry. | — |
| `.github/workflows/osm-import-pbf.yml` | The PBF import workflow (Class B). | osmium-tool, doctl, postgis service |
| `.github/workflows/osm-normalizer-check.yml` | PR-triggered real-osmium normalizer gate (Class A, no secrets, ubuntu-latest). | osmium-tool |
| `backend/tests/test_osmium_geojson.py` | Normalizer unit tests (hand-authored, no osmium). | pytest |
| `backend/tests/test_osmium_geojson_real.py` | Real-osmium test (skipif no osmium; run by the check job). | pytest, osmium |
| `backend/tests/test_poly_to_wkt.py` | `.poly`→WKT unit + PostGIS integration tests. | pytest |
| `backend/tests/test_regions.py` | Registry validation unit tests. | pytest |
| `backend/tests/fixtures/osmium_source.opl` | Tiny OPL source the check job feeds to `osmium export`. | — |
| `backend/tests/fixtures/osmium_export_sample.geojson` | Hand-authored osmium-scheme sample (documented). | — |
| `backend/tests/fixtures/california_sample.poly` | Small `.poly` fixture (multi-ring + hole). | — |

Modified files:

| File | Change |
|---|---|
| `backend/app/imports/cli.py` | Add `--scope-bounds-wkt-file` (ARG_MAX-safe) and `--require-scope-bounds` (fail-closed guard). Both additive; existing behavior unchanged. |
| `backend/pyproject.toml` + `backend/uv.lock` | Add explicit `pyyaml` dependency (already resolved transitively; make it direct + locked). |
| `.github/workflows/osm-import.yml` | Add full registry validation (reject unknown/retired), derive `scope_bounds` rectangle from the registry bbox, pass `--scope-bounds-wkt` + `--require-scope-bounds`. |
| `docs/runbooks/osm-fountain-import.md` | Add PBF mode, registry, one-owner rule + San Diego retirement, refresh, rollback. |

---

## Task 1 — `osmium_geojson.py` normalizer + hand-authored tests

**Goal.** Convert `osmium export -u type_id -f geojson` output to the importer's canonical GeoJSON
(`feature.id == "<type>/<id>"`, the exact form `osm._parse_feature_id` accepts), decoding the
osmium id scheme and deduping to one feature per OSM object.

**Approach** (sibling of `overpass.py`, stdlib-only, `main(argv)` CLI printing the feature count):

1. Read the input as a GeoJSON FeatureCollection (`osmium export -f geojson`). The *output* set is
   only drinking-water features (post coarse-filter) — small — so full `json.load` is safe.
2. Decode each `feature.id` string:
   - `n<id>` → `("node", id)`
   - `w<id>` → `("way", id)`
   - `a<id>` → **area parity**: `id` even → `("way", id // 2)`; `id` odd → `("relation", (id - 1) // 2)`.
   - Anything else (missing/malformed) → skip, count as `unparseable`, emit to stderr (never crash).
3. Re-emit `feature = {type, id: "<type>/<id>", properties, geometry}` unchanged otherwise (the
   shipped parser handles Point and reduces Polygon/MultiPolygon/LineString to centroid).
4. **Dedup by normalized `(type, id)`**, keeping one feature deterministically:
   - geometry-type priority **Polygon/MultiPolygon (3) > Point (2) > LineString/MultiLineString (1) >
     other (0)**;
   - tie-break by **lowest original osmium id string** (stable, input-order-independent) — the merge
     can move imported unrated rows on small geometry shifts, so non-determinism would cause churn.
5. Return a FeatureCollection + a stats dict (`nodes`, `ways`, `relations`, `areas`, `deduped`,
   `unparseable`). The CLI prints feature count to stdout (the workflow's machine-readable result)
   and stats to stderr (so the workflow records relation/area counts per spec §3).

**Hand-authored tests** (`test_osmium_geojson.py`, mirroring `test_overpass.py`, no osmium) using
`fixtures/osmium_export_sample.geojson` matching osmium's documented `-u type_id` scheme:
- node `n123` → `node/123` (Point preserved); way-as-area `a246` → `way/123`; relation-area `a247` →
  `relation/123`.
- a closed way emitted as **both** `w500` (LineString) and `a1000` (Polygon) → **one** `way/500`,
  Polygon kept (priority).
- tie-break + input-order independence (shuffle → identical output).
- malformed id (`x9`, missing id) → skipped/counted, no crash; valid features still emitted.
- empty collection → empty collection.

**Done:** `pytest backend/tests/test_osmium_geojson.py` green; ruff clean.

## Task 1b — Real-osmium normalizer gate (CI)

**Goal.** Prove the normalizer against **real** `osmium export -u type_id` output *before merge*
(spec §9), since the dev host has no osmium.

- `fixtures/osmium_source.opl` — a tiny hand-written OPL (OSM text format) with: a `drinking_water`
  node; an open way; a **closed way** tagged as an area (`amenity=drinking_water`, `area=yes`); and a
  small multipolygon **relation** — chosen so `osmium export -u type_id` emits `n`, `w`, `a<even>`
  (way-area), and `a<odd>` (relation-area) features.
- `test_osmium_geojson_real.py` — `@pytest.mark.skipif(shutil.which("osmium") is None)`: runs
  `osmium export -u type_id -f geojson` on the OPL (via `osmium add-locations-to-ways` first if
  needed for way/area geometries), feeds the output through `osmium_geojson`, and asserts the
  decoded ids/types + dedup + that relation/area counts are non-zero (records them).
- `.github/workflows/osm-normalizer-check.yml` — `on: pull_request` (paths:
  `backend/app/imports/**`, `backend/tests/**`, the workflow itself), `runs-on: ubuntu-latest`,
  `permissions: contents: read`, no secrets. Steps: checkout → `apt-get install -y osmium-tool` →
  `osmium --version` (fail the job if missing, so the real test can never silently skip here) →
  `uv`-run the real test. This is the standing pre-merge real-osmium gate.

> **Runner rationale (documented deviation):** Class A normally runs on `redducklabs-runners`, but
> this job needs the `osmium-tool` apt package (not on the fleet) and handles **no secrets**, so
> `ubuntu-latest` is the explicit choice. Recorded here per the "explicit decision" rule in
> `claude_help/testing-ci.md`.

**Done:** the check job is green on the PR and demonstrably *ran* (not skipped) the real-osmium test.

---

## Task 2 — `poly_to_wkt.py` (`.poly` → validated WKT `MULTIPOLYGON`) + tests

**Goal.** Convert a Geofabrik `.poly` (Osmosis polygon-filter format) to a WKT `MULTIPOLYGON`
suitable for `ST_GeogFromText`, so the workflow can PostGIS-validate it and pass it as
`scope_bounds`.

**`.poly` format** (parsed, stdlib-only): a file-name line; then one or more polygon sections, each
a section-name line (a leading `!` marks a hole/inner ring), `lon lat` coordinate lines, then `END`;
a final `END` terminates the file. Non-`!` sections are separate outer rings; each `!` section is a
hole associated with the preceding outer ring.

**Approach:**
1. Parse sections into outer rings + holes.
2. Ensure each ring is **closed** (append the first point if needed).
3. **Normalize orientation for geography**: exterior rings **counter-clockwise**, holes
   **clockwise** (compute planar signed area; reverse when wrong). Prevents PostGIS `geography`
   interpreting an inverted ring as "almost the whole globe" (a real `ST_Covers` trap). WKT axis
   order is `lon lat`.
4. Emit `MULTIPOLYGON(((lon lat, …)),( (outer),(hole) ), …)`.
5. `main(argv)`: `python3 backend/app/imports/poly_to_wkt.py in.poly out.wkt`; ring/hole counts to
   stderr. Fail closed (non-zero exit) on any parse error.

**Antimeridian / >hemisphere scope (MINOR 7).** The planar signed-area orientation is correct for
regional extracts that do **not** cross the antimeridian (California, and essentially all Geofabrik
country/state extracts). Antimeridian-crossing single polygons (e.g. Fiji, far-east Russia) are
**out of scope** for #48; the pipeline relies on Geofabrik's per-subregion splits, and the PostGIS
`ST_Area < half-Earth` guard (below) **fails closed** on any inverted/degenerate polygon rather than
silently importing a near-global scope. #131 will explicitly verify an Oceania and an Asia region
and, if a `.poly` crosses the antimeridian and fails the area guard, split it further.

**PostGIS validation** runs in the workflow (Task 6) against a `postgis/postgis:17-3.5` service
container (matches deployed PostGIS major and the exact `ST_GeogFromText`/`ST_Covers` behavior).
Fail-closed query:
```sql
SELECT ST_IsValid(g::geometry) AND ST_Area(g) > 0 AND ST_Area(g) < 2.55e14
FROM (SELECT ST_GeogFromText(:wkt) AS g) s;
```
`2.55e14 m²` ≈ half Earth's surface — an inverted polygon yields a near-global area and fails. A
`false`/error fails the run before any cluster access.

**Unit tests** (`test_poly_to_wkt.py`) on `fixtures/california_sample.poly` (small, multi-ring +
hole): single outer ring → one closed polygon `lon lat`; outer+hole → two rings (ext CCW, hole CW);
two outer rings → two polygons; unclosed input → closed output; CW input outer → reversed to CCW;
malformed `.poly` → raises/non-zero exit.

**PostGIS integration test** (in `test_poly_to_wkt.py`, `@pytest.mark.asyncio`, existing `session`
fixture against the CI `postgis/postgis:17-3.5` DB on 5436) — exercises the **exact**
`ST_GeogFromText`/`ST_Covers` behavior in CI, not only at dispatch:
- `ST_IsValid(ST_GeogFromText(wkt)::geometry)` true;
- `ST_Area` `> 0` and `< 2.55e14`;
- `ST_Covers(geog, <point inside>)` true; `ST_Covers(geog, <point outside / in the hole>)` false.

**Done:** `pytest backend/tests/test_poly_to_wkt.py` green (incl. PostGIS integration); ruff clean.

---

## Task 3 — Region registry + `regions.py` validator + tests

**Goal.** A committed machine-readable registry and a validator both workflows call *before
download* to enforce the one-owner rule, with each scope's geographic extent bound in the registry.

**PyYAML dependency (NIT 8).** Add `pyyaml` to `backend/pyproject.toml` `dependencies` and re-lock
(`uv lock`) — it is already resolved transitively; making it direct removes the fragile reliance.
The workflows install it **pinned** (`pip install "pyyaml==6.0.3"`), never floating.

**`.github/osm-import-regions.yml`** schema:
```yaml
# Canonical OSM import scopes. Exactly one ACTIVE row may own a given area.
# source: pbf      -> key is a Geofabrik path; validated as (key, scope_id, dataset), all exact.
# source: overpass -> key is the canonical bbox "S,W,N,E"; validated as (scope_id, dataset) exact
#                     AND the dispatched bbox must equal key numerically; scope_bounds is derived
#                     from key. (bbox is still independently range/order/<=6deg sanitized.)
# status: active | retired   (retired rows are rejected for BOTH dry-run and apply; aggregate paths
#                             are simply absent -> unknown -> rejected)
regions:
  - key: "32.5342,-117.611,33.5052,-116.0846"   # canonical San Diego bbox (documentation only once retired)
    scope_id: us/ca/san-diego
    dataset: overpass:san-diego
    source: overpass
    status: retired          # superseded by California PBF; blocked from re-dispatch (no overlap window)
  - key: north-america/us/california
    scope_id: geofabrik:us/california
    dataset: geofabrik:us/california
    source: pbf
    status: active
```

**`backend/app/imports/regions.py`:**
- Pure `validate_region(rows, *, source, scope_id, dataset, key=None, bbox=None) -> dict` — raises
  `RegionValidationError` unless **exactly one** row matches AND is `status == "active"`:
  - `source == "pbf"`: match `(key, scope_id, dataset, source="pbf")` exactly.
  - `source == "overpass"`: match `(scope_id, dataset, source="overpass")` exactly, **and** the
    dispatched `bbox` (4 floats) must equal the row's `key` bbox (4 floats) numerically. Returns the
    row so the workflow can derive `scope_bounds` from `key`.
  - A match that exists but is `retired` → distinct "retired" error. Zero matches → "unknown". Two
    active matches → "ambiguous" (registry authoring error).
- `bbox_to_rectangle_wkt(bbox) -> str` helper: `POLYGON((W S, E S, E N, W N, W S))` (CCW),
  reused by the Overpass workflow to build a fail-closed rectangle `scope_bounds`.
- `main(argv)`: `python -m app.imports.regions --registry <path> --source <pbf|overpass> [--key …]
  --scope-id … --dataset … [--bbox …] [--emit-scope-bounds-wkt <out>]` — `yaml.safe_load`s the
  registry, validates, and (overpass) writes the derived rectangle WKT. Non-zero + `::error::` on
  failure.

**Tests** (`test_regions.py`, pure-dict, no yaml):
- pbf full-triple match on active row → ok; wrong key/scope/dataset → raises.
- retired row → raises (distinct message); aggregate/absent path → "unknown".
- overpass `(scope_id, dataset)` + equal bbox → ok; mismatched bbox → raises; wrong dataset →
  raises.
- two active rows same triple → "ambiguous".
- `bbox_to_rectangle_wkt` shape/orientation; numeric bbox equality treats `32.5` == `32.50`.
- a tiny test `yaml.safe_load`s the real committed registry and asserts required keys + that no two
  active rows share a `scope_id`.

**Done:** `pytest backend/tests/test_regions.py` green; ruff clean.

---

## Task 4 — CLI flags: `--scope-bounds-wkt-file` + `--require-scope-bounds`

**Goal.** (a) large-polygon safety, (b) an executable fail-closed guard at the importer boundary.

**Changes** (`cli.py`, both additive):
- `--scope-bounds-wkt-file`: read WKT from a file; error if combined with `--scope-bounds-wkt`.
  Avoids `kubectl exec` ARG_MAX for continent/country polygons.
- `--require-scope-bounds`: if set and **not** `--dry-run`, the CLI **raises before any DB write**
  when the resolved `scope_bounds` WKT is `None`/empty/whitespace. This makes the fail-closed
  guarantee executable at the boundary (`merge` accepts `None` and broadens removal — the guard
  stops that path). Existing callers/tests that pass neither flag are unaffected.

**Tests** (extend `test_osm_cli.py`): file-based WKT loads and stores `scope_bounds` (non-null);
both WKT flags → `ValueError` pre-write; `--require-scope-bounds` + not dry-run + empty/missing WKT →
`ValueError` pre-write (assert zero `OsmImportRun` rows); `--require-scope-bounds` + `--dry-run` +
no WKT → allowed (dry-run never removes).

**Done:** `pytest backend/tests/test_osm_cli.py` green.

---

## Task 5 — Registry validation + fail-closed `scope_bounds` in `osm-import.yml`

**Goal.** Close the overlap hole on the Overpass path (spec §4: *both* workflows validate) and give
that path the same fail-closed spatial guard.

**Changes** (before "Fetch Overpass extract"):
1. Keep the existing bbox sanitizer (range/order/≤6°, reconstruct).
2. `pip install "pyyaml==6.0.3"`; run `python -m app.imports.regions --registry
   .github/osm-import-regions.yml --source overpass --scope-id "$SCOPE_ID" --dataset "$DATASET"
   --bbox "$BBOX" --emit-scope-bounds-wkt scope.wkt` → fails before fetch on unknown/retired/mismatch.
3. Stream both `import.geojson` and `scope.wkt` into the pod; run the importer with
   `--scope-bounds-wkt-file /tmp/scope.wkt --require-scope-bounds` (and `--dry-run` when requested).

**Done:** the Overpass path is registry-bound (bbox == registry bbox) and always passes a fail-closed
rectangle `scope_bounds`. Validated by the shared `regions.py` unit tests + workflow ordering.

---

## Task 6 — `.github/workflows/osm-import-pbf.yml`

**Goal.** The PBF import workflow, mirroring `osm-import.yml`'s security discipline.

**Inputs:** `geofabrik_path`, `scope_id`, `dataset`, `label`, `dry_run` (boolean, default **true**).
**`concurrency`:** group `osm-import-production`, `cancel-in-progress: false` (serialize with the
Overpass path — same prod DB). **Permissions:** `contents: read`. **`environment: production`**,
**`runs-on: ubuntu-latest`** (Class B). **Services:** `postgis/postgis:17-3.5` (for `.poly` WKT
validation).

**Steps:**
1. `actions/checkout@v7`.
2. **Registry-validate + syntax-check** `(geofabrik_path, scope_id, dataset)`: `pip install
   "pyyaml==6.0.3"`; `python -m app.imports.regions --source pbf --key "$GEOFABRIK_PATH"
   --scope-id "$SCOPE_ID" --dataset "$DATASET" …`; then syntax-check `geofabrik_path` against
   `^[a-z0-9-]+(/[a-z0-9-]+)*$` (reject `..`, newlines, control chars — reject-newline/reconstruct
   discipline). Fail before anything else.
3. `sudo apt-get update && sudo apt-get install -y osmium-tool`.
4. **Preflight + download** (concrete, MINOR 5). Work under `WORKDIR="$RUNNER_TEMP/osm"` (check its
   free space; note very large extents may need `/mnt`). Env `MAX_EXTRACT_MB: 6000`. HEAD the
   `.osm.pbf`; `LEN_MB = ceil(Content-Length/1MiB)`; abort if `LEN_MB > MAX_EXTRACT_MB`; require free
   MiB on `WORKDIR` `>= LEN_MB*12 + 3000` (pbf + filtered + osmium index/temp + output + headroom);
   abort otherwise. Download `…-latest.osm.pbf`, `…-latest.osm.pbf.md5`, and `.poly`
   (`https://download.geofabrik.de/<path>.poly`) with a descriptive UA. Verify md5 (transport;
   fail-closed).
5. **Coarse filter:** `osmium tags-filter in.pbf -o filtered.pbf nwr/amenity=drinking_water,fountain
   nwr/man_made=water_tap`.
6. **Export:** `osmium export filtered.pbf -u type_id -f geojson -o osmium.geojson` (disk-backed node
   index for large inputs; parametrized).
7. **Normalize:** `python3 backend/app/imports/osmium_geojson.py osmium.geojson import.geojson`
   (echo feature + relation/area counts). Fail if 0 features.
8. **scope_bounds (mandatory, fail-closed):** `python3 backend/app/imports/poly_to_wkt.py <path>.poly
   scope.wkt`; validate against the postgis service with the Task-2 query; **fail** if it can't be
   derived/validated. Assert `test -s scope.wkt`. No fallback.
9. **`source_build_id`** from the **original** `.osm.pbf` (MAJOR 4): `TS=$(osmium fileinfo -e -g
   header.option.timestamp in.pbf)`; if empty, fall back to `-g header.option.osmosis_replication_
   timestamp`; if still empty → **fail** (never `date`). Guard non-empty + non-URL.
10. `digitalocean/action-doctl@v2.5.2` + `doctl kubernetes cluster kubeconfig save "$CLUSTER_NAME"`.
11. Find the Running backend pod; stream `import.geojson` **and** `scope.wkt` into `/tmp` via
    `kubectl exec -i`; assert `test -s /tmp/scope.wkt`; run:
    ```
    python -m app.imports.cli --path /tmp/osm-import.geojson \
      --scope-id "$SCOPE_ID" --dataset "$DATASET" --build-id "$BUILD_ID" \
      --label "$LABEL" --scope-bounds-wkt-file /tmp/scope.wkt --require-scope-bounds $DRY
    ```
    (`$DRY = --dry-run` when `dry_run == true`). Clean up `/tmp`. Read kubeconfig + pod exec only —
    **no cluster-state mutation**.

**Env:** `CLUSTER_NAME: fountainrank-production-cluster`, `NAMESPACE: fountainrank`.

**Done:** workflow present, `workflow_dispatch`, dry_run default true, mandatory + executable
scope_bounds, registry-gated, size-preflighted, md5-checked, source_build_id from original extract.

---

## Task 7 — Runbook: PBF mode

**Change** (`docs/runbooks/osm-fountain-import.md`): add **PBF mode** (dispatch `gh workflow run
osm-import-pbf.yml -f geofabrik_path=… -f scope_id=… -f dataset=… -f label=… -f dry_run=true`), the
**region registry** (how to add a scope, the one-owner rule, retired rows), the **San Diego bbox
retirement** (already retired in the registry; California re-owns its rows on first apply),
**refresh**, and **rollback** (unchanged mechanics). Secret-free.

**Done:** runbook covers dispatch, registry edits, retirement, refresh, rollback for PBF.

---

## Task 8 — Local CI mirror + PR + Codex PR loop + merge

1. `./run.ps1 check` fully green (backend ruff/format/alembic/pytest — `uv lock` change verified;
   run the full mirror per policy).
2. Commit (Conventional Commits, no AI attribution), push `feat/48-osm-pbf-large-scale-import`.
3. Open PR referencing #48; get CI green — including the new `osm-normalizer-check` job (real
   osmium).
4. Codex Loop B (PR) → address every finding + any other PR comments → loop to `VERDICT: APPROVED`.
5. Squash-merge.

---

## Task 9 — California production validation (post-merge; **CHECKPOINT**)

The registry already ships San Diego **retired** and California **active** (Task 3), so there is no
overlap window and no separate retirement PR.

1. `gh workflow run osm-import-pbf.yml -f geofabrik_path=north-america/us/california
   -f scope_id=geofabrik:us/california -f dataset=geofabrik:us/california -f label="California"
   -f dry_run=true`; watch; read the CLI JSON summary (expect the ~360 San Diego rows as
   `match_provenance`/`update` re-owned to `geofabrik:us/california`, not fresh inserts).
2. **Post dry-run numbers + go/no-go to the user and WAIT for OK** (the agreed California checkpoint).
3. On approval: re-dispatch `dry_run=false`. Verify live: bbox/nearby/detail over San Diego + one
   more CA metro return imported pins; a rating still works.
4. **Refresh** (re-run apply) → confirm **no churn** (`inserted=0`, `removed=0`; only freshness
   advances) and correct scope-limited removal.

---

## Out of scope / deferred (spec §8)

- Per-scope-observation child table for genuinely overlapping concurrent scopes; scheduled refresh;
  OSM tags → structured attributes/access/status (#38/#42/#43); the worldwide rollout itself (**#131**,
  its own plan).

## Definition of done (maps to spec §9)

Operator-triggered path imports a Geofabrik region through the shipped importer
(coarse-filter → export → id-decode/dedup → pod-exec), idempotently + scope-correctly; osmium id
scheme (incl. area parity) decoded + deduped, **proven pre-merge on real `osmium export` output**;
`scope_bounds` mandatory, extract-polygon derived, PostGIS-validated, fail-closed **and enforced at
the importer boundary**; one-owner policy registry-enforced in **both** workflows with each scope's
extent bound in the registry and San Diego retired (no overlap window); inputs
allow-listed/sanitized, downloads size/disk-preflighted + md5-integrity-checked (integrity, not
trust), `source_build_id` from the original extract; California dry-run→apply verified live with no
refresh churn.
