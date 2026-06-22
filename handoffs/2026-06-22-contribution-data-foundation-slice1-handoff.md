# Handoff — Contribution data foundation (Slice 1) shipped + deployed (2026-06-22)

## TL;DR

The **contribution-data + gamification-ready foundation (Slice 1)** is **designed, planned, built, merged, and deployed**. Backend now has structured fountain **attributes** (#38) with a per-user observation + consensus model, **plus** the **gamification substrate** (idempotent `contribution_events` + `user_contribution_stats`) emitted from day one (retrofitted into add/rate). New API: `GET /attribute-types`, `POST /fountains/{id}/attributes`, attributes in fountain detail, auth-only `GET /me/contributions`. Place-type scoping (#44) is in. `main` HEAD = **`d3d8903`** (PR #54, squash-merged). Deploy run **27936916168**.

The umbrella **spec covers the whole cluster (#38–#44 + gamification)**; this slice delivered the foundation. Remaining slices are scoped in the spec §13 and below.

---

## What shipped this session (PR #54, squash-merged, Codex-approved, CI-green)

| Artifact | What |
|---|---|
| **Spec** `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` | Umbrella design for #38–#44 + the Water Scouts gamification layer. Codex spec-review loop A → APPROVED (review-3). |
| **Plan** `docs/plans/2026-06-22-contribution-data-foundation.md` | Slice 1. Codex plan-review → APPROVED (review-2). Has an "Amendments (PR #54 review)" section. |
| **PR #54** | Backend foundation. Codex PR-review → APPROVED (review-3); CI green. |

**Delivered (backend):**
- `attribute_types` registry (migration `0006` seeds 7 physical/accessibility booleans) + per-user `attribute_observations` (upsert) + denormalized `fountain_attribute_consensus` (`app/consensus.py`), recomputed on write AND on moderation hide/unhide (hidden rows excluded → no leak-by-aggregation). Ties → `consensus_value=NULL`/`mixed` (never a filterable false-positive); `unknown` stored but never decides.
- **Gamification substrate:** append-only idempotent `contribution_events` (`target_type`/`target_id`/`parent_event_id`/`status` for future confirmation + moderation reversal) + `user_contribution_stats`, via one chokepoint `app/contributions.py` (`dedup_key` unique index = idempotency + first-ever detector). Emission retrofitted into `add_fountain` + `submit_ratings`.
- **first_in_area_bonus** uses a **spatial precheck** (no other non-hidden fountain within `first_in_area_radius_m`, default 600 m) — correctly treats the ~360 imported fountains as already mapping an area. (The geohash module was removed in PR review.)
- **place_type** scoping (#44) on `rating_types` + `attribute_types`; reads + writes fountain-scoped (detail dims, rating-types list, both write validators).
- API: `GET /api/v1/attribute-types`; `POST /api/v1/fountains/{id}/attributes`; attribute consensus in `GET /api/v1/fountains/{id}`; auth-only `GET /api/v1/me/contributions`.
- Migrations `0005` (schema) + `0006` (seed); `alembic check` drift-free; constraint/index names verified via `pg_constraint`/`pg_indexes` + negative-insert tests. Backend suite: **231 passing** locally + CI.

---

## Current production state (verify after deploy run 27936916168)

- Resume probes (expect 200 once deployed):
  - `https://api.fountainrank.com/readyz`
  - `https://api.fountainrank.com/api/v1/attribute-types` (was 404 pre-deploy; should be 200 with 7 rows post-deploy)
  - `https://api.fountainrank.com/api/v1/rating-types` (still the 4 fountain dims)
  - a `GET /api/v1/fountains/{id}` now includes an `attributes` array.
- Migrations `0005`/`0006` apply in the deploy via `kubectl exec ... alembic upgrade head` (before the readiness gate).
- Web/mobile unchanged this slice; the hand-written `packages/api-client` wrapper is unchanged (generated `schema.d.ts` picks up the new endpoints at CI build).

**Verified live (2026-06-22, deploy run 27936916168 = success, sha `d3d8903`):**
- `GET /api/v1/attribute-types` → **200, 7 rows** (bottle_filler, dual_height, lower_spout, wheelchair_reachable, step_free_approach, clear_approach_space, push_button_usable).
- `GET /api/v1/fountains/{id}` → now includes an `attributes` array (empty until observed) alongside the 4 fountain-scoped `dimensions`.
- `GET /api/v1/me/contributions` → **401** without auth (correctly gated).
- `/readyz` 200; migrations `0005`/`0006` applied (the seed rows prove it).

---

## Next steps (remaining slices, per spec §13 — prioritized)

1. **Slice 2 — Operational status & verification (#40).** `condition_reports` (append-only) + derived `current_status`/`last_verified_at` on `fountains` (`app/conditions.py`); `POST /fountains/{id}/conditions`; status in detail + bbox/nearby. **Corroboration-gated** (spec §6.4): authoritative `ok`/`degraded`/`not_working` need ≥2 distinct users (symmetric — recovery too); a single report is a non-flipping `reported_issue` advisory. Add `verify_working`/`report_condition` to `POINTS`/`EVENT_TARGET_TYPES`.
2. **Slice 3 — Notes/reviews (#41).** `fountain_notes` (one current note per user/fountain, moderation-ready) + endpoints + notes in detail. Add `add_note` to the chokepoint.
3. **Slice 4 — Access context (#42).** Seed access-category **enum** `attribute_types` (access_kind/indoor_outdoor/venue_type/hours_dependent/requires_entry/seasonal) — exercises the enum consensus path end-to-end for the first time; resolve `placement_note`.
4. **Slice 5 — Filters (#43).** bbox/nearby filter params (working_now, bottle_filler, wheelchair_reachable, …) with the documented unknown-handling + filter-before-LIMIT ordering. Add the deferred `contribution_events.location` GiST index if leaderboard work lands here or in Slice 7.
5. **Slice 6 — Capture flow (web + mobile) (#39).** Progressive-disclosure rating + attribute UI; verify/condition/note actions. CI-verified (local web checks blocked — see below); update `docs/style-guide.md`.
6. **Slice 7 — Gamification surfacing.** `badges`/`user_badges`, confirmation-bonus logic (uses `target_id`/`is_confirmed`/`parent_event_id`), moderation reversal (`status='reversed'` + stat decrement), profile/local progress, leaderboards (local via `contribution_events.location` GiST; global via `user_contribution_stats`).
7. **Slice 8 — Place generalization / bathrooms (#44).** Mechanical `fountain_id → place_id` migration + a place table when restrooms ship — reuses all the contribution logic (not a rewrite).

**Also still open (pre-existing):** OSM PBF large-scale import **#48** (design approved, #47); empty-state pill wrap **#53**; Dependabot **#22** (failing CI), **#15**/**#1**; bbox 500 on whole-globe **#20**; geocoding **#19**; dark mode **#18**; moderation cluster **#10–#13**.

---

## Operational context (read before continuing)

- **Process unchanged:** spec → Codex loop A → plan → Codex loop A → branch → CI green + Codex PR `VERDICT: APPROVED` + every PR comment addressed → squash-merge → deploy via CI. Codex in bypass mode (`danger-full-access`, `never`) with the WSL-derived `cwd` (`/mnt/d/repos/fountainrank`). For a NEW artifact start a FRESH `codex` session; for re-reviews of the SAME artifact use `codex-reply` on the same thread.
- **Migration name parity (hard-won):** inline `create_table` CHECKs use the **SHORT** name (the env applies the `ck` convention → `ck_<table>_<name>`); PK/FK/unique/index use the **full** explicit name. `alembic check` ignores CHECK names/defs — verify them in a `pg_constraint` test. (See `0005`/`0006` + `test_contribution_data_migration.py`.)
- **Binding a loaded geography `WKBElement` needs Shapely (not installed)** → 500. Always pass a `point_geography(lat,lng)` **expression** for an event `location` (queried coords if you only have the WKB). See `submit_ratings`/`submit_attributes`.
- **Reference tables (`rating_types`, `attribute_types`) are migration-seeded and NOT truncated** by `conftest.py`. A test that inserts a non-fountain definition must clean it up (try/finally) to avoid PK collisions across runs.
- **Forward-only first-X bonuses:** `first_fountain`/`first_rating` are event-dedup based, so pre-feature first actions can award late. Accepted — gamification UI is not surfaced and prod is effectively pre-launch (writes require Logto auth; near-zero user contributions). `first_in_area` is NOT forward-only (spatial precheck reads the `fountains` table). A one-off baseline-event backfill is a documented option if exactness is ever wanted.
- **Local web/mobile checks are blocked** on this box (broken `node_modules` / Windows EPERM lock — do NOT blanket-kill per the owner's rule). Backend checks (`./run.ps1 check -Backend`, uv/.venv) work. Web/mobile slices are CI-only. (Note: a Codex WSL run briefly disturbed `backend/.venv`; `uv` self-heals on next `uv run`.)
- **Deploy** = `gh workflow run deploy.yml` (workflow_dispatch, builds `main` HEAD) or a `vX.Y.Z` tag push; migrations run via `kubectl exec ... alembic upgrade head` before the readiness gate. Always from CI.

**Key artifacts:** spec `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` · plan `docs/plans/2026-06-22-contribution-data-foundation.md` · backend `app/{consensus,contributions}.py`, `app/routers/{attribute_types,fountains,users}.py`, migrations `0005`/`0006` · Codex reviews under `temp/codex-reviews/` (gitignored: `*-spec-review-*`, `*-plan-review-*`, `pr-54-review-*`).
