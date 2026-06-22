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

1. **Slice 6 — capture flow UI (web)** [#39]. **Blocked locally** (see TL;DR). The web app (`web/`, Next.js, vitest) is currently browse-only (`MapBrowser`, `FountainDetail`, `DetailOverlay`, `FountainsInViewList`; auth wired via Logto; `web/lib/api.ts` → generated `@fountainrank/api-client`). Build: auth-gated add-fountain (map-pin placement) + rate + attribute (progressive-disclosure toggles, yes/no/unknown) + condition (verify/report) + note forms, consuming the live APIs; surface `attributes`/`current_status`/`last_verified_at`/`placement_note`/notes in the detail view; discovery filter controls. **Verify via CI** (the repo's designated web-check path: eslint + tsc + vitest) — the local env can't run web until the Expo lock-holder is closed and a clean `pnpm install` runs. A **design pass** is warranted (architecture spec §14 calls UI a collaborative track; the owner has gamification UX notes in `temp/gameification/`). Create `docs/style-guide.md` on first UI elements (house rule).
2. **Slice 6 — mobile** [#39]. Mobile (`mobile/`) is a **walking skeleton** (`App.tsx`/`index.ts`); it has no map/detail/add base app. The base mobile app (an earlier phase) must be built before a mobile capture flow. Out of scope until then.
3. **Slice 7 — gamification UI**. Badge shelf, contributor leaderboard screen, profile/contribution summary, local-progress prompts — consume `GET /me/badges`, `GET /leaderboard/contributors`, `GET /me/contributions`. Web-first, same CI-verify constraint.
4. **Deferred backend (pending moderation cluster #10–#13):** **confirmation bonuses** (flip `contribution_events.is_confirmed` + award a `confirmation_bonus` when a 2nd distinct user corroborates a `target_id`) and **moderation reversal** (admin/blocking hides a contribution → recompute consensus/status + set the event `status='reversed'` + decrement `user_contribution_stats`). The columns/hooks (`is_confirmed`, `parent_event_id`, `status`, `target_type/target_id`, hidden fields, recompute entry points) all exist — these need the moderation endpoints (#12) + user-blocking (#10) to trigger them. No backfill required.
5. **Pre-existing open items** (unchanged): OSM PBF import **#48**; empty-state pill **#53**; Dependabot **#22** (failing CI), **#15**/**#1**; globe-bbox 500 **#20**; geocoding **#19**; dark mode **#18**.

---

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

**Key artifacts:** spec `docs/specs/2026-06-22-contribution-data-and-gamification-design.md`; plans `docs/plans/2026-06-22-{contribution-data-foundation,operational-status,fountain-notes,access-context,discovery-filters,gamification-leaderboards}.md`; backend `app/{contributions,consensus,conditions,badges,filters,display,geohash}.py`, `app/routers/{fountains,attribute_types,leaderboard,users}.py`, migrations `0005`–`0010`.
