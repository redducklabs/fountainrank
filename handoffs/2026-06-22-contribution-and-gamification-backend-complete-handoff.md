# Handoff — Contribution data + gamification BACKEND complete (Slices 1–7 shipped & deployed); UI remains (2026-06-22)

## TL;DR

The entire **backend + API surface** for the contribution-data + gamification vision (**issues #38–#44 + the Water Scouts gamification substrate**) is **designed, Codex-approved, built, merged, and deployed to production** across **7 slices (PRs #54–#59)**. `main` HEAD = **`1928d4d`**. Every slice went spec/plan → Codex `VERDICT: APPROVED` → CI green → squash-merge → CI-deploy → live-verified.

**What is NOT done: the capture/gamification UI (web + mobile).** This is a deliberate, documented stop — not an oversight. The local web/mobile dev env is **unrepairable on this box** (`pnpm install` hits a persistent Expo `EPERM` lock held by an external Expo/Metro process the owner's standing rule forbids blanket-killing), **mobile is a bare skeleton** (`App.tsx` only — no map/detail/add base app yet), and **web is browse-only** (no write UI exists). Building the entire write UI from scratch **blind** (no ability to run or visually verify) and auto-deploying it to the live map would risk production and violate the "never claim untested works" rule. All the APIs the UI needs are live + documented below.

---

## Shipped & deployed this session (Slices 1–7, all squash-merged, Codex-approved, CI-green, deployed)

| PR | Slice | What landed (backend) |
|---|---|---|
| **#54** | 1 — Foundation | `attribute_types`/`attribute_observations`/`fountain_attribute_consensus` + the **gamification substrate** (`contribution_events` idempotent log + `user_contribution_stats`) via the `app/contributions.py` chokepoint; `place_type` scoping (#44); `app/consensus.py`; `GET /attribute-types`, `POST /fountains/{id}/attributes`, attributes in detail, `GET /me/contributions`; emission retrofit into add/rate. Migrations `0005`/`0006`. |
| **#55** | 2 — Operational status (#40) | `condition_reports` + corroboration-gated `current_status`/`last_verified_at` (`app/conditions.py`); `POST /fountains/{id}/conditions`; `verify_working`/`report_condition` events; status on detail + pins. Migration `0007`. |
| **#56** | 3 — Notes (#41) | `fountain_notes` (one-per-user upsert, moderation-safe edit); `POST`/`GET /fountains/{id}/notes`; `add_note` event; `public_display_name` (never leaks the Logto subject). Migration `0008`. |
| **#57** | 4 — Access context (#42) | Seeded access enum/boolean attributes; `fountains.placement_note`; **capture-at-add** (`POST /fountains` accepts `observations` + `placement_note`). Migration `0009`. |
| **#58** | 5 — Filters (#43) | `app/filters.py` discovery filters on nearby/bbox (working_now, attribute, rating, `include_unknown`); filter-before-LIMIT; unknown-handling matrix. No migration. |
| **#59** | 7 — Gamification read APIs | `GET /leaderboard/contributors` (global + local) + `GET /me/badges` (derived, `app/badges.py`); deferred location **GiST index**. Migration `0010`. |

Backend test suite: **305 passing** locally + CI. `alembic` at **`0010_contrib_location_gist`**. The umbrella **spec** (`docs/specs/2026-06-22-contribution-data-and-gamification-design.md`) + per-slice **plans** (`docs/plans/2026-06-22-*.md`) are committed; Codex reviews under `temp/codex-reviews/` (gitignored).

---

## Live production API surface (all verified, `api.fountainrank.com`)

Public reads: `GET /rating-types`, `GET /attribute-types`, `GET /fountains` (+filters), `GET /fountains/bbox` (+filters), `GET /fountains/{id}` (incl. `attributes` consensus, `current_status`, `last_verified_at`, `placement_note`), `GET /fountains/{id}/notes`, `GET /leaderboard/contributors`.
Auth writes: `POST /fountains` (location, is_working, comments, ratings, **observations**, **placement_note**), `POST /fountains/{id}/ratings`, `POST /fountains/{id}/attributes`, `POST /fountains/{id}/conditions`, `POST /fountains/{id}/notes`.
Auth reads (caller-only): `GET /me`, `GET /me/contributions`, `GET /me/badges`.
Discovery filter params (nearby + bbox): `working_now`, `verified_within_days`, `bottle_filler`, `wheelchair_reachable`, `dual_height`, `indoor`, `public_access`, `min_rating` (1–5), `min_rating_count`, `include_unknown`.

**Verified live (2026-06-22, deploys for Slices 1–7 all `success`):** `GET /attribute-types` → 13 rows; fountain detail carries `attributes`/`current_status`/`last_verified_at`/`placement_note`; `GET /fountains/{id}/notes` → 200; `GET /fountains/{id}/conditions` (auth) → 401 unauth; bbox with `working_now`+`bottle_filler` → 200; `GET /leaderboard/contributors` → 200; `GET /me/badges` → 401 unauth. `api.fountainrank.com/readyz` healthy; migrations `0005`–`0010` applied in prod.

---

## What remains (prioritized) — the UI + two deferred backend bits

1. **Slice 6 — capture flow UI (web)** [#39]. **Blocked locally** (see TL;DR). The web app (`web/`, Next.js, vitest) is currently browse-only (`MapBrowser`, `FountainDetail`, `DetailOverlay`, `FountainsInViewList`; auth wired via Logto; `web/lib/api.ts` → generated `@fountainrank/api-client`). Build: auth-gated add-fountain (map-pin placement) + rate + attribute (progressive-disclosure toggles, yes/no/unknown) + condition (verify/report) + note forms, consuming the live APIs; surface `attributes`/`current_status`/`last_verified_at`/`placement_note`/notes in the detail view; discovery filter controls. **Verify via CI** (the repo's designated web-check path: eslint + tsc + vitest) — the local env can't run web until the Expo lock-holder is closed and a clean `pnpm install` runs. A **design pass** is warranted (architecture spec §14 calls UI a collaborative track; the gamification UX intent is committed at `docs/design/gamification/`). Create `docs/style-guide.md` on first UI elements (house rule). See the **Resume guide** + **API contract quick reference** sections below for the build steps + exact contracts.
2. **Slice 6 — mobile** [#39]. Mobile (`mobile/`) is a **walking skeleton** (`App.tsx`/`index.ts`); it has no map/detail/add base app. The base mobile app (an earlier phase) must be built before a mobile capture flow. Out of scope until then.
3. **Slice 7 — gamification UI**. Badge shelf, contributor leaderboard screen, profile/contribution summary, local-progress prompts — consume `GET /me/badges`, `GET /leaderboard/contributors`, `GET /me/contributions`. Web-first, same CI-verify constraint.
4. **Deferred backend (pending moderation cluster #10–#13):** **confirmation bonuses** (flip `contribution_events.is_confirmed` + award a `confirmation_bonus` when a 2nd distinct user corroborates a `target_id`) and **moderation reversal** (admin/blocking hides a contribution → recompute consensus/status + set the event `status='reversed'` + decrement `user_contribution_stats`). The columns/hooks (`is_confirmed`, `parent_event_id`, `status`, `target_type/target_id`, hidden fields, recompute entry points) all exist — these need the moderation endpoints (#12) + user-blocking (#10) to trigger them. No backfill required.
5. **Pre-existing open items** (unchanged): OSM PBF import **#48**; empty-state pill **#53**; Dependabot **#22** (failing CI), **#15**/**#1**; globe-bbox 500 **#20**; geocoding **#19**; dark mode **#18**.

---

## API contract quick reference (for the UI — typed versions come from `@fountainrank/api-client`)

Auth: writes + `/me*` require a **Logto Bearer JWT** (`Authorization: Bearer <token>`); the dev-auth header seam is OFF in prod. All reads except `/me*` are public. Source of truth = `backend/app/schemas.py` + the live OpenAPI (`./run.ps1 generate` → `@fountainrank/api-client` `paths`/`components`).

Writes (auth):
- `POST /fountains` → `201 FountainDetail` | `409 {detail:"duplicate_fountain", fountain_id}` (within 10 m). Body: `{ location:{latitude,longitude}, is_working?:bool=true, comments?:str|null, placement_note?:str|null(≤200), ratings?:[{rating_type_id:int, stars:int 1–5}], observations?:[{attribute_type_id:int, value:str}] }`.
- `POST /fountains/{id}/ratings` → `FountainDetail`. Body `{ ratings:[{rating_type_id,stars}] }` (≥1).
- `POST /fountains/{id}/attributes` → `FountainDetail`. Body `{ observations:[{attribute_type_id,value}] }` (≥1). `value` ∈ `yes|no|unknown` (boolean kinds) or one of the type's `allowed_values`/`unknown` (enum). 422 on unknown/non-fountain id or illegal value.
- `POST /fountains/{id}/conditions` → `FountainDetail`. Body `{ status:<ConditionStatus>, is_proximate?:bool=false }`. **ConditionStatus enum** (not exposed by any GET — hardcode in the UI): `working | broken | low_pressure | dirty | bad_taste | blocked | seasonal_unavailable | hours_limited` (`working` = the "verify it works" action). 422 on a bad status.
- `POST /fountains/{id}/notes` → `NoteOut`. Body `{ body:str(1–1000, trimmed) }`. One note per user/fountain (editing replaces).

Reads (public): `GET /rating-types` → 4 dims; `GET /attribute-types` → `[AttributeTypeOut{id,key,place_type,category,name,description,value_kind(boolean|enum),allowed_values:list[str]|null,sort_order}]` — **build the attribute UI dynamically from this** (group by `category` ∈ physical/accessibility/access/usability; render boolean as yes/no/unknown, enum as `allowed_values`+unknown — do NOT hardcode the attribute set). `GET /fountains` + `GET /fountains/bbox` → `[FountainPin{...,current_status,last_verified_at}]` + the filter query params listed above. `GET /fountains/{id}` → `FountainDetail{...,current_status(ok|reported_issue|degraded|not_working|null),last_verified_at,placement_note,dimensions:[{rating_type_id,name,average_rating,vote_count}],attributes:[AttributeConsensusOut{attribute_type_id,key,name,category,consensus_value,confidence(none|low|medium|high|mixed),yes_count,no_count,unknown_count,value_counts,observation_count,latest_observation_value}]}` (only observed attributes appear). `GET /fountains/{id}/notes` → `[NoteOut{id,body,author_display_name,created_at,updated_at}]`. `GET /leaderboard/contributors[?near_lat&near_lng&radius_m&limit≤100]` → `[ContributorRow{display_name,points,fountains_added:int|null,ratings_count:int|null}]` (counts null for the local/in-area variant).

Reads (auth, caller-only): `GET /me`, `GET /me/contributions` → `{stats:{total_points,fountains_added,ratings_count,attributes_count,conditions_reported,verifications_count,notes_count}, recent:[{event_type,points,fountain_id,created_at}]}`, `GET /me/badges` → `[BadgeOut{key,name,description}]`.

Point values: `backend/app/contributions.py` `POINTS`. Badge rules: `backend/app/badges.py`. UI presentation of points/badges/leaderboards should follow the design docs (below).

## Resume guide — building the UI after a context clear (start here)

The contribution/gamification **UI** (Slice 6 capture flow + Slice 7 surfacing) is the remaining work. To pick it up cleanly:

1. **Repair the local web/mobile env** (currently the blocker): close the Expo/Metro process holding the `node_modules` lock (do NOT blanket-kill per the owner's rule — identify the specific Expo/Metro/editor process), then run `pnpm install` from the repo root and confirm `./run.ps1 check -Web` runs. If it still can't run locally, the repo's accepted fallback is **CI verification** (`eslint` + `tsc` + `vitest` via the PR's `workspace-js` job) — but a from-scratch UI is much safer to build with the local env working.
2. **Design pass first** (house rule + architecture spec §14 — UI is a collaborative track). Use the committed design intent: `docs/design/gamification/{gamification-concept,design-plan-and-approach,app-store-descriptions}.md` (the "Water Scouts" theme, point/badge/leaderboard mechanics, MVP scope, restrained-civic visual tone). Brainstorm the screens with the owner, then create/extend `docs/style-guide.md` as UI elements are designed.
3. **Regenerate the typed client** after any further API change: `./run.ps1 generate` (writes the gitignored `packages/api-client/{openapi.json,src/schema.d.ts}`); the web app consumes `@fountainrank/api-client` via `web/lib/api.ts` (`getApiClient()`).
4. **Web app structure to extend** (`web/`, Next.js App Router + Tailwind + vitest): `components/map/MapBrowser.tsx` (map), `components/fountain/{FountainDetail,DetailOverlay}.tsx` (read-only detail — extend to show attributes/status/notes + add the write actions), `components/SignInButton.tsx`/`lib/logto.ts` (auth wired), `lib/api.ts` (client). Mirror the existing vitest test pattern (`components/fountain/FountainDetail.test.tsx`, `lib/*.test.ts`).
5. **Suggested UI slice order** (each spec/plan → Codex → CI → PR → deploy, like the backend): (a) **web detail enrichment** — surface attributes consensus / current_status / last_verified_at / placement_note / notes in the existing detail (low-risk, read-only, isolated from the map); (b) **web capture** — auth-gated add-fountain (map-pin) + rate + progressive-disclosure attribute toggles + verify/condition + note, with the 409-duplicate→confirm hook; (c) **web discovery filters** UI on the map; (d) **web gamification surfacing** — profile (`/me/contributions` + `/me/badges`), contributor leaderboard, local-progress prompts; (e) **mobile** — only after the base mobile app (map/detail/add) exists (mobile is currently a skeleton, an earlier phase).
6. **Two deferred backend bits** (do when the moderation cluster #10–#13 lands): confirmation bonuses + moderation reversal (hooks already in the schema — see below).

## Resume commands (copy-paste)

```bash
# prod health + new surface (all should be 200 / expected)
curl -s -o /dev/null -w "readyz %{http_code}\n" https://api.fountainrank.com/readyz
curl -s https://api.fountainrank.com/api/v1/attribute-types | python3 -c "import sys,json;print(len(json.load(sys.stdin)),'attribute types')"
curl -s -o /dev/null -w "leaderboard %{http_code}\n" https://api.fountainrank.com/api/v1/leaderboard/contributors
# state
git -C . log --oneline -8 origin/main          # HEAD should be the latest handoff/feat
gh issue list --state open -L 30
cd backend && uv run alembic current             # expect 0010_contrib_location_gist
./run.ps1 check -Backend                          # backend mirror (works locally)
# web env repair attempt (do NOT blanket-kill; close the specific Expo/Metro lock-holder first)
pnpm install && ./run.ps1 check -Web
```

## Operational + process notes (read before continuing)

- **Process (followed every slice):** spec → Codex loop A → plan → Codex loop A → branch → CI green + Codex PR `VERDICT: APPROVED` + every comment addressed → squash-merge → `gh workflow run deploy.yml` → verify live. Codex in bypass mode (`danger-full-access`, `never`) with WSL `cwd` `/mnt/d/repos/fountainrank`. Fresh `codex` session per new artifact; `codex-reply` for re-reviews.
- **Hard-won gotchas (all encoded in code/tests now):**
  - Alembic name parity: inline `create_table` CHECKs use the **SHORT** name (env applies the `ck` convention); PK/FK/unique/index use the **full** name. `alembic check` ignores CHECK names → verify via `pg_constraint`.
  - **Alembic revision ids must be ≤32 chars** (`alembic_version.version_num varchar(32)`) — `0010_contrib_location_gist` (not the longer name).
  - **Geography GiST index:** use `spatial_index=True` on the column (mirrors `idx_fountains_location`) + `op.create_index(..., postgresql_using="gist")` named `idx_<table>_<col>` — geoalchemy2 0.20 reflects gist indexes as `spatial_index=True`, so a `spatial_index=False`+`ix_` index drifts.
  - Binding a **loaded `WKBElement`** as a value needs Shapely (absent) → 500; always pass a `point_geography(lat,lng)` **expression** for an event `location`.
  - `event_metadata` (NOT `metadata` — reserved by `Base.metadata`); JSONB `GROUP BY` needs a **labeled** column.
  - Pydantic `mode="before"` validators must not call str methods on non-str input (return it unchanged → type validation 422s).
  - **No AI/Codex markers in commit messages** (even "Codex-approved"); squash-merge keeps `main` clean regardless.
  - **`ruff format` (not just `ruff check`) before pushing** — CI runs `ruff format --check`.
  - Reference tables (`rating_types`, `attribute_types`) are migration-seeded + NOT in the conftest TRUNCATE; tests inserting non-fountain definitions must clean up.
  - **Local web/mobile checks can't run** (Expo EPERM lock; do NOT blanket-kill per owner rule). Backend checks (`./run.ps1 check -Backend`, uv/.venv) work. Web/mobile = CI only.
- **Forward-only first-X bonuses** (`first_fountain`/`first_rating`): pre-feature first actions can award late; accepted (gamification UI not surfaced; near-zero prior user contributions). `first_in_area` is NOT forward-only (spatial precheck reads `fountains`).
- **Deploy** = `gh workflow run deploy.yml` (builds `main` HEAD; migrations via `kubectl exec ... alembic upgrade head` before the readiness gate) or a `vX.Y.Z` tag. Always from CI.

**Key artifacts (all committed; this handoff is the authoritative current state, superseding the Slice-1 handoff):** spec `docs/specs/2026-06-22-contribution-data-and-gamification-design.md`; plans `docs/plans/2026-06-22-{contribution-data-foundation,operational-status,fountain-notes,access-context,discovery-filters,gamification-leaderboards}.md`; **gamification UI design** `docs/design/gamification/{gamification-concept,design-plan-and-approach,app-store-descriptions}.md`; backend `app/{contributions,consensus,conditions,badges,filters,display,geohash}.py`, `app/routers/{fountains,attribute_types,leaderboard,users}.py`, migrations `0005`–`0010`; tests under `backend/tests/test_*.py`. (Codex reviews are in gitignored `temp/codex-reviews/` — not needed to continue.)
