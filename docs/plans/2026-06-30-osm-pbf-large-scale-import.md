# OSM PBF Large-Scale Import — Implementation Plan (issue #48)

**Date:** 2026-06-30
**Spec:** `docs/specs/2026-06-21-osm-pbf-large-scale-import-design.md` (Codex Loop A **APPROVED**).
**Parent spec:** `docs/specs/2026-06-21-osm-fountain-ingestion-design.md`.
**Issue:** #48 (prerequisite for #131 worldwide rollout).
**Status:** Draft — pending Codex Loop A (plan) approval before implementation.

This plan turns the approved design's §7 outline into bite-sized, testable tasks. It designs
**only the source side** (Geofabrik `.osm.pbf` + `osmium` → the shipped importer). The merge,
provenance, scope-limited removal, dry-run, and rollback code (`backend/app/imports/{osm,merge,
cli}.py`, `docs/runbooks/osm-fountain-import.md`) already ship and are **not modified** except a
single additive CLI flag (Task 4). California production validation is post-merge (Task 9) and is
gated by the user "checkpoint at California" decision.

---

## Guiding constraints (do not violate)

- **`scope_bounds` is mandatory and fail-closed** on every non-dry-run PBF import. Passing *no*
  `scope_bounds` does **not** disable removal — `merge._mark_scope_removals` then broadens removal
  to the entire `scope_id` with **no spatial guard** (verified in `merge.py:135-143,307-315`). So a
  valid, PostGIS-validated extract polygon is a hard precondition; there is **no bbox or
  removal-disabled fallback**.
- **One canonical scope owns each area**, enforced by the committed registry
  `.github/osm-import-regions.yml`. Both workflows reject unknown / retired / aggregate inputs
  *before any download*.
- **Idempotent + dry-run default true.** Nothing writes to `fountains` unless an operator unticks
  dry-run. Re-running a scope causes no churn (only provenance freshness advances).
- **PBF is untrusted input.** md5 is a transport/corruption check only (same-origin HTTPS), never a
  trust boundary. All shipped parser/tag/size sanitization stays in force.
- **No new backend settings** (keeps `test_config` default assertions intact). **No AI
  attribution**, **no time estimates**, structured logging only, secrets/URLs never logged.
- **Runner policy:** the PBF workflow is Class B (handles cloud creds) → `ubuntu-latest`, never the
  shared `redducklabs-runners` fleet. `environment: production`, operator-triggered.

---

## Component overview

New files:

| File | Purpose | Deps |
|---|---|---|
| `backend/app/imports/osmium_geojson.py` | Decode osmium `-u type_id` ids (`n`/`w`/`a` + area parity) → canonical `type/id` GeoJSON; dedup by geometry priority. | stdlib only |
| `backend/app/imports/poly_to_wkt.py` | Geofabrik `.poly` → WKT `MULTIPOLYGON` (orientation-normalized, rings closed). | stdlib only |
| `backend/app/imports/regions.py` | Load + validate `.github/osm-import-regions.yml`; enforce the one-owner triple. | PyYAML (already a dep) for the CLI wrapper; pure fns stdlib |
| `.github/osm-import-regions.yml` | The canonical region registry. | — |
| `.github/workflows/osm-import-pbf.yml` | The PBF import workflow. | osmium-tool, doctl, postgis service |
| `backend/tests/test_osmium_geojson.py` | Normalizer unit tests. | pytest |
| `backend/tests/test_poly_to_wkt.py` | `.poly`→WKT unit tests. | pytest |
| `backend/tests/test_regions.py` | Registry validation unit tests. | pytest |
| `backend/tests/fixtures/osmium_export_sample.geojson` | Faithful osmium-export sample (documented scheme). | — |
| `backend/tests/fixtures/california_sample.poly` | Small `.poly` fixture (multi-ring + hole). | — |

Modified files:

| File | Change |
|---|---|
| `backend/app/imports/cli.py` | Add `--scope-bounds-wkt-file` (mutually exclusive with `--scope-bounds-wkt`) to avoid `kubectl exec` ARG_MAX on large polygons. |
| `.github/workflows/osm-import.yml` | Add registry-validation step for the Overpass path (reject unknown/retired scopes before fetch). |
| `docs/runbooks/osm-fountain-import.md` | Add PBF mode, registry, one-owner rule + San Diego retirement, refresh, rollback. |

---

