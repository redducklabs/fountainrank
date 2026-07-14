# Place hierarchy + worldwide drill-down — implementation plan (2026-07-14)

Implements `docs/specs/2026-07-14-place-hierarchy-drilldown-design.md` (Codex-approved,
spec-review-4). Section references below (§n) are to that spec.

**Branch:** `feat/place-hierarchy-drilldown` → one PR, sliced into reviewable commits.

*Revision 2 — rewritten after Codex plan-review-1 (1 [BLOCKER], 4 [MAJOR]). The migration now
**backfills the data** (without it the live place tree goes empty on deploy), the missed callers
(admin delete, fountain detail) are in scope, and the scoped-update algorithm is spelled out
instead of gestured at.*

---

## Two non-negotiable constraints

1. **The migration and the 308-redirect resolver ship in the SAME release** (§10). US city URLs
   move in the same deploy that adds the region tier; a migration without the resolver 404s 1,015
   indexed URLs.
2. **Intermediate commits are NOT deployment points.** Slices 1–4 are one atomic unit. Slice 1
   alone is *not* a shippable backend-only change — do not merge or deploy it independently.

---

## Slice 0 — Close the deploy race (PREREQUISITE — without this the rest is unsafe)

**Files:** `.github/workflows/deploy.yml`, `backend/app/routers/health.py`, `infra/k8s/backend.yaml`
(probe timings only if needed).

**The bug (verified in the current workflow, not assumed).** Plan rev-1 claimed the deploy already
gates traffic until migrations finish. **That claim is false**, and this change would turn a latent
weakness into a visible outage:

- `Render + apply workloads` applies **backend *and web*** in one loop
  (`.github/workflows/deploy.yml:243-255`) — *before* migrations.
- The migration step then waits only for pod **`phase=Running`**, not `Ready`
  (`.github/workflows/deploy.yml:261-268`).
- **`/readyz` only runs two PostGIS queries** (`backend/app/routers/health.py:26-38`). It says
  nothing about the schema version, so on a production DB already at `0024` it **passes before
  `0025` runs**. (The workflow's comment — "not Ready until the migration runs" — is only true on an
  *empty* database where PostGIS is absent.)
- Web's readiness probe is a bare **`GET /`** (`infra/k8s/web.yaml:75-82`), so the new web image goes
  Ready immediately.

Net: new web + new backend can serve **while `0025` is mid-flight**, against `place_kind = NULL`
data → empty place tree, 404s, or 500s on the live site.

**The fix — two parts, both required:**

1. **Make `/readyz` a real schema gate.** It compares the DB's `alembic_version.version_num` against
   the head revision **embedded in the running image** (`ScriptDirectory.from_config(...)
   .get_current_head()`); a mismatch — or a missing `alembic_version` table — returns **503**. Then:
   - new backend pods **cannot serve pre-migration** (they never enter the Service endpoints);
   - the migration step still works, because it gates on `phase=Running`, not `Ready`, and `exec`s
     into the pod;
   - **old backend pods keep serving throughout** (they are Ready), so there is no downtime;
   - a deploy that *forgets* to migrate now fails **loudly** instead of silently serving broken
     data. That is the desired behaviour.
2. **Apply `web` only AFTER migrations.** Split the workload loop: apply `backend` (+ config) →
   run migrations → then apply `web` and the rest. Otherwise new web (Ready instantly) would call
   the *old* backend, which has no `/places/{country}/regions`, and region pages would transiently
   404/500.

**Tests:** `/readyz` returns 503 when `alembic_version` is behind the image's head, and 200 when it
matches; a unit test asserts the head is read from the image, not hardcoded.

> This is a CI/IaC change made through the committed workflow — never a hand-run `kubectl`
> (`CLAUDE.md` → *Infrastructure as Code*).

---

## Slice 1 — Schema + data backfill + membership (the core)

**Files:** `backend/migrations/versions/0025_place_hierarchy.py` (new),
`backend/migrations/sql/0025_backfill.sql` (new), `backend/app/models.py`,
`backend/app/membership.py`, **`backend/app/routers/admin.py`**.

> **The migration is `0025`, `down_revision = "0024"`.** `0018` is already taken
> (`0018_fountain_photos.py`); current head is `0024_write_attempts.py`.

### 1a. Migration `0025` — schema **and data**

**The upgrade MUST backfill, not just add columns.** Existing `place_boundaries` rows would
otherwise have `place_kind = NULL`, and the new API returns `place_kind='country'` rows — so
`/drinking-fountains`, every country/region/city page, the resolver and the sitemaps would go
**empty or 404 against live US/LU data** the moment the new code serves. This is the plan's #1
production risk and it is closed here.

