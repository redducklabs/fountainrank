# OSM PBF Large-Scale Import (design spec)

**Date:** 2026-06-21
**Status:** Codex Loop A **complete — `VERDICT: APPROVED`** (rounds 1–2 `CHANGES REQUESTED`; round 3 approved). Ready to implement (see §7). Plan-level resource tuning (disk cap / runner size) remains the only open knob.
**Relationship:** Extends `docs/specs/2026-06-21-osm-fountain-ingestion-design.md` (§5.4 scope/removal, §6 merge, §9 licensing). The merge service, provenance model, scope-limited removal, dry-run, rollback, and the operator pod-exec path are already shipped — see `backend/app/imports/{osm,merge,cli,overpass}.py`, `.github/workflows/osm-import.yml`, and `docs/runbooks/osm-fountain-import.md`. This doc designs only the **source side** for state/country/continent scale: replacing the Overpass-by-bbox fetch with Geofabrik `.osm.pbf` extracts filtered by `osmium`. The merge/provenance/rollback design is unchanged and out of scope.

---

## 1. Goal

Import OSM drinking-water features at **state / country / continent** scale, reusing the shipped importer. The Overpass-by-bbox workflow (`osm-import.yml`) is correct for cities/metros (it caps the bbox at 6°/side) but unsuitable for large extents (Overpass timeouts/throttling). Geofabrik publishes bounded `.osm.pbf` regional extracts that are the standard production source.

---

## 2. Approach

Per region, in a CI job (Class B → `ubuntu-latest`, operator-triggered, `production` environment gate), then exec the **already-deployed** importer in the backend pod (same pattern as `osm-import.yml`):

```text
Geofabrik region .osm.pbf  (+ .md5, + .poly boundary)
  -> osmium tags-filter   (coarse: keep objects with the candidate keys)
  -> osmium export -u type_id -f geojson  (one feature per geometry)
  -> osmium_geojson normalizer  (decode ids -> osm:<type>:<id>; DEDUPE; -> importer GeoJSON)
  -> stream into backend pod -> python -m app.imports.cli (scope_id + scope_bounds, per region)
```

- **`osmium tags-filter`** is a **coarse prefilter** — it shrinks a multi-GB PBF to objects carrying the candidate keys; it cannot express tag-AND (e.g. `man_made=water_tap` *and* `drinking_water=yes`). The precise target-set + public/lifecycle rules stay in the shipped parser (`parse_osm_geojson` / `_is_potable_candidate` / `_is_public_candidate`). Exact expressions (§6).
- **`osmium export`** then a **normalizer** produce the same canonical GeoJSON the importer already consumes — see §3 for the id decoding + dedup, which is the crux.

---

## 3. Feature-id decoding + dedup (resolves review-1 BLOCKER + the duplicate-object MAJOR)

The shipped parser (`backend/app/imports/osm.py` `_parse_feature_id`) accepts only `feature.id == "<type>/<id>"` with `type ∈ {node,way,relation}` and normalizes to `osm:<type>:<id>` — the Overpass/`overpass.py` convention. **`osmium export --add-unique-id=type_id` uses a different scheme** (per the osmium docs):

- node → `n<node_id>`
- way exported as a LineString → `w<way_id>`
- **area** (closed way or multipolygon) → `a<area_id>`, where `area_id = 2·way_id` for way-areas and `2·relation_id + 1` for relation-areas.

So a closed way can appear **twice** (as `w<id>` *and* `a<2·id>`), and area ids encode the source type in their parity. A naive "accept n/w/r" extension would drop areas and mis-type relations.

**Design:** add a dedicated, tested normalizer `backend/app/imports/osmium_geojson.py` (sibling of `overpass.py`, stdlib-only) that converts osmium-exported GeoJSON to the importer's canonical GeoJSON:

1. Decode each `id`: `n<id>`→`(node,id)`; `w<id>`→`(way,id)`; `a<id>`→ `(way, id/2)` if `id` even, `(relation, (id-1)/2)` if odd.
2. Emit `feature.id = "<type>/<id>"` (the exact form the shipped parser already accepts — importer/parser stay unchanged).
3. **Dedup by normalized id**, keeping one feature per OSM object. When multiple geometries normalize to the same id (e.g. a closed way emitted as both `w<id>` linestring and `a<2·id>` area), pick **deterministically** by a fixed geometry-type priority — **Polygon/MultiPolygon > Point > LineString/MultiLineString** — breaking ties by the lowest original osmium id, so the result never depends on osmium output order (this matters because the merge can move imported unrated rows on small geometry shifts — non-determinism here would cause refresh churn).

Keeping this osmium-specific logic in its own module (not the shared parser) isolates the area-id math + dedup and keeps a single ingestion contract. Unit-test the decode + dedup on a real `osmium export` sample (node, way-as-area `a<even>`, relation-area `a<odd>`, and a way emitted as both line and area).

**Relation coverage caveat:** `osmium export` only surfaces relations that become **areas** (multipolygon/boundary); non-area drinking-water relations are not emitted as features and are **acceptable loss** — drinking-water POIs are essentially always nodes or ways. The normalizer's test on the real extract records the relation/area feature counts so this assumption is **measured, not assumed**; if a region ever shows material non-area relation candidates, recover them via a supplementary Overpass pass for that scope.

---

## 4. Source granularity & the overlapping-scope policy (resolves review-1 MAJOR — decided here, not deferred)

The shipped merge stores a **single** `scope_id`/`source_dataset` per `fountain_provenances` row and overwrites them whenever the same `source_external_id` is re-seen (`backend/app/imports/merge.py` `_refresh_provenance`). The parent spec (§5.4) flagged this as safe only for non-overlapping scopes and required a policy before scopes overlap. They overlap **now**: San Diego was imported under bbox scope `us/ca/san-diego`, and a California extract covers San Diego. So the policy is decided here:

- **One canonical source path owns each geographic area, enforced by a committed registry (a control, not a convention).** A machine-readable registry file (`.github/osm-import-regions.yml`) lists each canonical row — `{ key (geofabrik_path or bbox), scope_id, dataset, source: pbf|overpass, status: active|retired }`. **Both** import workflows (this PBF one and the existing Overpass `osm-import.yml`) validate their dispatched inputs against it: the `(key, scope_id, dataset)` triple must match exactly one `active` row or the run **fails before any download/import**. Retired rows (e.g. the `us/ca/san-diego` bbox scope, once California owns it) are rejected; aggregate/overlapping paths like `north-america/us-latest` are simply **absent** from the registry, so they fail validation. This makes the one-owner policy enforceable rather than documentation.
- **US granularity: per-state Geofabrik extracts** (each US state = one canonical scope, e.g. `geofabrik:us/california`). Do **not** also import `us-latest` (it would overlap every state). Per-state gives granular refresh and smaller downloads. (World: per-continent/country extracts, same one-owner rule; never a single planet run.)
- **The San Diego bbox import is a superseded bootstrap.** The first California PBF import re-owns those rows automatically: the provenance-id match overwrites their `scope_id` to `geofabrik:us/california` (the same `osm:<type>:<id>` keys match). After that, **refresh only via the California scope; do not re-run the `us/ca/san-diego` bbox scope** (retire it from the registry). The shipped Overpass `osm-import.yml` stays for *new* metros in regions not yet covered by a PBF scope.
- **Overlapping/nested concurrent scopes remain forbidden** until a per-scope-observation child table is added (a separate future enhancement, explicitly out of scope here). The registry + the one-owner rule are the enforcement.

This makes removal ownership deterministic: each row has exactly one current scope, and only that scope's refresh can mark it removed.

---

## 5. scope_bounds, inputs, resources, integrity (resolve review-1 MAJORs)