## Task 1 — `osmium_geojson.py` normalizer + tests

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
   shipped parser handles Point directly and reduces Polygon/MultiPolygon/LineString to centroid).
4. **Dedup by normalized `(type, id)`**, keeping one feature deterministically:
   - geometry-type priority **Polygon/MultiPolygon (3) > Point (2) > LineString/MultiLineString (1) >
     other (0)**;
   - tie-break by **lowest original osmium id string** (stable, input-order-independent) — this
     matters because the merge can move imported unrated rows on small geometry shifts, so
     non-determinism would cause refresh churn.
5. Return/emit a FeatureCollection plus a small stats dict (`nodes`, `ways`, `relations`, `areas`,
   `deduped`, `unparseable`) — the CLI prints feature count to stdout (workflow's machine-readable
   result) and stats to stderr (so the workflow can record relation/area counts per spec §3).

**Tests** (`test_osmium_geojson.py`, mirroring `test_overpass.py`) using
`fixtures/osmium_export_sample.geojson` constructed to match osmium's documented `-u type_id`
scheme exactly:
- node `n123` → `node/123`, Point preserved.
- way-as-area `a246` (even) → `way/123`.
- relation-area `a247` (odd) → `relation/123`.
- a closed way emitted as **both** `w500` (LineString) and `a1000` (Polygon) → **one** `way/500`,
  Polygon kept (priority).
- tie-break + input-order independence: shuffle input, assert identical output.
- malformed id (`x9`, missing id) → skipped, counted, no crash; valid features still emitted.
- empty collection → empty collection.

> **Real-osmium note.** The unit fixture is hand-authored to the documented scheme (osmium is not
> installed on the Windows/WSL dev host). The `osm-import-pbf.yml` workflow exercises the normalizer
> on **real** `osmium export` output end-to-end for California (Task 9), which is where the
> "validate on a real sample + record relation/area counts" acceptance is met and logged.

**Done:** `pytest backend/tests/test_osmium_geojson.py` green; `ruff`/`ruff format` clean.

---

## Task 2 — `poly_to_wkt.py` (`.poly` → validated WKT `MULTIPOLYGON`) + tests

**Goal.** Convert a Geofabrik `.poly` (Osmosis polygon-filter format) to a WKT `MULTIPOLYGON`
suitable for `ST_GeogFromText`, so the workflow can PostGIS-validate it and pass it as
`scope_bounds`.

**`.poly` format** (parsed, stdlib-only): a file-name line; then one or more polygon sections, each
a section-name line (a leading `!` marks a hole/inner ring), then `lon lat` coordinate lines, then
`END`; a final `END` terminates the file. Multiple non-`!` sections are separate outer rings; each
`!` section is a hole associated with the preceding outer ring.

**Approach:**
1. Parse sections into outer rings and holes.
2. Ensure each ring is **closed** (first point == last point; append if needed).
3. **Normalize orientation for geography**: exterior rings **counter-clockwise**, holes
   **clockwise** (compute planar signed area; reverse when wrong). This prevents PostGIS `geography`
   from interpreting an inverted ring as "almost the whole globe" (a real `ST_Covers` correctness
   trap). WKT axis order is `lon lat`.
4. Emit `MULTIPOLYGON(((lon lat, …)),( (outer),(hole) ), …)`.
5. `main(argv)`: `python3 backend/app/imports/poly_to_wkt.py in.poly out.wkt` → writes WKT, prints
   ring/hole counts to stderr. Fail closed (non-zero exit) on any parse error.

**PostGIS validation** happens in the workflow (Task 6), not in Python, against a
`postgis/postgis:17-3.5` **service container** (matches deployed PostGIS major, and the exact
`ST_GeogFromText`/`ST_Covers` behavior the merge uses). Validation query, fail-closed:
```sql
SELECT ST_IsValid(g::geometry) AND ST_Area(g) > 0 AND ST_Area(g) < 2.55e14
FROM (SELECT ST_GeogFromText(:wkt) AS g) s;
```
`2.55e14 m²` ≈ half Earth's surface — an inverted/wrong-orientation polygon yields a near-global
area and fails here (defense beyond the Python orientation fix). A `false`/error fails the run
before any cluster access.