This is safe to do inside the migration because `deploy.yml` runs `alembic upgrade head` via
`kubectl exec` into a pod that is **Running but NOT Ready** (`.github/workflows/deploy.yml:261`) —
traffic is gated until migrations finish, so no request ever sees the half-migrated state.

**Upgrade order (load-bearing):**
1. Add `place_scope_config.eligible_region_subtypes text[] NOT NULL DEFAULT '{region}'` + CHECK
   `ck_place_scope_config_tiers_disjoint` (`NOT (eligible_city_subtypes && eligible_region_subtypes)`).
2. **Explicitly backfill the two existing rows** — never let the server default decide:
   `us` → `'{region}'`, `lu` → `'{}'` (LU must stay 2-level or its live URLs move).
3. Add `place_boundaries.place_kind text NULL`.
4. Add `fountains.region_place_id uuid NULL` FK → `place_boundaries(id)` `ON DELETE SET NULL`,
   indexed (mirror `0015_fountain_membership.py`).
5. **Drop** `uq_place_boundaries_country_slug_canonical`.
6. **Create** `uq_place_boundaries_region_canonical` (`(country_code, slug)`
   `WHERE is_canonical AND place_kind='region'`) and `uq_place_boundaries_city_canonical`
   (`(country_code, parent_id, slug)` `WHERE is_canonical AND place_kind='city'`).
   Creating them *before* the backfill is deliberate: a buggy backfill then **aborts the migration
   loudly** instead of silently shipping duplicate canonical rows.
7. **Run the full §5 data backfill** (steps 2–10: `place_kind` → region parents → 3-FK assignment →
   canonical regions → city parents → recount → canonical cities → canonical remap → recount).

   **The backfill's first statement after deriving `place_kind` MUST be
   `UPDATE place_boundaries SET is_canonical = false WHERE is_canonical`.** The rows still carry
   *old-model* winners; the moment `place_kind` is populated they become visible to the new partial
   unique indexes. Clearing them before the region/city winner passes guarantees the indexes can
   never see an old winner and a new winner in the same URL group simultaneously. (It happens to be
   safe even without the reset — the old `(country_code, slug)` rule was *stricter* than
   `(country_code, parent_id, slug)` — but relying on that is a loose sequence, and the reset makes
   it explicit.)

**The backfill SQL is FROZEN** in `backend/migrations/sql/0025_backfill.sql` and executed by the
migration. It **must not** `import app.membership` — a migration must reproduce the state as of its
own revision forever, and app code drifts. Duplication is the correct trade here; `membership.py`
continues to own the *ongoing* logic.

**The cost of that trade is a divergence hazard, and it is closed by a parity test.** There are now
two copies of the hardest algorithm in the codebase. So: run the migration's backfill on a fixture,
snapshot the full membership state (`fountains.{country,region,city}_place_id` +
`place_boundaries.{place_kind,parent_id,is_canonical,fountain_count}`), then run
`refresh_all_memberships()` on the same fixture and **assert the two final states are identical**.
Step 9's remap and the post-remap recount are the likeliest place to diverge, and divergence there
would **not** necessarily violate any index — so nothing else would catch it.