**scope_bounds (fail closed).** The importer confines removal to a `scope_bounds` geography (`--scope-bounds-wkt` → `ST_GeogFromText`/`ST_Covers`). Derive it from the **exact Geofabrik extract polygon** (the published `.poly` or boundary GeoJSON), not a bbox:

- Convert `.poly`/GeoJSON → WKT `MULTIPOLYGON` (handle multiple outer rings + holes; ensure closed rings + valid orientation).
- **Validate in PostGIS before import** (`ST_IsValid(ST_GeogFromText(...))`); **fail closed** if the polygon can't be derived/validated. Run this against a **`postgis/postgis` service container in the CI job** (matching the deployed PostGIS major version), not a non-PostGIS geometry library — so it exercises the exact `ST_GeogFromText`/`ST_Covers` behavior the shipped merge uses, and before any cluster access. (A read-only query through the backend pod after kubeconfig is an acceptable alternative, but the CI service container avoids coupling validation to the cluster.)
- **The exact polygon is mandatory — there is NO bbox or removal-disabled fallback.** Geofabrik publishes a `.poly` for every extract, so the polygon is always available; if it can't be derived/validated the run fails before import. This is required because the **shipped importer always runs scope-limited removal on a non-dry-run and has no removal-disabled flag** — and passing *no* `scope_bounds` does **not** disable removal, it broadens removal to the entire `scope_id` with **no spatial guard** (`backend/app/imports/merge.py` `merge_candidates` always calls `_mark_scope_removals`). So a valid `scope_bounds` polygon is a hard precondition for any non-dry-run PBF import; a bbox is never substituted.

**Workflow inputs (registry-validated, then sanitized).** The dispatched `(geofabrik_path, scope_id, dataset)` triple **MUST match exactly one `active` row in the committed registry** (§4); a non-match, a retired row, or an absent aggregate path fails the run before any download. As defense-in-depth, `geofabrik_path` is also syntax-checked (`^[a-z0-9-]+(/[a-z0-9-]+)*$`: lowercase, single slashes, no `..`, no newlines/control chars), and `scope_id`/`dataset` keep the importer's existing URL-reject guard. Mirror the reject-newline/reconstruct discipline from `osm-import.yml`.

**Resources (osmium needs disk, not stdin).** `osmium export` reads its input twice and **cannot read stdin** — it needs a seekable file plus temp/index space. Budget disk for: the downloaded `.osm.pbf` + the filtered `.pbf` + osmium export temp/index + the output GeoJSON. Preflight the download `Content-Length` and free disk; **abort before filling the runner** if the extract exceeds a configured cap or disk is insufficient. Large extents may need a larger/dedicated runner. Run on `ubuntu-latest` (Class B), never the shared `redducklabs-runners` fleet.

**Integrity, not trust.** Verify the Geofabrik `.osm.pbf.md5` as a **transport/corruption check only** (same-origin HTTPS — it is not authenticity or a trust boundary). Fail closed on mismatch. The PBF is still **untrusted input**: all shipped parser/tag/size sanitization stays in force. Do not imply MD5 makes the extract trusted.

---

## 6. Workflow shape

A new `.github/workflows/osm-import-pbf.yml` (keeping the Overpass one for metros), or a `source: overpass|pbf` mode on the existing one. Inputs: `geofabrik_path`, `scope_id`, `dataset`, `dry_run` (default true). Steps:

