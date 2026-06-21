# OSM / Protomaps Fountain Ingestion (design spec)

**Date:** 2026-06-21
**Status:** Codex Loop A **complete — `VERDICT: APPROVED`** (round 3 approved the core design after rounds 1–2 `CHANGES REQUESTED`; round 4 approved §4.3 reconciling this design with the structured-data issues #38–#43). Ready to proceed to the implementation plan. Plan-level refinements noted inline (overlapping-scope policy §5.4; tag allow-list, `scope_id` taxonomy, the OSM-tag→attribute mapping pass, and keeping `source_tags` internal/admin-only — all deferred to the plan).

**Related issues:** #34 (this design), and the structured-data cluster it must stay compatible with — #38 (attributes), #39 (rating/attribute flow), #40 (operational status + verification), #41 (notes/reviews), #42 (access context), #43 (filters). See §4.3.
**Relationship:** Extends the foundation spec's Phase 1 fountain data model and Phase 3 map browsing flow so the app can start with imported public drinking-water locations while still supporting (and rewarding) user-added fountains. Defines the **interaction contract** with the forthcoming gamification layer; it does not design the gamification engine itself.

Related standing docs: `docs/specs/2026-06-16-architecture-and-foundation-design.md` (§6 data model, §7 PostGIS, §9 API, §14 maps), `docs/design/architecture.md`, `backend/README.md`, `docs/specs/2026-06-20-web-map-browsing-design.md`, `docs/specs/2026-06-21-basemap-refresh-droplet-design.md`. Gamification concept (pre-spec scratch — `temp/` is gitignored; directory name `gameification` is misspelled as it exists in the workspace): `temp/gameification/gamification-concept.md`, `temp/gameification/design-plan-and-approach.md`. When gamification is promoted to a real spec, use the correct spelling for the durable path.

---

## 1. Goal

Pre-seed FountainRank with public drinking-water locations that already appear in the OSM-derived Protomaps basemap, so the first map experience is useful before users contribute ratings.

Imported locations must be first-class fountains: visible through the existing public bbox/nearby/detail APIs, rateable by authenticated users, and included in duplicate prevention when a user tries to add a fountain nearby.

User-created fountains remain fully supported **and rewarded**. The import system must not make OSM the only authority for fountain existence, must never award contribution credit to a non-human, and must not let imports dilute or farm the gamification rewards owed to real human contributors (see §8).

---

## 2. Key decision

Use **OpenStreetMap-derived source data as the ingestion authority**, not the rendered map UI and not ad hoc browser scraping of vector tiles.

Rationale:

- Protomaps basemaps are derived from OpenStreetMap and include a `pois` layer with `kind=drinking_water` / related water POIs. That proves the basemap already contains the signal we need, but PMTiles is optimized for rendering, not for durable application data.
- The app needs stable provenance, idempotent refreshes, reviewable diffs, and licensing metadata. Those are better handled from OSM feature IDs and tags than from viewport tile features.
- Parsing the hosted planet `.pmtiles` is a smoke/debug tool only. It is **not** an authoritative import path unless we confirm it carries stable source identifiers and complete tags needed for idempotency.

Import target set:

- Primary: `amenity=drinking_water`.
- Include when tags indicate potable public drinking water: `man_made=water_tap` with `drinking_water=yes`, `amenity=fountain` with `drinking_water=yes`, and Protomaps `pois.kind` values that map to `drinking_water` / `water_point`.
- Exclude or lower confidence for clearly non-public, disused, abandoned, proposed, construction, or non-potable features (lifecycle-prefixed tags such as `disused:`, `abandoned:`, `construction:`, `proposed:`).

---

## 3. Product behavior

Imported fountains appear as unrated fountains on the map:

- `rating_count = 0`, `average_rating = null`, `ranking_score = null`. Confirmed safe: `recompute_fountain_ranking` (`backend/app/ranking.py`) already leaves `ranking_score`/`average_rating` null when `vote_count == 0`, so unrated imported rows do not distort the Bayesian ranking or the global mean.
- Existing pin logic renders them as standard working pins without a rating pill.
- Detail view shows "Not yet rated". Per-fountain provenance is **not** exposed in the first public detail UI (see §8 and §11); a global OSM attribution surface is required.
- Authenticated users can rate an imported fountain exactly like a user-added fountain, and the first rater earns the normal first-rating reward (§8).

Users can still add their own fountains:

- The existing `POST /api/v1/fountains` duplicate-radius check runs against **all active, non-hidden fountains**, including imported rows.
- If a user tries to add a fountain within the duplicate threshold of an existing fountain, the API returns `409 Conflict` **including the conflicting `fountain_id`** (new field — see §7). The client converts that conflict into a "confirm / rate this existing fountain instead" flow. When the conflicting fountain is OSM-imported, confirming it rewards the user with verification + first-rater credit rather than full new-fountain credit (§8).
- If a real fountain is missing from OSM/Protomaps and is not near any existing fountain, the user add flow creates a normal `created_source = user` fountain and earns full new-fountain reward.

Imported fountains never count as contributions by a human user.

---

## 4. Data model changes

**Design principle (resolves review-1 MAJOR on the single-`source` model): separate row origin from external provenance.** A fountain's *origin* (who/what created the row) is distinct from its *external source identities* (which OSM features it corresponds to). A user-created, user-owned fountain can also carry OSM provenance without ceasing to be a user contribution. These are different concepts and live in different places.

### 4.1 `fountains` — origin + visibility only

Add to the existing table:

```text
created_source   text NOT NULL DEFAULT 'user'   -- user | osm | admin_import
is_hidden        boolean NOT NULL DEFAULT false  -- moderation / import rollback; NOT set by OSM removal
```

Change:

```text
added_by_user_id  uuid  -- becomes NULLABLE (was NOT NULL); ORM type -> uuid.UUID | None
```

Constraints / indexes:

- `CHECK (created_source IN ('user','osm','admin_import'))` — named `ck_fountains_created_source` (or a PG enum type; a CHECK is simpler and avoids enum-migration friction).
- `CHECK ((created_source <> 'user') OR (added_by_user_id IS NOT NULL))` — named `ck_fountains_user_source_requires_user`. This is the **enforceable** form of "a `user` row must have an owner"; application validation alone is insufficient (it cannot protect importer bugs, scripts, or future code paths).
- Migration is **two-step and safe**: (1) add `created_source` with `server_default 'user'` so every existing row is backfilled to `user`; (2) make `added_by_user_id` nullable; (3) add the CHECK constraints last, after backfill, so they validate cleanly.
- **Verification gotcha:** `alembic check` does not compare CHECK-constraint *definitions* (per `claude_help/testing-ci.md`). The migration's CHECK clauses must therefore be asserted directly against `pg_constraint` in a test, not assumed covered by drift-check.
- Btree index on `created_source` for import/audit queries; the existing GiST index on `location` stays the primary spatial index.

### 4.2 `fountain_provenances` — external source identities (1 fountain → many)

```text
id                  uuid PK
fountain_id         uuid NOT NULL FK -> fountains(id) ON DELETE CASCADE
source_system       text NOT NULL          -- 'osm' (room for others later)
source_dataset      text NOT NULL          -- extract identity, e.g. 'geofabrik:us/california' (scope, see §5.4)
scope_id            text NOT NULL          -- canonical region key used for scope-limited removal (§5.4)
source_external_id  text NOT NULL          -- normalized stable id, e.g. 'osm:node:123456789'
osm_type            text NULL              -- node | way | relation
osm_id              bigint NULL
source_tags         jsonb NULL             -- ALLOW-LISTED, size-capped, sanitized (see §6)
confidence          text NULL              -- high | medium | low
geometry_kind       text NULL              -- point | centroid
first_seen_at       timestamptz NOT NULL
last_seen_at        timestamptz NOT NULL
removed_at          timestamptz NULL       -- set when source no longer lists it; does NOT hide the fountain
first_import_run_id uuid NOT NULL FK -> osm_fountain_import_runs(id)
last_import_run_id  uuid NOT NULL FK -> osm_fountain_import_runs(id)
created_at          timestamptz NOT NULL
updated_at          timestamptz NOT NULL
```

- **Unique index** `uq_fountain_provenances_source_external` on `(source_system, source_external_id)` — the idempotency key for upserts and the conflict target. `source_external_id` is normalized to `osm:<type>:<id>` so node/way/relation never collide. Because provenance is its own table, this uniqueness is independent of row origin (a user fountain may gain exactly one OSM provenance row; a future re-tag could attach another).
- A user-created fountain matched to an OSM feature gets a `fountain_provenances` row attached; its `fountains.created_source` stays `user` and `added_by_user_id` is untouched. The fountain's coordinates are **not** auto-moved (§6).

`is_working` default for imported rows:

- Set `true` only when the source indicates an active potable/public feature.
- For ambiguous rows, either do not import or import with lower `confidence`; still `is_working = true` only if the tag set does not indicate disused/abandoned/non-potable.
- Never create ratings from OSM tags. Ratings are FountainRank user data only.

### 4.3 Relationship to structured fountain data (issues #38–#43)

A parallel set of issues introduces first-class, **per-user, consensus-aggregated** models layered on fountains: structured attributes (#38: `FountainAttributeType` / `FountainAttributeObservation`, yes/no/unknown), a lightweight rating+attribute flow (#39), operational status + last-verified-by-a-user (#40), user notes/reviews (#41), access context (#42), and discovery filters over all of it (#43). These models are largely **not built yet**, and each is defined around *user observations* with provenance/timestamps that aggregate into a displayed consensus.

OSM is a **non-user source**, so this import is scoped and sequenced deliberately:

- **First-import scope:** existence + location + an `is_working` seed + provenance + **preserved raw allow-listed tags** (`fountain_provenances.source_tags`). The first import does **not** write the #38/#40/#41/#42 observation models — it cannot, because they are crowd-observation concepts (no user) and several do not exist yet.
- **No synthetic user observations.** An import never creates a `FountainAttributeObservation`, a #40 user verification, or a #41 user note. OSM `last_seen_at` (source freshness, §5.4) is explicitly **distinct** from #40's "last verified by a user" — an import is not a verification. OSM `description`/`name` text is **not** written as a user note or into `Fountain.comments`; it stays in `source_tags`.
- **Tags are preserved for a later mapping pass.** The allow-list (§6) deliberately retains attribute/access/status-relevant keys (`wheelchair`, `bottle`, `fee`, `access`, `indoor`, `operator`, `check_date`, `opening_hours`, `seasonal`, …) so that, **once #38/#40/#42 land**, a separate "OSM tag → structured attribute" pass can derive seed values from trustworthy tags.
- **Precedence rule for that future pass:** OSM-derived attribute/access/status values are **seed defaults with `source = osm` provenance and the lowest precedence** — any user observation supersedes them, and the displayed value is the crowd consensus, never "latest write wins" (#38) and never an import overriding newer crowd input (#42). The aggregation treats an OSM value as a single, low-confidence, non-user input. When that pass is designed, OSM seeds MUST NOT be forced into a table that requires a `submitting_user_id` (no synthetic user — §4.2 / the gamification attribution rule); model them via a source/provenance field or a separate source-default/observation table.
- **`source_tags` stays internal/admin-only.** Preserved OSM tags include free text (`description`, `operator`, …). They are not surfaced through any public API/UI until a later surface explicitly selects display-safe fields under the moderation/display rules from #41/#42; this prevents publishing arbitrary, unmoderated OSM free text before those rules exist.
- **Filters (#43):** until the mapping pass exists, imported rows are simply "unknown" for structured attribute/access filters, which #43 already handles (exclude-unknowns-by-default for positive filters). No special-casing of imported rows is needed.

This keeps the first import shippable and decoupled from the unbuilt structured-data models while guaranteeing forward-compatibility: nothing the import does pre-empts or corrupts the consensus model those issues will introduce.

---

## 5. Ingestion architecture

Add an explicit backend import workflow:

```text
OSM extract (Geofabrik/PBF regional) / Overpass / PMTiles diagnostic
  -> importer CLI in backend
  -> staging tables (run + candidates)
  -> merge into fountains + fountain_provenances (durable import events recorded)
  -> audit summary + structured logs
```

Importer entry point:

- A backend CLI module, e.g. `backend/app/imports/osm_fountains.py`, callable from a local/admin/operator workflow and later CI/cron **if approved**.
- It uses the same `DATABASE_URL` / SQLAlchemy configuration pattern as migrations and backend code, and all DB writes go through parameterized SQLAlchemy Core/ORM — never string-built SQL (the input is untrusted OSM data).
- It emits structured logs with run id, source, counts, and error summaries — and **never** logs secrets, full DB URLs, raw tag blobs, or unsanitized source URLs (see §6, §9).
- Dry-run support (see §5.2).

**Execution-surface lockdown (resolves review-1 MAJOR):**

- v1 exposes **no** public or unauthenticated HTTP import endpoint. Import is an operator/CI action only.
- Any future HTTP/admin trigger MUST be authenticated as an admin user (`users.is_admin`) and protected against CSRF/replay as applicable. Ingestion must never become a new unauthenticated write path into first-class rateable data.
- Production import runs through an operator or CI path; secrets come from the environment and are never logged.

### 5.1 Staging tables

```text
osm_fountain_import_runs
  id uuid PK, started_at, finished_at, status, dry_run boolean,
  -- durable, non-secret source + scope identity (see §5.4):
  source_system, source_dataset, source_build_id, source_label,
  scope_id, scope_bounds geography NULL,
  candidate_count, inserted_count, updated_count, matched_existing_count,
  provenance_attached_count, skipped_count, removed_count, review_flagged_count,
  error_summary

osm_fountain_import_candidates
  id uuid PK, run_id FK, source_external_id, osm_type, osm_id, location geography,
  tags jsonb (sanitized), confidence, skip_reason, matched_fountain_id NULL,
  action text  -- insert | update | match_provenance | skip | review | remove
```

The staging layer is essential: import mistakes are otherwise hard to inspect once merged into production rows.

### 5.2 Dry-run semantics (resolves review-1 MINOR)

Dry-run is **precise**: it writes a `osm_fountain_import_runs` row (with `dry_run = true`) and `osm_fountain_import_candidates` rows recording the computed `action`/`skip_reason`/`matched_fountain_id`, and performs **zero** mutations to `fountains`, `fountain_provenances`, or `fountain_import_events`. A test must assert that a dry-run leaves those three tables byte-for-byte unchanged while still producing an auditable run + candidate set.

### 5.3 Durable import events (resolves review-1 MAJOR on rollback)

```text
fountain_import_events
  id uuid PK, run_id FK, fountain_id FK NULL, provenance_id FK NULL,
  operation text,        -- insert | update_location | provenance_attach | mark_removed | hide | unhide
  prior_values jsonb NULL,  -- enough to reverse the op (e.g. old location, old is_hidden)
  created_at timestamptz NOT NULL
```

Staging candidates are not enough for rollback because they describe *intent*, not the durable production effect across refreshes. `fountain_import_events` records what each run actually did to which production rows, with the prior values needed to reverse it. This is the backbone of "roll back / hide by run id" (§10).

### 5.4 Import scope identity (resolves review-2 MAJOR on removal detection)

Bounded imports make "absent from the current candidate set" an unreliable removal signal on its own: a refresh of region A must never mark provenance first seen in region B as removed, and changing the tag filter, confidence threshold, or extract source likewise changes what is observable. Each run therefore carries a **durable, queryable scope identity**, and `fountain_provenances` records the scope it was last observed in:

- On `osm_fountain_import_runs`: `source_system` (e.g. `osm`), `source_dataset` (the extract identity, e.g. `geofabrik:us/california`), `source_build_id` (extract checksum/timestamp), a canonical `scope_id` (stable region key), and optional `scope_bounds` (a geography polygon/bbox of the extract's coverage).
- On `fountain_provenances`: `source_dataset` and `scope_id` (set/updated to the run's values each time the feature is observed), in addition to the existing `last_import_run_id` and `last_seen_at`.

**Removal marking is scope-limited.** After a non-dry-run for `(source_system S, scope_id K, scope_bounds B)`, a provenance row may be marked `removed_at` only when **all** hold: `source_system = S`, `scope_id = K`, `removed_at IS NULL`, the row's `source_external_id` is absent from this run's candidate set, and — if `B` is present — the fountain's `location` is within `B`. A run with a narrower bounds than its declared scope must use `B` so a sub-region refresh cannot remove features it never covered. The plan defines the exact `scope_id` taxonomy and how `scope_bounds` is derived from the extract.

**Non-secret persistence (resolves review-2 MINOR).** The persisted source identity is restricted to non-secret values: `source_dataset`, `source_build_id`/checksum, and a human `source_label`. A raw fetch URL is **not** persisted; if a URL is ever retained, query string, fragment, and any embedded credentials are stripped first. This prevents a signed/credentialed extract URL from being stored in the database even though it is already barred from logs.

**Overlapping scopes (plan-level decision).** `fountain_provenances` is unique on `(source_system, source_external_id)` but stores a single `source_dataset` / `scope_id` per row, so if the same OSM feature appears in two overlapping extracts the later observation overwrites its scope metadata (and, with `scope_bounds`, could shift which run "owns" its removal). Acceptable for the first bounded launch import (non-overlapping regions). The implementation plan must pick an explicit policy before scopes can overlap: disallow overlapping scopes, canonicalize each feature to one scope, or move scope observations to a separate child table.

---

## 6. Merge rules

The merge must be idempotent, conservative, and concurrency-safe.

**Concurrency (resolves review-1 MAJOR on import-vs-add race).** The live `POST /api/v1/fountains` serializes its spatial check-then-insert with `pg_advisory_xact_lock(_ADD_FOUNTAIN_LOCK_KEY)` (`backend/app/routers/fountains.py`). The importer performs the same spatial check-then-insert/update pattern and therefore MUST acquire the **same** advisory lock around each candidate's match/insert/update transaction. To keep one source of truth, the lock key constant is promoted to a shared module (e.g. `app/locks.py`) and imported by both the router and the importer. Backend tests must cover concurrent import-vs-user-add at the same point and prove no near-duplicate is created.

**Coordinate handling (resolves review-1 MINOR).** All coordinate→geography conversion goes through `app.geo.point_geography(latitude, longitude)` (which emits `ST_MakePoint(longitude, latitude)`); the importer never hand-rolls `(lon, lat)` ordering. PBF/GeoJSON tooling commonly yields `(lon, lat)`, so the importer normalizes to `latitude`/`longitude` at the parse boundary and round-trip tests assert imported coordinates read back correctly.

**Input validation (resolves review-1 MINOR).** Before any PostGIS call, reject candidates with NaN/infinite coordinates or values outside `[-90,90]` / `[-180,180]`, and skip non-point geometry unless centroid conversion is explicitly performed and recorded as `geometry_kind = centroid`.

**Untrusted tag handling (resolves review-1 MAJOR).** `source_tags` is built from a strict **allow-list** of keys (e.g. `amenity`, `man_made`, `drinking_water`, `fee`, `access`, `bottle`, `wheelchair`, `indoor`, `operator`, `check_date`, `opening_hours`, `seasonal`, `description` — finalized in the plan; the allow-list intentionally retains attribute/access/status-relevant keys so the future #38/#42 mapping pass has trustworthy source values to draw from per §4.3). Enforce a max key length, max value length, max per-candidate JSONB byte size, and UTF-8 / control-character sanitization. Anything over limit is truncated or dropped with a recorded `skip_reason`, never stored raw. Error summaries and logs never emit raw tag blobs or unsanitized source URLs.

Merge algorithm per candidate (inside the advisory-locked transaction):

1. Normalize to `(source_external_id, latitude, longitude, allow-listed tag subset, confidence, geometry_kind)`.
2. Reject invalid coordinates, non-public/private tags, lifecycle-prefixed inactive features, and low-confidence ambiguous water features (record `skip_reason`).
3. **Provenance-id match:** if a `fountain_provenances` row already exists for `(source_system, source_external_id)`, update its `source_tags`, `last_seen_at`, `last_import_run_id`, clear `removed_at` if newly seen, and update the **fountain** location only under the small-movement rule below. Record an event.
4. **Spatial match:** else, find an existing non-hidden fountain within `settings.duplicate_threshold_m`.
   - If the spatial match is a **user-created** fountain (`created_source = 'user'`): attach a `fountain_provenances` row to it. **Do not move it** and **do not change `created_source`/`added_by_user_id`.** User-submitted coordinates are authoritative over an import. Record a `provenance_attach` event.
   - If the spatial match is an **imported** fountain without this `source_external_id`: attach/merge provenance; apply the movement rule.
5. **No match:** insert a new fountain with `created_source = 'osm'`, `added_by_user_id = NULL`, plus its `fountain_provenances` row. Record an `insert` event.
6. **Removal (scope-limited — see §5.4):** after the run, mark provenance `removed_at` **only** for rows in the same `source_system` + `scope_id` (and within `scope_bounds` if present) whose `source_external_id` is absent from this run's candidate set. A region-A refresh never touches region-B provenance. Even then, **do not** hide or delete the fountain and **do not** auto-hide on the first missing refresh (OSM removal can be vandalism or retagging). Record a `mark_removed` event.

**Movement / centroid policy (resolves review-1 MAJOR — made testable):**

- **Lock the target row first.** Before reading `rating_count`, deciding movement, updating `location`, or attaching provenance, the importer `SELECT ... FOR UPDATE`s the existing target `fountains` row (the rating endpoint serializes its aggregate recompute with the same `FOR UPDATE`). The shared advisory lock serializes match/insert against user *adds*; this row lock additionally prevents a movement decision on stale `rating_count` while a concurrent rating or rollback is in flight.
- Define two explicit meter thresholds in settings: `osm_move_small_max_m` (auto-update allowed) and `osm_move_review_min_m` (flag for review).
- Auto-update location **only** when the row is imported-only (`created_source <> 'user'`), `rating_count = 0`, and movement ≤ `osm_move_small_max_m`.
- Never auto-move a fountain that is user-created, has `rating_count > 0`, or whose movement ≥ `osm_move_review_min_m`; instead record a `review` candidate (the run's `review_flagged_count`) and leave coordinates unchanged. Moving a rated row would change the real-world object users rated.
- **Idempotency test:** re-running the importer with identical source geometry must produce zero location updates and must not churn `last_seen_at` into spurious *fountain* mutations (provenance `last_seen_at` may advance, but fountain rows must be untouched when nothing changed).

---

## 7. API and UI contract

No breaking public API change is required to make imported fountains rateable; imported rows flow through the existing bbox/nearby/detail/rating paths once those paths apply the visibility filter below.

**Visibility filter (resolves review-1 MAJOR).** The live API has no active/hidden concept; every read queries `Fountain` directly. This spec adds `fountains.is_hidden` and requires **every** read and write-guard path to apply it consistently:

- `GET /fountains` (nearby), `GET /fountains/bbox`, `GET /fountains/{id}` → exclude `is_hidden = true` (detail returns 404 for a hidden row to non-admins).
- `POST /fountains` duplicate check → ignore hidden rows (a hidden bad-import must not block a real user add).
- `POST /fountains/{id}/ratings` → reject rating a hidden fountain (404).
- `removed_at` (OSM no longer lists the feature) does **not** set `is_hidden`; such rows stay active and visible. "Active" and "hidden" are distinct: removal-from-source ≠ hidden.

Required small additions (in scope for this work):

- **`409` conflict returns a typed body, not a bare error string.** The route declares an explicit response model for the 409 so the generated OpenAPI schema and TS client expose it as a real type — the web add→verify flow must not be built on an undocumented error blob. Shape:

  ```json
  { "detail": "duplicate_fountain", "fountain_id": "<uuid>" }
  ```

  An api-client/contract test asserts the 409 schema. This typed `fountain_id` is the hook the gamification "convert add→verify" flow depends on (§8).

Optional later additions (out of scope here):

- Expose `source` / provenance label in admin or detail responses if/when we choose to surface provenance publicly.
- An authenticated "confirm location / report mismatch" flow once reports/moderation exist (issues #11/#12).

---

## 8. Gamification interaction contract

The gamification engine (badges, points, leaderboards — see `temp/gameification/*`) is specced separately. This section defines the **guarantees the OSM import provides** so imports never distort rewards, and resolves the owner decisions taken for this spec.

**Attribution rule.** Reward attribution keys off **row origin**, never provenance: only fountains with `created_source = 'user'` and a non-null `added_by_user_id` are contributions. Imported fountains (`created_source IN ('osm','admin_import')`) award **zero** points/badges, have no contributor, and are excluded from contribution counts and leaderboards (which the gamification concept already weights by "accepted contributions, not raw submissions").

**Add-near-OSM (owner decision: convert to verify + reward).** When a user's add matches an existing fountain within the duplicate radius, the `409` returns the conflicting `fountain_id`; the client routes the user to confirm/rate it. If the matched fountain is OSM-imported, the user earns **verification + first-rater** credit, **not** full new-fountain credit — consistent with the anti-gaming rule "do not award full points for duplicate fountains." The "verification" here is the first-class user verification action from #40 (a non-user import never produces one — §4.3); the user's confirmation is the first human verification of an OSM-seeded row. The real-world field work is still rewarded; farming "adds" of already-imported fountains is not.

**Coverage / first-in-area bonuses (owner decision: imports count as mapped).** OSM-imported fountains count as "already on the map." Founder / first-in-area bonuses (e.g. Neighborhood Founder, "add the first fountain here") target areas with **no existing fountain of any origin** nearby, so a pre-seeded OSM area does not grant a founder bonus. Imports still create "needs its first rating" / first-rater-bonus opportunities, which is a *positive* for early engagement.

**Structural guarantee.** Because origin (`created_source` + `added_by_user_id`) is separate from provenance (`fountain_provenances`), the gamification engine can attribute correctly with a single, stable signal and never has to infer intent from OSM metadata. This spec commits to keeping that separation; the gamification spec owns the point/badge values and the exact coverage-cell definition.

---

## 9. Licensing and attribution

**Owner decision (signed off for this spec): merge OSM rows as first-class fountains, but keep OSM-derived data separable, attribute OSM, and be prepared to offer the OSM-derived subset under ODbL.** OSM is licensed under the Open Database License (ODbL): attribution **and** share-alike for the derived database; the rendered map is a "Produced Work" that needs visible attribution. Inserting OSM features into our queryable `fountains` table and serving them via public APIs creates a derived/collective database, so:

Requirements:

- **Separability:** OSM-derived data is identifiable at all times via `fountain_provenances` (so the OSM-derived subset can be isolated, offered, and — if ever required — removed). User ratings, comments, and photos are separate user-generated content layered on top (a collective database), not part of the OSM extract.
- **Attribution surfaces:** OSM attribution ("© OpenStreetMap contributors") is visible on the map and on a legal/about surface, alongside the existing Protomaps/basemap attribution. (Per-fountain provenance in the public detail UI is deferred — §11 — but the global attribution is required.)
- **ODbL data offer:** document, for each import run, the source build/extract identifier, and prepare a path to offer the OSM-derived database subset under ODbL. Do not export a proprietary-only dataset that embeds OSM-derived rows without satisfying ODbL.
- **Public repo:** the importer and its config live in a public repo; no credentials or private extract URLs with embedded secrets are committed.

This posture is recorded here as the owner's decision; the legal/about copy and the export mechanics are tracked as follow-ups, not blockers to the bounded first import, provided separability + attribution are in place.

---

## 10. Operations

Initial import:

- Start bounded — a launch region or a country/state extract, not the whole planet (§11). The importer is geography-parameterized and tested on bounded fixtures so the first-geography choice can be finalized in the plan.
- Run dry-run first (§5.2) and inspect candidate counts and skip reasons.
- Run against staging/dev, verify bbox/nearby/detail/rating behavior and the add→verify conflict flow, then promote through the normal branch → PR → CI → Codex flow.

Refresh:

- Repeatable and safe to run multiple times (idempotent merge, §6).
- A manual operator/CI-triggered workflow is enough initially; scheduled refresh comes later once first-import quality is understood.

Observability (per the project Logging standard):

- Log run id, sanitized source label/build id (never a raw or credentialed URL — see §5.4), geography, candidate count, inserted/updated/matched/provenance-attached/skipped/removed/review-flagged counts, and representative **sanitized** skip reasons.
- Never log secrets, full DB URLs, raw tag blobs, or unsanitized source URLs.
- Persist run summaries in `osm_fountain_import_runs` and per-row effects in `fountain_import_events` for auditability.

Rollback (resolves review-1 MAJOR, now modeled):

- Each run's production effects are recorded in `fountain_import_events`. A bad run can be reversed by run id: `insert` events → hide (or delete only rows with `rating_count = 0` and no user provenance); `update_location` → restore `prior_values`; `provenance_attach` on a user fountain → detach provenance, leaving the user row intact; `mark_removed` → restore.
- Rollback uses `is_hidden` for anything that has accrued ratings or user provenance — it never deletes user-created rows or any ratings.

---

## 11. Resolved decisions

- **OSM source for the first import:** default to a bounded **Geofabrik/PBF regional extract** (or equivalent durable extract) with stable OSM IDs. Avoid Overpass for production-scale initial import; keep PMTiles parsing diagnostic-only unless source IDs + tags are proven complete. Finalized in the implementation plan.
- **First geography:** a launch-region or state/country extract, not global. The importer is geography-parameterized; the exact region is finalized in the plan with fixture tests.
- **Public provenance in detail UI:** **not** exposed in the first public detail UI; the global OSM attribution surface (§9) is required, and provenance stays available admin/internal-side.
- **Auto-hide when OSM drops a feature:** **never** auto-hide on the first missing refresh; mark provenance `removed_at` and require manual review for any visibility change.
- **Add-near-OSM reward / coverage bonus / licensing posture:** resolved in §8 and §9 (owner decisions).

---

## 12. Implementation plan outline

1. **Spec review:** complete Codex Loop A on this design (loop until `VERDICT: APPROVED`) before any code.
2. **Schema migration:** add `created_source` (+ backfill `'user'`), `is_hidden`, nullable `added_by_user_id`, the two CHECK constraints, `fountain_provenances`, `osm_fountain_import_runs`, `osm_fountain_import_candidates`, `fountain_import_events`, and indexes. Two-step/backfill ordering per §4.1; reversible.
3. **Model/schema updates:** update SQLAlchemy models (incl. `added_by_user_id: uuid.UUID | None`) and keep existing public response models stable; add `fountain_id` to the 409 body.
4. **Shared lock:** promote `_ADD_FOUNTAIN_LOCK_KEY` to a shared module used by both the add router and the importer.
5. **Visibility filter:** apply `is_hidden` to nearby/bbox/detail/duplicate-check/rating paths, with tests per path.
6. **Importer parser:** OSM candidate extraction with dry-run, deterministic filtering, allow-listed/size-capped tag handling, and coordinate validation.
7. **Merge service:** idempotent provenance-id + spatial matching under the shared advisory lock, movement thresholds, durable import events, structured logging.
8. **Backend tests:** idempotency (re-run = no churn), concurrent import-vs-user-add (no duplicates), provenance-attach to a user fountain (no move, origin unchanged), inactive-tag filtering, source-id uniqueness, null `added_by_user_id` + CHECK verified via `pg_constraint`, rating an imported fountain, dry-run mutates nothing, visibility filtering, rollback by run id, **scope-limited removal** (two bounded geographies — refreshing region A must not mark region B's provenance removed), and the **typed 409 contract** (response model present in OpenAPI; api-client exposes `fountain_id`).
9. **Operational runbook:** dry-run, staging import, production import, refresh, audit, rollback — no secrets.
10. **Client follow-up:** consume the 409 `fountain_id` to route add→confirm/verify (the gamification reward hook).
11. **Deferred follow-up (not this slice):** an "OSM tag → structured attribute/access/status" mapping pass that consumes the preserved `source_tags` once #38/#40/#42 land, under the lowest-precedence / never-override-crowd rule in §4.3.

**Local checks:** run `./run.ps1 check -Backend` at minimum for this backend/schema change; run the full `./run.ps1 check` before opening the PR if the generated API contract or TS client changes (per `claude_help/testing-ci.md`).

---

## 13. Definition of done

- Imported OSM/Protomaps drinking-water candidates become first-class `fountains` rows (`created_source = 'osm'`, null owner) with provenance in `fountain_provenances`.
- Existing bbox/nearby/detail APIs return imported fountains (visibility-filtered) without a separate overlay path.
- Authenticated users can rate imported fountains; the first rater earns the normal first-rating reward.
- User-added fountains still work and earn full reward; duplicate checks prevent near-duplicates against imported fountains and return the conflicting `fountain_id` for the add→verify flow.
- Imports award no contribution credit; the origin/provenance separation lets gamification attribute correctly.
- Import runs are idempotent (re-run causes no churn), auditable by run id, have a precise dry-run, are concurrency-safe against user adds, and scope removal so a bounded refresh of one region never marks another region's provenance removed.
- A bad import can be hidden/rolled back by run id without touching user-created fountains or ratings.
- OSM data is separable and attributed per the ODbL posture in §9.
- Backend checks and the relevant tests pass locally before any PR claims readiness.