**`downgrade()`** — the full old-model recomputation in §10's exact order: drop the two new indexes
→ clear `is_canonical` → restore old parentage (every non-country boundary's parent → its country)
→ re-select canonical under the **old** `(country_code, slug)` rule → **then** create
`uq_place_boundaries_country_slug_canonical` → drop the added columns + CHECK. Creating the old
index before the re-selection fails; that ordering *is* the point.

### 1b. `membership.py` — the 10-step refresh (§5)

- `_PLACE_KIND_SQL` (step 2); a `has_region_tier` notion (`cardinality(...) > 0`, missing row ⇒
  true) encoded **once**.
- `_ASSIGN_SQL` grows a **third, independent** region LATERAL. `region_place_id` is a **direct PIP**
  — never derived from the city (§5 rule (a)).
- Canonical selection splits in two:
  - **region** (step 5): `(country_code, slug)`, tie-break **`ST_Area(boundary) DESC, overture_id
    ASC`** — geodesic (the column is `Geography`; `::geometry` would be degrees² and
    latitude-distorted) and **count-free** (§5 rule (b)), so no fountain write can ever change a
    level-2 URL owner.
  - **city** (step 8): `(country_code, parent_id, slug)`, tie-break subtype priority →
    `fountain_count DESC` → `overture_id ASC`.
- City parenting (step 6): smallest-area **canonical** region covering
  `ST_PointOnSurface(pb.boundary::geometry)`, matched against the parent's `place_boundary_cells`
  via GiST (**not** a raw geography scan across every region × city); else country; else NULL.
- **Step 9 — the canonical remap.** Repoint `fountains.city_place_id` at the canonical row of its
  `(country_code, parent_id, slug)` group; set it **NULL** when the matched city has a NULL parent.
  Without this, fountains on a non-canonical twin are counted and "city resolved" yet appear on
  **no** page.
- Recounts (steps 7, 10) become a **3-way** `UNION ALL` over the three FK columns.

### 1c. Scoped paths (§5.1) — spelled out, not gestured at

`recompute_fountain_membership()` / `recompute_place_counts()` must:
1. Capture the fountain's **old** `(country_place_id, region_place_id, city_place_id)` **before**
   reassignment.
2. Re-assign all three FKs (the step-4 LATERALs scoped by `fountain_id`).
3. Apply the **step-9 remap** to that fountain (never leave it on a non-canonical city).
4. Recount **old ∪ new** places.
5. Re-select canonical cities for the affected `(country_code, parent_id, slug)` groups. **If the
   winner changed, re-apply the step-9 remap to that whole group's fountains** — a flip moves rows
   that are not the touched fountain.
6. **Recount every city place in the affected group AGAIN, after that remap.** Skipping this is a
   real stale-`indexable` bug: old winner A holds 10 remapped fountains, B overtakes, the remap
   moves A's fountains to B; without the post-remap recount A keeps a non-zero count and B is
   undercounted, flipping `indexable` around `K`.

They never re-select canonical **regions** and never re-parent cities — which is *sound by
construction*, because region canonicality is count-free (§5 rule (b)).

### 1d. Missed caller — admin delete

`backend/app/routers/admin.py:219-242` builds the old-place-id list by hand and captures **only**
`[country_place_id, city_place_id]` before deleting the row. With `region_place_id` added, the
deleted fountain's **region count stays stale** (a region page can stay indexable, or show a count
that includes a fountain that no longer exists). Add `region_place_id` to that captured list.

Other callers audited and OK once the helpers handle region: user add
(`routers/fountains.py`), admin hide/unhide/location (`routers/admin.py:180`), OSM import + rollback
(`imports/merge.py:151,516`), boundary load (`imports/boundary_cli.py:105`), membership CLI.

### 1e. Logging (CLAUDE.md Logging & Observability — mandatory)

The refresh must be diagnosable from logs alone. Emit **named structured events** with counts:
`place_kind_derived` (per-kind counts), `region_canonical_selected` (groups, collisions),
`city_parented` (parented / null-parent counts), `fountain_assigned` (country/region/city match
counts, unmatched), `city_canonical_selected`, `city_remapped` (rows remapped, rows NULLed),
`membership_recounted`. A null-parent or duplicate-slug count > 0 is a **WARNING**, not silence.

### 1f. Tests (`backend/tests/test_membership.py`, migration tests)

- Two same-slug cities in **different** regions both canonical — the **Portland regression**.
- Two same-slug cities in the **same** region: the non-canonical twin's fountains are remapped onto
  the canonical row and **listed on its page**; nothing orphaned.
- A matched city with a NULL parent → `city_place_id = NULL` (country-only, not falsely indexable).
- Canonical **region** selection ignores fountain counts (add/hide a fountain; canonicality holds).
- **Scoped winner flip** → final counts: old winner `= 0`, new winner `= group total`.
- **Admin delete decrements the region count** (the 1d regression).
- **Idempotence:** refresh twice → identical final state (snapshot-compare; *not* "zero writes" —
  step 4 legitimately rewrites the remapped FK back to raw before step 9 re-applies it).
- Invariant: no canonical city has a NULL parent or a non-canonical region parent.
- LU (no region tier) keeps 2-level cities. Unmatched point → country-only.
- **Migration:** upgrade on a US-like fixture populates `place_kind`/parents/canonical and promotes
  both Portlands; upgrade → downgrade → the old index exists and is satisfied; index + CHECK
  **names** asserted from `pg_indexes` / `pg_constraint` (`alembic check` does not compare CHECK
  definitions, so a misnamed check ships silently).

**Done when:** `./run.ps1 check -Backend` green; `alembic check` reports no drift.

---

## Slice 2 — Places API, fountain-place contract, coverage gate

**Files:** `backend/app/routers/places.py`, **`backend/app/routers/fountains.py`**,
**`backend/app/schemas.py`**, **`backend/app/seo_coverage.py`**,
`backend/app/imports/seo_coverage_cli.py`.