**Tests** (`test_poly_to_wkt.py`) on `fixtures/california_sample.poly` (small, multi-ring + one
hole):
- single outer ring → `MULTIPOLYGON` with one polygon, closed ring, `lon lat` order.
- outer + hole → polygon with two rings; exterior CCW, hole CW after normalization.
- two outer rings → two polygons.
- unclosed input ring → closed in output.
- clockwise-input outer ring → reversed to CCW.
- malformed `.poly` (missing `END`, non-numeric coord) → raises / non-zero exit.

**PostGIS integration test** (in `test_poly_to_wkt.py`, `@pytest.mark.asyncio`, using the existing
`session` fixture against the CI `postgis/postgis:17-3.5` DB on 5436) — this exercises the **exact**
`ST_GeogFromText`/`ST_Covers` behavior the merge uses, in CI, not only at workflow-dispatch time:
- `ST_IsValid(ST_GeogFromText(wkt)::geometry)` is true.
- `ST_Area(ST_GeogFromText(wkt))` is `> 0` and `< 2.55e14` (catches inverted orientation).
- `ST_Covers(geog, <point known inside the sample>)` is true; `ST_Covers(geog, <point outside>)` is
  false (proves orientation-normalization gives the correct interior, and hole exclusion if the
  test point sits in the hole).

**Done:** `pytest backend/tests/test_poly_to_wkt.py` green (incl. the PostGIS integration test);
ruff clean. The workflow's service-container check (Task 6) additionally validates the **real**
downloaded extract polygon at dispatch time.

---

## Task 3 — Region registry + `regions.py` validator + tests

**Goal.** A committed machine-readable registry and a validator both workflows call *before
download* to enforce the one-owner rule.

**`.github/osm-import-regions.yml`** schema:
```yaml
# Canonical OSM import scopes. Exactly one ACTIVE row may own a given area.
# source: pbf   -> key is a Geofabrik path (…-latest.osm.pbf), validated as (key, scope_id, dataset)
# source: overpass -> key is a human region locator; validated as (scope_id, dataset) [bbox is
#                     independently range/extent-sanitized by osm-import.yml]
# status: active | retired  (retired rows are rejected; aggregate paths are simply absent)
regions:
  - key: us/ca/san-diego
    scope_id: us/ca/san-diego
    dataset: overpass:san-diego
    source: overpass
    status: active          # bootstrap; retire in Task 9 once California re-owns these rows
  - key: north-america/us/california
    scope_id: geofabrik:us/california
    dataset: geofabrik:us/california
    source: pbf
    status: active
```

**`backend/app/imports/regions.py`:**
- Pure `validate_region(rows: list[dict], *, source, key, scope_id, dataset) -> dict` — raises
  `RegionValidationError` unless **exactly one** row matches the required predicate and is
  `status == "active"`:
  - `source == "pbf"`: match on `(key, scope_id, dataset, source="pbf")`.
  - `source == "overpass"`: match on `(scope_id, dataset, source="overpass")`. *(The bbox is not
    exact-matched here — decimal bbox strings are precision-fragile; the bbox is independently
    validated for range/order/≤6° extent by the existing `osm-import.yml` sanitizer. The registry's
    security purpose is to gate which `scope_id`/`dataset` are allowed + active and to reject
    retired/aggregate scopes. Rationale flagged for Codex; will add bbox-containment if required.)*
  - A match that exists but is `retired` raises with a distinct "retired" message.
- `main(argv)`: `python -m app.imports.regions --registry <path> --source <pbf|overpass>
  --key … --scope-id … --dataset …` — `yaml.safe_load`s the registry, calls `validate_region`,
  exits non-zero with a clear `::error::` on failure. This is what the workflows invoke.

**Tests** (`test_regions.py`, pure-dict, no yaml needed):
- exact pbf triple match on an active row → ok.
- unknown key / scope_id / dataset → raises.
- retired row → raises (distinct message).
- aggregate path absent (e.g. `north-america/us`) → raises (unknown).
- overpass `(scope_id, dataset)` match on active overpass row → ok; wrong dataset → raises.
- two active rows with the same triple (registry authoring error) → raises (ambiguous).

**Done:** `pytest backend/tests/test_regions.py` green; ruff clean; `yaml.safe_load` of the
committed registry succeeds (a tiny test loads the real file and asserts schema keys).

---

## Task 4 — CLI `--scope-bounds-wkt-file` (large-polygon safe)

**Goal.** A continent/country `.poly` → WKT can exceed `kubectl exec` ARG_MAX as a single CLI arg.
Add a file-based path.