1. **Validate the `(geofabrik_path, scope_id, dataset)` triple against the committed registry** `.github/osm-import-regions.yml` — must be exactly one `active` row; reject retired/unknown/aggregate before anything else (§4). Then syntax-check `geofabrik_path` (§5).
2. `apt-get install -y osmium-tool`.
3. Download `https://download.geofabrik.de/<geofabrik_path>-latest.osm.pbf`, its `.md5`, and the `.poly`; preflight size/disk; verify md5 (§5).
4. **Coarse filter:** `osmium tags-filter in.pbf -o filtered.pbf nwr/amenity=drinking_water,fountain nwr/man_made=water_tap` (keys only; the parser narrows to the exact potable/public set).
5. `osmium export filtered.pbf -u type_id -f geojson -o osmium.geojson`.
6. `python3 backend/app/imports/osmium_geojson.py osmium.geojson import.geojson` (decode ids + dedup, §3).
7. Derive + PostGIS-validate `scope_bounds` WKT from the extract `.poly` — **mandatory; fail the run if it can't be derived/validated** (no bbox/removal-disabled fallback — §5).
8. `source_build_id` = the extract's **data timestamp** (`osmium fileinfo -g header.option.timestamp filtered.pbf`), not the current time (the Overpass workflow's `date`-based build id must NOT be copied here — it is meaningless for a PBF extract and breaks audit/ODbL provenance).
9. doctl kubeconfig; find Running backend pod; stream `import.geojson` in via `kubectl exec -i`; run `python -m app.imports.cli --path … --scope-id … --dataset … --build-id "$BUILD_ID" --scope-bounds-wkt "$WKT" [--dry-run]`; cleanup. No cluster-state mutation (read kubeconfig + pod exec only), consistent with the deploy migration step.

---

## 7. Implementation plan outline

1. Codex Loop A on this design (loop to `VERDICT: APPROVED`).
2. Build + unit-test `osmium_geojson.py` (decode `n/w/a` incl. area parity, dedup) against a real `osmium export` sample.
3. Build a `.poly` → validated WKT `MULTIPOLYGON` step (PostGIS-validated, mandatory, fail-closed — no fallback).
4. Commit the registry `.github/osm-import-regions.yml` and add registry-triple validation to **both** workflows (the new PBF one and the existing Overpass `osm-import.yml`), rejecting unknown/retired/aggregate inputs before download.
5. Add `osm-import-pbf.yml`: registry validation, size/disk preflight, md5 integrity check, the osmium filter→export→normalize pipeline, mandatory scope_bounds, and the pod-exec import.
6. Validate: dry-run the California extract in prod, inspect counts/skips (expect the San Diego rows re-owned to `geofabrik:us/california`), then apply; verify on the live bbox/nearby APIs; confirm a second California refresh causes no churn and correct scope-limited removal.
7. Document in `docs/runbooks/osm-fountain-import.md`: PBF mode, the region registry, the one-owner rule + `us/ca/san-diego` bbox retirement, refresh, and rollback.

---

## 8. Open decisions (narrowed)

- Exact disk cap + runner size for the largest intended extents (continents) — a resource tuning detail for the plan; the fail-closed preflight is required regardless.
- Whether to add a scheduled refresh once first-region PBF quality is understood (parent spec deferred scheduling; still deferred).
- A future per-scope-observation model (child table) IF genuine overlapping scopes are ever needed — out of scope; until then the one-owner registry is the rule.

---

## 9. Definition of done

- An operator-triggered path imports a Geofabrik region (state → continent) through the existing importer: osmium coarse-filter → export → id-decode/dedup normalizer → pod-exec import, idempotently and scope-correctly.
- The osmium id scheme (incl. area parity) is decoded correctly and dedup'd, proven by a unit test on real `osmium export` output.
- `scope_bounds` is **mandatory**, derived from the exact extract polygon, PostGIS-validated, fail-closed; no bbox or removal-disabled fallback exists.
- The one-canonical-scope-per-region policy is **enforced by a committed machine-readable registry** that both the PBF and Overpass workflows validate inputs against (unknown/retired/aggregate rejected before download); the San Diego bbox scope is retired once California re-owns its rows.
- Workflow inputs are allow-listed/sanitized; downloads are size/disk-preflighted and md5-integrity-checked (integrity, not trust); the PBF is treated as untrusted throughout.
- California (covering San Diego) can be dry-run then applied in production and verified live, demonstrating the path scales beyond bbox/Overpass with no provenance churn on refresh.