- Endpoints per §6 using **literal prefixes** (`/regions`, `/cities`, `/resolve`) so FastAPI
  declaration order cannot bite. `GET /places/{country}/{city}/fountains` is **retained** (2-level
  countries + back-compat) and declared **last**.
- `GET /places/{country}/resolve/{slug}` → `{kind, canonical_path, place}`; the §3.1 decision lives
  here **once**, server-side.
- `GET /places` returns `place_kind='country'` rows — **never filter countries on `is_canonical`**
  (that flag governs region/city URL ownership only; `places.py` already documents the trap).
- **`FountainPlaceOut` must carry the parent region** (`backend/app/schemas.py:556`). It currently
  returns only `city` + `country`, which is not enough to build a canonical **nested** city URL —
  see Slice 3. `PlaceOut` gains `place_kind` and the parent region where applicable.
- `indexable` stays server-computed: `fountain_count >= K` **AND** the place's **country** is
  `city_routes_ready` (reuse the country-scoped `_scope_city_routes_ready()`).
- **Coverage gate — the logic lives in `backend/app/seo_coverage.py`, not the CLI wrapper.** A
  duplicate `(country_code, slug)` among `place_kind='region'` rows **blocks** `city_routes_ready`
  for that country: a gate **failure**, not a warning line (§5.1).

**Tests:** `/places/us/cities` and `/places/us/resolve/x` are not captured by a dynamic
`{region}`/`{city}` route; the resolver returns all four §3.1 branches; the three §3.2 collisions
resolve to the **region**; a not-ready country is `indexable: false`;
`/fountains/{id}/place` returns the parent region for a region-tier city; the coverage report
**blocks** on a duplicate region slug.

---

## Slice 3 — Web pages, the 308 resolver, and the fountain detail page

**Files:** `packages/api-client/` (regenerate `openapi.json` + `schema.d.ts` from the Slice-2
backend — never hand-edit, never text-merge), `web/lib/places.ts`,
`web/app/drinking-fountains/**`, **`web/app/fountains/[id]/page.tsx`**,
**`web/app/drinking-fountains-near-me/page.tsx`** (+ its test).

> **Grep for the flat-URL contract before writing code.** Every caller of `cityPath()` and every
> hand-built `/drinking-fountains/` string is a consumer of the *old* two-segment contract. Two live
> ones sit **outside** `web/app/drinking-fountains/**` and are easy to miss — both are listed above.

- `page.tsx` — the **hub** (§7). `[country]/page.tsx` — regions, or cities for a 2-level country.
- **Rename `[city]/` → `[place]/`** (Next forbids two dynamic segments at one level).
  `[country]/[place]/page.tsx` implements §3.1: region page → 2-level city page → **308**
  (`permanentRedirect()`) → 404.
- `[country]/[place]/[city]/page.tsx` — the city page (moved).
- **`web/app/fountains/[id]/page.tsx` is a missed consumer of the flat URL contract.** It builds
  breadcrumb JSON-LD and the "Browse more" link with `cityPath(city.country_code, city.slug)`
  (lines ~174 and ~277). Once cities are nested, those emit **stale flat URLs** — and if
  `cityPath()` becomes strictly region-aware this is also a **TypeScript compile break**. It must
  be updated to build the canonical **nested** path from the new `FountainPlaceOut` parent region.
- Breadcrumbs come from the **place tree** (`city.parent_id`), never from `region_place_id` (§5) —
  the two can legitimately disagree for a city straddling a state line.
- Region-page **disambiguation link** for the §3.2 collisions.
- `web/lib/places.ts` gains `regionPath()` and a region-aware `cityPath()`.

- **`/drinking-fountains-near-me` is an always-indexable SEO hub and a missed flat-URL consumer.**
  Its "Popular cities" links call `cityPath(city.country_code, city.slug)` (~L56-64) and its test
  asserts `/drinking-fountains/us/san-diego` (`page.test.tsx:57`). Left alone it either emits stale
  non-canonical links or **fails typecheck** once `cityPath()` is region-aware. It must build
  canonical nested URLs from the new parent-region data.

**Tests:** the four resolver branches; a legacy flat URL 308s to a canonical nested target; the DC
collision renders the state page **with** the disambiguation link; **fountain detail breadcrumb +
"Browse more" emit the canonical nested city URL** for a region-tier city, and the flat URL for a
2-level country; **`/drinking-fountains-near-me` emits canonical nested city links** (its existing
flat-URL assertion is updated, not deleted).