**Change** (`cli.py`): add `--scope-bounds-wkt-file`; if set, read WKT from the file; error if both
`--scope-bounds-wkt` and `--scope-bounds-wkt-file` are given. Existing `--scope-bounds-wkt` stays
(tests, small polygons). The workflow streams the WKT into the pod (like the GeoJSON) and passes
`--scope-bounds-wkt-file /tmp/scope.wkt`.

**Tests** (extend `test_osm_cli.py`): `--scope-bounds-wkt-file` loads WKT and the run stores
`scope_bounds` (assert `osm_fountain_import_runs.scope_bounds` non-null); both-flags → `ValueError`
before any DB write.

**Done:** `pytest backend/tests/test_osm_cli.py` green.

---

## Task 5 — Registry validation in the existing `osm-import.yml`

**Goal.** Close the overlap loophole on the Overpass path (spec §4: *both* workflows validate).

**Change:** add a step before "Fetch Overpass extract": `pip install pyyaml` (or use preinstalled),
then `python -m app.imports.regions --registry .github/osm-import-regions.yml --source overpass
--key "$SCOPE_ID" --scope-id "$SCOPE_ID" --dataset "$DATASET"`. On non-zero, fail before fetch.
Keep the existing bbox sanitizer unchanged (runs after / independently).

**Done:** workflow YAML lints (actionlint in CI if present) and the step is ordered before fetch.
Verified functionally via the PBF workflow's shared validator (same module).

---

## Task 6 — `.github/workflows/osm-import-pbf.yml`

**Goal.** The PBF import workflow, mirroring `osm-import.yml`'s security discipline.

**Inputs:** `geofabrik_path`, `scope_id`, `dataset`, `label`, `dry_run` (boolean, default **true**).

**`concurrency`:** reuse group `osm-import-production`, `cancel-in-progress: false` (serialize with
the Overpass path — both mutate the same prod DB).

**Permissions:** `contents: read`. **`environment: production`**, **`runs-on: ubuntu-latest`**.

**Services:** `postgis/postgis:17-3.5` (for `.poly` WKT validation), published on an ephemeral port.

**Steps:**
1. `actions/checkout@v7`.
2. **Registry-validate + syntax-check** `(geofabrik_path, scope_id, dataset)`:
   `python -m app.imports.regions --source pbf --key "$GEOFABRIK_PATH" …`; then syntax-check
   `geofabrik_path` against `^[a-z0-9-]+(/[a-z0-9-]+)*$` (reject `..`, newlines, control chars —
   mirror the reject-newline/reconstruct discipline). Fail before anything else.
3. `sudo apt-get update && sudo apt-get install -y osmium-tool`.
4. **Preflight + download** onto the larger disk (`/mnt` on hosted runners; set `TMPDIR` there):
   HEAD the `.osm.pbf` for `Content-Length`, compare to an extract-size cap and to `df` free space
   (budget pbf + filtered.pbf + osmium index/temp + output); **abort before filling the runner**.
   Download `…-latest.osm.pbf`, `…-latest.osm.pbf.md5`, and the `.poly`
   (`https://download.geofabrik.de/<path>.poly`) with a descriptive User-Agent. Verify md5
   (transport check; fail closed on mismatch).
5. **Coarse filter:** `osmium tags-filter in.pbf -o filtered.pbf nwr/amenity=drinking_water,fountain
   nwr/man_made=water_tap` (keys/values only; the parser narrows to the exact potable/public set).
6. **Export:** `osmium export filtered.pbf -u type_id -f geojson -o osmium.geojson`
   (disk-backed node index for large inputs; parametrized).
7. **Normalize:** `python3 backend/app/imports/osmium_geojson.py osmium.geojson import.geojson`
   (echo feature + relation/area counts). Fail if 0 features.
8. **scope_bounds (mandatory, fail-closed):** `python3 backend/app/imports/poly_to_wkt.py
   <path>.poly scope.wkt`; validate against the postgis service with the Task-2 query; **fail the
   run** if it can't be derived/validated. No bbox/removal-disabled fallback.
9. **`source_build_id`** = extract data timestamp:
   `osmium fileinfo -e -g header.option.timestamp filtered.pbf` (NOT `date`; the Overpass
   `date`-based id must not be copied — it breaks PBF audit/ODbL provenance). Guard non-empty +
   non-URL.
