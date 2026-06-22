# Gamification Read APIs — Leaderboard + Badges (Slice 7, backend) — Implementation Plan

> TDD, task-by-task. Source spec: `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` §10 + architecture spec §8/§9 (contributor leaderboard). The gamification **UI** (badge shelf, leaderboard/profile screens) is part of the deferred capture-UI handoff — this slice ships the read **APIs** + the location index they need.

**Goal:** Surface the gamification substrate (Slices 1–5) via read APIs: a **contributor leaderboard** (global + local) and **derived badges** (`GET /me/badges`). Adds the deferred `contribution_events.location` **GiST index** (local leaderboard's spatial aggregation). This is the **read-API slice** — confirmation-bonus + moderation-reversal remain deferred (they depend on the unbuilt moderation cluster #10–#13; their columns/hooks already exist), so this does NOT complete the entire §10 gamification backend.

## Global constraints
Same as prior slices. Branch `feat/gamification-leaderboards` → PR → CI green + Codex `VERDICT: APPROVED` + comments addressed → squash-merge → deploy.

## Data (migration `0010_contribution_events_location_index`, down_revision `0009_access_context`)
- Add the deferred **GiST index** on `contribution_events.location`. **Resolve the geoalchemy2-reflection gotcha (Codex):** GeoAlchemy2 0.20 reflects any GiST index on a geography column back as the column's `spatial_index=True`, so a `spatial_index=False` column + a separate `ix_` index would drift. Mirror the proven `idx_fountains_location` pattern: flip `ContributionEvent.location` to **`spatial_index=True`** and DROP the explicit `Index(...)` from `__table_args__` (geoalchemy2 + the env's `geoalchemy2.alembic_helpers` manage the spatial index). The migration creates it with the GeoAlchemy convention name **`idx_contribution_events_location`** via `op.create_index("idx_contribution_events_location", "contribution_events", ["location"], postgresql_using="gist")`; downgrade drops it.
- **Empirically verify `alembic check` is no-drift** after `alembic upgrade head` (hard gate). The migration test asserts the index exists + is gist via `pg_indexes.indexdef`. **Fallback if drift persists:** defer the index again (the local leaderboard is correct without it — `ST_DWithin` seq-scans a tiny table — it is purely a perf optimization) and document it; do NOT ship with `alembic check` drift.

## Badges — `app/badges.py` (pure, derived; no new table)
`@dataclass(frozen=True) Badge(key, name, description)`. Pure `earned_badges(*, stats, created_rank, dimension_rate_counts) -> list[Badge]` with module-constant thresholds, unit-tested:
- `first_fountain` (`fountains_added>=1`), `hydrated_helper` (`ratings_count>=1`), `field_verifier` (`verifications_count>=10`), `fix_finder` (`conditions_reported>=1`), `note_taker` (`notes_count>=5`), `attribute_ace` (`attributes_count>=10`).
- `original_100` — `created_rank <= 100`. **Deterministic rank:** `count(users with (created_at, id) strictly before the caller) + 1` (total order on `(created_at, id)`, so timestamp ties can't let >100 users qualify).
- per-dimension testers from `rate` events — `clarity_critic`(1)/`taste_tracker`(2)/`pressure_tester`(3)/`appearance_appraiser`(4), `>=10` each. **Counts come from `contribution_events` where `event_type='rate' AND status='awarded'`**, grouped by `event_metadata->>'rating_type_id'` — reversed events never count.

(Stats counters are not yet decremented on reversal — moderation-reversal is deferred — but no events are reversed today; the direct dimension query is reversal-safe regardless. Documented.)

## API
- `GET /api/v1/me/badges` (auth): caller's earned badges → `list[BadgeOut{key,name,description}]`. `created_rank` via the `(created_at,id)` total order; dimension counts via the awarded-only grouped query. Caller-only.
- `GET /api/v1/leaderboard/contributors` (public): `ContributorRow{display_name, points: int, fountains_added: int|None, ratings_count: int|None}` — counts are **null for local scope** (never fake `0`).
  - **Global** (no `near_lat`/`near_lng`): top `limit` by `user_contribution_stats.total_points DESC, user_id ASC`, joined to users; `points=total_points`, counts populated. Public.
  - **Local** (`near_lat` + `near_lng` + optional `radius_m`): `SUM(points)` per user over `contribution_events` where `status='awarded' AND ST_DWithin(location, point, radius)`, `ORDER BY points DESC, user_id ASC`, top `limit`; counts = `None`. `point` built with `point_geography(lat, lng)` (repo helper, correct lng/lat order); radius = `radius_m` (capped at `nearby_max_radius_m`) else `leaderboard_local_radius_m` (default 5000). NULL-location rows excluded by `ST_DWithin`.
  - Validation: `limit` `Query(default=20, ge=1, le=100)`; `near_lat` `Query(ge=-90, le=90)`, `near_lng` `Query(ge=-180, le=180)`, `radius_m` `Query(gt=0)`; **both-or-neither** of `near_lat`/`near_lng` (else 422); `public_display_name` masks the Logto subject (Slice-3 privacy rule).
- Settings: `leaderboard_local_radius_m: float = 5000.0`. New `app/routers/leaderboard.py` registered in `app/main.py`.

## Tests
- Migration test: `idx_contribution_events_location` present + gist (`pg_indexes.indexdef`); `alembic check` no-drift; downgrade round-trip.
- `test_badges.py` (pure): each threshold boundary; `original_100` in/out incl. a (created_at,id) tie at the 100/101 boundary; per-dimension testers; zero user → no badges.
- `test_badges_api.py`: `/me/badges` auth (401); correct badges for a seeded user; **a reversed `rate` event does NOT count toward a dimension tester**; caller-only.
- `test_leaderboard_api.py`: global top-N order + deterministic tie (equal points → user_id); public (no auth); `public_display_name` masks a subject-fallback user; local aggregates within radius, **excludes far + `status='reversed'`** events; local tie deterministic; local rows have `null` counts; `limit` 422 over 100; near both-or-neither → 422; near_lat/lng/radius bounds → 422; empty → `[]`.
- OpenAPI: `/leaderboard/contributors` + `/me/badges` paths + `BadgeOut`/`ContributorRow` components.

## Definition of done
Backend mirror green (`alembic check` no-drift incl. the GiST index, or the index deferred per the fallback); PR CI green + Codex `VERDICT: APPROVED` + comments addressed; squash-merge; deploy via CI; verify `/leaderboard/contributors` live. This completes the gamification **read-API slice**. Remaining gamification backend (confirmation bonuses, moderation reversal) is deferred to the moderation cluster; the gamification + capture **UI** is the deferred web/mobile handoff.