---

## Slice 4 — Sitemaps

**Files:** `web/app/sitemaps/regions.xml/route.ts` (new),
`web/app/sitemaps/fountains/[chunk]/route.ts` (new), `web/app/sitemaps/cities.xml/route.ts`,
`web/app/sitemaps/core.xml/route.ts`, `web/app/sitemap.xml/route.ts`,
`web/app/sitemaps/fountains.xml/route.ts`.

- `core.xml` += `/drinking-fountains`; `regions.xml` new; `cities.xml` → **nested** URLs.
- **Fountains chunking (§8):** `[chunk]` must match `^(\d+)\.xml$`, **zero-based**, chunk `n` →
  `offset = n*50000`. Out-of-range → **404**, never an empty 200. Legacy
  `/sitemaps/fountains.xml` → **308** → `/sitemaps/fountains/0.xml`.
- **`/sitemap.xml` becomes dynamic** (it must fetch `total_count` to size the chunk list). On fetch
  failure it returns an **uncacheable 503** — never a cacheable index silently missing the fountain
  chunks, which would de-list every fountain URL.

**Tests:** chunk boundaries at exactly 50k and at `total_count % 50000 == 0`; out-of-range 404;
legacy 308; index 503 on backend failure.

---

## Slice 5 — Style guide (mandatory, `CLAUDE.md`)

`docs/style-guide.md` — add **before they ship**: hub country grid, region list, breadcrumb trail
(+ JSON-LD), region-page disambiguation link.

---

## Slice 6 — Boundary registry (60 new rows)

`.github/boundary-source-regions.yml`: one `overture:<cc>` row per ISO country with an active
fountain scope, `status: active`, pinned to `overture_release_id: 2026-06-17.0`.

Derived from the current `.github/osm-import-regions.yml` (111 active scopes = 53 US + 58 non-US).
Scopes are **not** 1:1 with countries: `asia/malaysia-singapore-brunei` → **MY, SG, BN**;
`europe/guernsey-jersey` → **GG, JE**; `europe/ireland-and-northern-ireland` → **IE** (NI belongs to
GB). Result: **62 countries; `us` + `lu` exist → 60 new rows:**

```
AD AL AT AU BA BE BG BN BY BZ CH CL CY CZ DE DK EE ES FI FO FR GB GE GG GR HR HU IE IM IS
IT JE KE KR LI LT LV MC MD ME MK MT MU MY NC NL NO PL PT RO RS SE SG SI SK TR UA UY XK ZA
```

**Verify, never assume (§9):** `XK` (Kosovo), `FO`, `GG`/`JE`/`IM`, `NC` may be absent from Overture
or nested under a parent state. A dry-run loading **zero features** is the signal the code is wrong
— **retire that row** rather than ship a country that can never resolve. The rollout logs each
scope's dry-run feature count explicitly (§1e).

---

## Slice 7 — Full local mirror, PR, Codex PR loop

`./run.ps1 check` (**full** — a cross-workspace `api-client` contract break must not slip through).
Then PR → CI green → Codex PR-review loop to `VERDICT: APPROVED` → every PR comment addressed →
**squash-merge**.

> On this Windows/WSL host the backend mirror is fully verifiable via an isolated
> `UV_PROJECT_ENVIRONMENT`, but component-render / full JS unit suites and mobile's React-Compiler
> lint are **CI-only** (`claude_help/local-dev.md`). Report CI's result for those — never claim a
> local green that was not obtained.

---

## Rollout (post-merge, operator-driven)

1. **Deploy:** `gh workflow run deploy.yml --ref main` (merging does **not** deploy). The migration
   backfills the data and the readiness gate holds traffic until it completes, so migration +
   resolver + pages go live together.
2. **Verify US/LU BEFORE loading any new country:** the three §3.2 collisions render the state page;
   a sample of the 1,015 legacy city URLs 308 to live nested URLs; both Portlands resolve; the
   `/drinking-fountains` hub renders; fountain detail breadcrumbs point at nested city URLs.
3. **Germany first** — the validation country:
   `gh workflow run osm-boundary-load.yml --ref main -f scope_id=overture:de
   -f overture_release_id=2026-06-17.0 -f dry_run=true`, then apply. Confirm **Hamburg** — a
   city-state that is simultaneously a *Land* and a city — resolves as a **city**, not only a
   region; fix DE's `place_scope_config` if not.
4. **Fan out** the remaining countries, checking each dry-run's feature count.
5. **Coverage gate**, then sign off `city_routes_ready` per country **in a reviewed migration**.
   Loading a country does **not** index it.