10. `digitalocean/action-doctl@v2.5.2` + `doctl kubernetes cluster kubeconfig save "$CLUSTER_NAME"`.
11. Find the Running backend pod; stream `import.geojson` **and** `scope.wkt` into `/tmp` via
    `kubectl exec -i`; run:
    ```
    python -m app.imports.cli --path /tmp/osm-import.geojson \
      --scope-id "$SCOPE_ID" --dataset "$DATASET" --build-id "$BUILD_ID" \
      --label "$LABEL" --scope-bounds-wkt-file /tmp/scope.wkt $DRY
    ```
    where `$DRY = --dry-run` when `dry_run == true`. Clean up `/tmp` files. Read kubeconfig + pod
    exec only — **no cluster-state mutation** (consistent with the deploy migration step).

**Env:** `CLUSTER_NAME: fountainrank-production-cluster`, `NAMESPACE: fountainrank` (match
`osm-import.yml`).

**Done:** workflow present, `on: workflow_dispatch`, dry_run default true, mandatory scope_bounds,
registry-gated, size-preflighted, md5-checked. Functional proof is Task 9 (California).

---

## Task 7 — Runbook: PBF mode

**Change** (`docs/runbooks/osm-fountain-import.md`): add sections for **PBF mode** (dispatch
`gh workflow run osm-import-pbf.yml -f geofabrik_path=… -f scope_id=… -f dataset=… -f label=… -f
dry_run=true`), the **region registry** (how to add a scope, the one-owner rule), the **San Diego
bbox retirement** (retire after California owns its rows), **refresh**, and **rollback** (unchanged
mechanics). Keep it secret-free.

**Done:** runbook covers dispatch, registry edits, retirement, refresh, rollback for PBF.

---

## Task 8 — Local CI mirror + PR + Codex PR loop + merge

1. `./run.ps1 check` fully green (backend ruff/format/alembic/pytest — no schema change so alembic
   is a no-op check; workspace-js/web/mobile unaffected but run the full mirror per policy).
2. Commit (Conventional Commits, no AI attribution), push `feat/48-osm-pbf-large-scale-import`.
3. Open PR referencing #48; get CI green.
4. Codex Loop B (PR) → address every finding + any other PR comments → loop to `VERDICT: APPROVED`.
5. Squash-merge.

---

## Task 9 — California production validation (post-merge; **CHECKPOINT**)

1. `gh workflow run osm-import-pbf.yml -f geofabrik_path=north-america/us/california
   -f scope_id=geofabrik:us/california -f dataset=geofabrik:us/california -f label="California"
   -f dry_run=true`; watch the run; read the CLI JSON summary (candidate/insert/match/skip counts;
   expect the ~360 San Diego rows to appear as `match_provenance`/`update` re-owned to
   `geofabrik:us/california`, not fresh inserts).
2. **Post dry-run numbers + go/no-go to the user and WAIT for OK** (the agreed California checkpoint).
3. On approval: re-dispatch with `dry_run=false`. Verify live: `GET /api/v1/fountains/bbox` +
   `…/fountains?lat=&lng=` + `…/fountains/{id}` over San Diego and another CA metro return imported
   pins; a rating still works.
4. **Refresh** (re-run apply) → confirm **no churn** (only freshness advances; `inserted=0`,
   `removed=0`) and correct scope-limited removal semantics.
5. Retire the `us/ca/san-diego` overpass row in `.github/osm-import-regions.yml` (status → retired)
   via a small `chore:` PR (CI + Codex + merge).

---

## Out of scope / deferred (unchanged from spec §8)

- Per-scope-observation child table for genuinely overlapping concurrent scopes.
- Scheduled/automatic refresh.
- OSM tags → structured attributes/access/status (#38/#42/#43) — separate follow-ups.
- The worldwide rollout itself is **#131** (its own plan): world registry entries + staged
  dry-run→apply + live cross-continent verification, on top of this merged pipeline.

## Definition of done (maps to spec §9)

Operator-triggered path imports a Geofabrik region through the shipped importer
(coarse-filter → export → id-decode/dedup → pod-exec), idempotently + scope-correctly; osmium id
scheme (incl. area parity) decoded + deduped, unit-proven; `scope_bounds` mandatory, extract-polygon
derived, PostGIS-validated, fail-closed; one-owner policy registry-enforced in both workflows;
inputs allow-listed/sanitized, downloads size/disk-preflighted + md5-integrity-checked (integrity,
not trust); California dry-run→apply verified live with no refresh churn.
