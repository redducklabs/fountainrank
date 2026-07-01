# Worldwide OSM Rollout — Implementation Plan (issue #131)

**Date:** 2026-07-01
**Depends on:** #48 (merged + deployed; California dry-run→apply verified live). Design:
`docs/specs/2026-06-21-osm-pbf-large-scale-import-design.md`.
**Status:** Draft — Codex Loop A pending.

#131 is the operational rollout of the #48 PBF pipeline to the rest of the world. It adds no new
pipeline code — it (a) registers worldwide scopes, (b) documents the rollout, and (c) runs staged
dry-run→apply imports with live verification. The importer, merge/provenance/removal engine, and the
`osm-import-pbf.yml` workflow are unchanged.

## Scope (v1 = curated, representative, expandable)

"Rest of the world" is delivered as a **curated set of per-country/region Geofabrik scopes covering
all six continents, smaller-first**, satisfying the acceptance ("representative regions across
N.America, Europe, Asia, Africa, S.America, Oceania verified live"). The registry is the expansion
mechanism for the long tail: appending rows to `.github/osm-import-regions.yml` and dispatching is
all that's needed later (the workflow reads the file from the checkout at dispatch — **no deploy**).

**One-owner rule:** per-country/region scopes only; never a continent/`*-latest` aggregate that
overlaps sub-scopes (validated + rejected). **Antimeridian exclusion:** extracts whose `.poly`
crosses ±180° (Fiji, NZ Chathams, far-east Russia) are excluded from v1 — the planar orientation in
`poly_to_wkt.py` + the PostGIS `ST_Area < half-Earth` guard fail closed on them; revisit with a
dedicated antimeridian split if needed.

### v1 registry scopes (all HEAD-verified against download.geofabrik.de)

| Continent | Geofabrik path(s) → scope_id `geofabrik:<tail>` |
|---|---|
| N. America | `north-america/us/california` (done) · `central-america/belize` |
| Europe | `europe/monaco` · `europe/luxembourg` · `europe/malta` · `europe/netherlands` · `europe/portugal` |
| Asia | `asia/malaysia-singapore-brunei` · `asia/south-korea` |
| Africa | `africa/mauritius` · `africa/kenya` · `africa/south-africa` |
| S. America | `south-america/uruguay` · `south-america/chile` |
| Oceania | `australia-oceania/new-caledonia` · `australia-oceania/australia` |

(`asia/singapore` does not exist as a standalone extract — Singapore is inside
`asia/malaysia-singapore-brunei`.)

## Rollout order (smaller-first)

1. **Micro/small** (fast downloads, smoke every continent): monaco, luxembourg, malta, belize,
   mauritius, new-caledonia, uruguay.
2. **Small/medium:** netherlands, portugal, south-korea, kenya, chile,
   malaysia-singapore-brunei.
3. **Larger** (watch `MAX_EXTRACT_MB`/disk): south-africa, australia.

## Autonomous execution protocol (post-California checkpoint → no more human gates)

Per scope, in order:
1. Dispatch dry-run: `gh workflow run osm-import-pbf.yml -f geofabrik_path=… -f scope_id=… -f
   dataset=… -f label=… -f dry_run=true`.
2. Read the CLI summary. **Anomaly gates** (else PAUSE + notify, do NOT apply):
   - workflow step failure (404 path, poly/ST_Area fail, disk/size preflight, md5) → diagnose/skip.
   - `candidate_count == 0` → likely wrong path/filter → investigate.
   - (on refresh) `removed_count` disproportionate to prior candidates → investigate.
3. If clean → apply (`-f dry_run=false`). Idempotent + reversible (`rollback_run`).
4. **Live-verify** the representative city for that region via
   `GET https://api.fountainrank.com/api/v1/fountains/bbox?min_lat&min_lng&max_lat&max_lng`.
5. Proactively notify at each continent milestone.

## Live cross-continent verification (acceptance)

One city per continent returns imported pins post-apply:
- N. America: San Diego / LA / SF (California — already verified live).
- Europe: Monaco / Amsterdam.
- Asia: Singapore / Seoul.
- Africa: Nairobi / Cape Town.
- S. America: Montevideo / Santiago.
- Oceania: Nouméa / Sydney.

## Runbook

Extend `docs/runbooks/osm-fountain-import.md` with a **worldwide rollout** subsection: order,
anomaly gates, the expand-by-registry mechanism, antimeridian exclusion, and the per-continent
live-verify checklist.

## Deliverables

- **PR (#131 engineering):** the 15 registry rows (this branch) + runbook rollout subsection →
  CI green + Codex `APPROVED` → squash-merge. No deploy (registry read from checkout; importer
  already deployed with #48).
- **Rollout (operational):** staged dry-run→apply per scope, autonomous, with live verification;
  report results + any skipped scopes.

## Out of scope

Full-planet coverage of every country (the registry is the expansion path); antimeridian regions;
scheduled/automatic refresh; OSM tags → structured attributes (#38/#42/#43).
