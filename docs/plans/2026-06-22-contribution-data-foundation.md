# Contribution Data Foundation (Slice 1) — Implementation Plan

> **For agentic workers:** implement this plan task-by-task (TDD). Steps use checkbox (`- [ ]`) syntax for tracking. One task at a time, run the checks, commit.

**Goal:** Stand up the backend foundation for structured fountain **attributes** (#38) with a per-user observation model + derived consensus, AND the **contribution-event substrate** that the gamification layer ("Water Scouts") builds on — emitted from day one (including retrofitted into the existing add/rate paths) so nothing needs backfill. Place-type scoping (#44) is introduced on the definition tables. Operational status (#40), notes (#41), access context (#42), filters (#43), the capture UI (#39), and gamification surfacing are later slices.

**Architecture:** Extend the Phase-1 domain. Generalize the existing observation pattern (`ratings`) to **attributes**: an `attribute_types` registry (rows, not columns) + per-user `attribute_observations` (upsert) + a denormalized `fountain_attribute_consensus` recomputed on write (mirrors `recompute_fountain_ranking`). Add an append-only, idempotent `contribution_events` log + a denormalized `user_contribution_stats` cache, written through a single chokepoint `app/contributions.py`. Every write path (existing `add_fountain`/`submit_ratings` retrofitted; new attribute endpoint) routes through the chokepoint, whose **`dedup_key` unique index doubles as the "first-ever" detector** (attempt the bonus event; only the first insert succeeds) — no "is this the first?" query needed. Aggregates exclude hidden rows so moderation never leaks by aggregation.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 (async) + asyncpg, GeoAlchemy2, Alembic, PostgreSQL 17 + PostGIS 3.x, Pydantic v2, pytest/pytest-asyncio. **Source spec:** `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` (Codex spec-review loop A APPROVED, review-3).

## Global Constraints

- **Python** `>=3.13,<3.14`. Do **not** add or bump dependencies. No new geohash/geo libraries — a small pure base32 geohash encoder lives in `app/geohash.py` (stdlib only).
- **Windows host:** backslash paths with Read/Write/Edit (`D:\repos\fountainrank\...`). The Bash tool is Git Bash (forward slashes, `/d/repos/fountainrank/...`).
- **Local CI mirror is `./run.ps1 check -Backend`** = `ruff check` + `ruff format --check` + `alembic upgrade head` + `alembic check` (no drift) + `pytest`, against the compose `db` on port **5436** (`./run.ps1 up` starts it). `alembic check` reporting **no drift is a hard gate**. Run the full `./run.ps1 check` before the PR if the generated API contract changes (it does — new endpoints/schemas). **Note:** local web/mobile checks are currently blocked by a broken `node_modules` lock on this box (see handoff) — backend is locally verifiable; web/mobile is CI-only. Slice 1 is backend-only, so it is fully locally verifiable.
- **`alembic check` does NOT compare CHECK-constraint definitions or names**, and does not catch unique/index NAME mismatches reliably — per `claude_help/testing-ci.md` and the `models.py` `stars_range`/`created_source` short-name trap. Every CHECK, unique constraint, and index this plan adds MUST be verified directly against `pg_constraint`/`pg_indexes` in a test, and every CHECK's behavior verified with a negative-insert test.
- **Name parity:** the ORM `NAMING_CONVENTION` renders short names to `ck_%(table)s_%(name)s`, `uq_%(table)s_%(col0)s`, `ix_%(table)s_%(col0)s`, `fk_%(table)s_%(col0)s_%(reftable)s`, `pk_%(table)s`. **CHECKs are the trap:** the Alembic env applies the same `ck` convention, so `op.create_check_constraint(name, ...)` AND inline `sa.CheckConstraint(name=...)` inside `op.create_table` BOTH take the **short** name (verified in `0002`: `name="stars_range"` → `ck_ratings_stars_range`; a full name double-prefixes). **PK/FK/unique constraints and `op.create_index`** take the **full** explicit name verbatim (their convention tokens don't wrap `%(constraint_name)s`). Mirror exactly what the ORM produces, and verify every name in a `pg_constraint`/`pg_indexes` test.
- **Coordinate order:** the API speaks `latitude`/`longitude`; PostGIS takes `(longitude, latitude)`. All conversion goes through `app.geo.point_geography` — never hand-roll ordering. `contribution_events.location` is copied from the already-correct `fountains.location` geography (no re-encoding).
- **Concurrency:** new write paths that recompute a denormalized aggregate take the same per-fountain `SELECT ... FOR UPDATE` lock the existing `submit_ratings` uses, before recompute. Contribution-event inserts are made idempotent by the `dedup_key` unique index (independent of the lock).
- **`metadata` is reserved** by SQLAlchemy `Base.metadata` — the JSONB column/attr on `contribution_events` is `event_metadata`.
- **Logging (repo MANDATORY standard):** structured logs only; the chokepoint logs `event_type`/`user_id`/`fountain_id`/`points`/inserted-vs-deduped at INFO; consensus recompute at DEBUG with counts; domain-validation failures (unknown `attribute_type_id`, illegal value) at WARNING in the service-layer branch. Never log secrets/PII/full tokens.
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution** in commits/PRs. **No time estimates** anywhere.
- **Source-control:** branch `feat/contribution-data-foundation` → PR → CI green + Codex `VERDICT: APPROVED` + all comments addressed → squash-merge. Do not commit to `main`.

---

## File Structure

**New backend modules:**
- `backend/app/geohash.py` — pure stdlib base32 geohash encoder (`geohash_encode(lat, lon, precision=6) -> str`), for the `first_in_area` dedup cell.
- `backend/app/consensus.py` — `recompute_attribute_consensus(session, fountain_id, attribute_type_id)`: derive consensus over non-hidden observations and upsert the `fountain_attribute_consensus` row. Pure decision logic split into a unit-testable `derive_consensus(...)`.
- `backend/app/contributions.py` — the single contribution chokepoint: `points_for(event_type)` (pure), `ContributionSpec` dataclass, and `record_contributions(session, specs)` (idempotent insert via `ON CONFLICT (dedup_key) DO NOTHING RETURNING`, then increment `user_contribution_stats`). Plus the dedup-key builders.

**Modified backend files:**
- `backend/app/models.py` — `RatingType` gets `place_type`; new `AttributeType`, `AttributeObservation`, `FountainAttributeConsensus`, `ContributionEvent`, `UserContributionStats`.
- `backend/app/schemas.py` — `AttributeTypeOut`, `AttributeObservationInput`, `ObserveAttributesRequest`, `AttributeConsensusOut`, `ContributionStatsOut`, `ContributionEventOut`, `MeContributionsOut`; extend `FountainDetail` with `attributes`.
- `backend/app/routers/rating_types.py` — filter `place_type == 'fountain'`.
- `backend/app/routers/fountains.py` — retrofit contribution emission into `add_fountain` + `submit_ratings`; new `POST /fountains/{id}/attributes`; attributes in detail serialization.
- `backend/app/routers/users.py` (or a small new `me` area within it) — `GET /me/contributions` (auth).
- `backend/app/main.py` — `app.include_router(attribute_types.router)` (and confirm any new router is registered; otherwise the endpoint 404s even when implemented).
- `backend/tests/conftest.py` — extend `clean_db` TRUNCATE list with the new tables.
- `backend/migrations/versions/0005_contribution_data.py` — **new** schema migration.
- `backend/migrations/versions/0006_seed_attribute_types.py` — **new** seed migration (mirrors `0003_seed_rating_types`).

**New tests:**
- `backend/tests/test_geohash.py`
- `backend/tests/test_contribution_data_migration.py` — columns, CHECK names+behavior, unique/index names via `pg_constraint`/`pg_indexes`, `rating_types.place_type` backfill.
- `backend/tests/test_attribute_types_seed.py` — seeded rows present, `(place_type,key)` unique, value_kind/category valid.
- `backend/tests/test_consensus.py` — `derive_consensus` matrix (majority, plurality, ties→NULL, unknowns, confidence thresholds, hidden excluded).
- `backend/tests/test_contributions.py` — `points_for`; dedup idempotency; first-X bonus fires once via dedup; stats increment only on actual insert.
- `backend/tests/test_attributes_api.py` — `GET /attribute-types`; `POST /fountains/{id}/attributes` upsert + consensus in detail; auth required; 422 on bad type/value; hidden excluded; concurrency.
- `backend/tests/test_contribution_emission.py` — add/rate emit events + bonuses; re-rate no double-award; stats reflect.
- `backend/tests/test_me_contributions.py` — auth required; caller's own data only.
- Extend `backend/tests/test_rating_types_api.py` (place_type filter) and `backend/tests/test_openapi.py` (new components).

**Frontend:** `packages/api-client` is regenerated (gitignored). After the API tasks, run `./run.ps1 generate`; web/mobile consumption of the new endpoints is **Slice 6**, not this plan.

---

## Interface Reference (shared across tasks)

**`app/geohash.py`** (Task 1):
- `geohash_encode(lat: float, lon: float, precision: int = 6) -> str` — standard geohash base32.

**`app/models.py`** (Task 2):
- `RatingType` adds `place_type: Mapped[str]` (server_default `'fountain'`); `__table_args__` gains `Index("ix_rating_types_place_type", "place_type", "sort_order")`.
- `AttributeType(id: smallint PK no-autoincrement, key: str, place_type: str='fountain', category: str, name: str, description: str, value_kind: str, allowed_values: list[str]|None [JSONB, `Mapped[list | None]`], sort_order: int, is_active: bool=True)`; unique index `uq_attribute_types_place_type` on `(place_type, key)`; CHECK `value_kind` (`value_kind IN ('boolean','enum')`), CHECK `category` (`category IN ('physical','accessibility','access','usability')`); `Index("ix_attribute_types_place_type", "place_type", "is_active", "sort_order")`.
- `AttributeObservation(id: UUID, fountain_id: UUID→fountains CASCADE, user_id: UUID→users CASCADE NOT NULL, attribute_type_id: smallint→attribute_types, value: str, is_hidden: bool=False, hidden_by_user_id: UUID|None→users, hidden_at: datetime|None, created_at, updated_at)`; unique `uq_attribute_observations_fountain_id` on `(fountain_id, user_id, attribute_type_id)`; `Index("ix_attribute_observations_fountain_id_attr", "fountain_id", "attribute_type_id")`.
- `FountainAttributeConsensus(fountain_id: UUID→fountains CASCADE, attribute_type_id: smallint→attribute_types, consensus_value: str|None, confidence: str, yes_count: int, no_count: int, unknown_count: int, value_counts: dict|None [JSONB], observation_count: int, latest_observation_value: str|None, last_observed_at: datetime|None)`; composite PK `(fountain_id, attribute_type_id)`; `Index("ix_fountain_attribute_consensus_attr_value", "attribute_type_id", "consensus_value")`.
- `ContributionEvent(id: UUID, user_id: UUID→users CASCADE, fountain_id: UUID|None→fountains SET NULL, target_type: str|None, target_id: UUID|None, event_type: str, points: int, status: str='awarded', parent_event_id: UUID|None→contribution_events SET NULL, location: <Geography Point|None>, dedup_key: str, is_confirmed: bool=False, event_metadata: dict|None [JSONB], created_at)`; unique `uq_contribution_events_dedup_key` on `(dedup_key)`; CHECK `status` (`status IN ('awarded','reversed')`); `Index("ix_contribution_events_user_id", "user_id", "created_at")`; `Index("ix_contribution_events_event_type", "event_type")`; `Index("ix_contribution_events_target", "target_type", "target_id")`; GiST `Index("ix_contribution_events_location", "location", postgresql_using="gist")`.
- `UserContributionStats(user_id: UUID PK→users CASCADE, total_points: int=0, fountains_added: int=0, ratings_count: int=0, attributes_count: int=0, conditions_reported: int=0, verifications_count: int=0, notes_count: int=0, updated_at)`.

**`app/consensus.py`** (Task 6):
- `@dataclass(frozen=True) class ConsensusResult(consensus_value: str|None, confidence: str, yes_count: int, no_count: int, unknown_count: int, value_counts: dict[str,int]|None, observation_count: int, latest_observation_value: str|None)`.
- `derive_consensus(value_kind: str, observations: list[tuple[str, datetime]]) -> ConsensusResult` — pure; `observations` = (value, created_at) of **non-hidden** rows.
- `async recompute_attribute_consensus(session, fountain_id: UUID, attribute_type_id: int) -> None`.

**`app/contributions.py`** (Task 4):
- `POINTS: dict[str,int]` and `points_for(event_type: str) -> int`.
- `@dataclass class ContributionSpec(user_id: UUID, event_type: str, dedup_key: str, fountain_id: UUID|None=None, location=None, target_type: str|None=None, target_id: UUID|None=None, event_metadata: dict|None=None, parent_event_id: UUID|None=None)`.
- `EVENT_TARGET_TYPES: dict[str, set[str|None]]` — allowed `target_type` per `event_type` (e.g. `add_fountain→{"fountain"}`, `rate→{"rating"}`, `observe_attribute→{"attribute_observation"}`, bonuses→`{None}`). The chokepoint validates each spec's `(event_type, target_type)` pair against this and raises `ValueError` on an unknown event_type or an illegal pair — `target_type` is security-relevant (drives future moderation reversal) so the single writer constrains it.
- `async record_contributions(session, specs: list[ContributionSpec]) -> list[UUID]` — validates each spec (`points_for(event_type)` + `EVENT_TARGET_TYPES` pair check) then inserts via `ON CONFLICT (dedup_key) DO NOTHING RETURNING id, user_id, event_type, points`; increments `user_contribution_stats` **per user** (a batch may span users) by the points + per-type counters of **actually-inserted** events (mapped back via the returned `user_id`); returns inserted event ids. Caller owns the txn.
- Dedup-key builders: `dk_add_fountain(fid)`, `dk_first_fountain(uid)`, `dk_first_in_area(geohash)`, `dk_rate(uid, fid, rtid)`, `dk_first_rating(fid)`, `dk_observe_attr(uid, fid, atid)`.

**`app/schemas.py`** (Tasks 5–8):
- `AttributeTypeOut(id, key, place_type, category, name, description, value_kind, allowed_values: list[str]|None, sort_order)`.
- `AttributeObservationInput(attribute_type_id: int, value: str)`; `ObserveAttributesRequest(observations: list[AttributeObservationInput] = Field(min_length=1))`.
- `AttributeConsensusOut(attribute_type_id, key, name, category, consensus_value: str|None, confidence: str, yes_count, no_count, unknown_count, value_counts: dict|None, observation_count, latest_observation_value: str|None)`.
- `FountainDetail` gains `attributes: list[AttributeConsensusOut]`.
- `ContributionStatsOut(from_attributes)`, `ContributionEventOut(event_type, points, fountain_id, created_at)`, `MeContributionsOut(stats: ContributionStatsOut, recent: list[ContributionEventOut])`.

---

## Task 1: Pure geohash encoder

**Files:** Create `backend/app/geohash.py`, `backend/tests/test_geohash.py`.

- [ ] **Step 1: failing test** — known vectors: `geohash_encode(57.64911, 10.40744, 6) == "u4pruy"`; `geohash_encode(37.7749, -122.4194, 6) == "9q8yyk"` (verify exact value when implementing; assert determinism + length == precision + charset ⊆ `0123456789bcdefghjkmnpqrstuvwxyz`). Two nearby points (<150 m) share a 6-char prefix; two far points differ.
- [ ] **Step 2: run — expect ImportError.**
- [ ] **Step 3: implement** standard geohash (interleave lat/lon bits, base32). ~35 lines, stdlib only.
- [ ] **Step 4: run — pass.** `cd backend; python -m pytest tests/test_geohash.py -v`
- [ ] **Step 5: commit** `feat(geo): pure base32 geohash encoder for contribution area keys`

---

## Task 2: ORM models — place_type + attribute + contribution tables

**Files:** Modify `backend/app/models.py`. (Verified together with the migration in Task 3.)

- [ ] **Step 1:** add `place_type` to `RatingType` (server_default `text("'fountain'")`) + `Index("ix_rating_types_place_type", "place_type", "sort_order")` in `__table_args__`.
- [ ] **Step 2:** add the five models per the Interface Reference. Reuse existing imports (`BigInteger` not needed; `JSONB`, `SmallInteger`, `UniqueConstraint`, `CheckConstraint`, `Index`, `Geography`, `WKBElement` already imported). Key exactness:
  - `AttributeType.id` — `SmallInteger, primary_key=True, autoincrement=False` (stable seed ids, like `RatingType`).
  - Unique `(place_type, key)` via `Index("uq_attribute_types_place_type", "place_type", "key", unique=True)` (mirrors the OSM provenance unique-index style; matches migration name exactly).
  - CHECKs use **short** names: `CheckConstraint("value_kind IN ('boolean','enum')", name="value_kind")` → renders `ck_attribute_types_value_kind`; `CheckConstraint("category IN ('physical','accessibility','access','usability')", name="category")` → `ck_attribute_types_category`. `ContributionEvent` CHECK `name="status"` → `ck_contribution_events_status`.
  - `AttributeObservation` unique via `UniqueConstraint("fountain_id", "user_id", "attribute_type_id", name="uq_attribute_observations_fountain_id")` (explicit full name, matched in migration).
  - `FountainAttributeConsensus` composite PK via two `mapped_column(..., primary_key=True)`.
  - `ContributionEvent.event_metadata: Mapped[dict | None] = mapped_column("event_metadata", JSONB, nullable=True)` — column AND attr both `event_metadata` (NOT `metadata`).
  - `ContributionEvent.parent_event_id` self-FK: `ForeignKey("contribution_events.id", ondelete="SET NULL", name="fk_contribution_events_parent")` (short FK name; convention name would be long but fine — use explicit short to be safe).
  - GiST location index: `Index("ix_contribution_events_location", "location", postgresql_using="gist")`.
- [ ] **Step 3:** lint only — `cd backend; python -m ruff check app/models.py && python -m ruff format --check app/models.py`. (Full verification in Task 3.)
- [ ] **Step 4: commit** `feat(models): place_type + attribute/observation/consensus + contribution-event/stats ORM models`

---

## Task 3: Alembic migration `0005_contribution_data` (schema)

**Files:** Create `backend/migrations/versions/0005_contribution_data.py`; modify `backend/tests/conftest.py` (TRUNCATE); test `backend/tests/test_contribution_data_migration.py`.

- [ ] **Step 1: write the migration.** `revision = "0005_contribution_data"`, `down_revision = "0004_osm_ingestion"`.
  - `op.add_column("rating_types", sa.Column("place_type", sa.String(), server_default=sa.text("'fountain'"), nullable=False))` then `op.create_index("ix_rating_types_place_type", "rating_types", ["place_type", "sort_order"])`. (server_default backfills the 4 seeded rows to `'fountain'`.)
  - `op.create_table("attribute_types", ...)` — `id SmallInteger PK no-autoincrement`, columns per spec; PK name `pk_attribute_types`; CHECKs inline with **SHORT** names: `sa.CheckConstraint("value_kind IN ('boolean','enum')", name="value_kind")` and `sa.CheckConstraint("category IN ('physical','accessibility','access','usability')", name="category")` — the env's `ck` convention renders these to `ck_attribute_types_value_kind` / `ck_attribute_types_category` (same as `ratings.stars_range` in `0002`; a full name double-prefixes); then `op.create_index("uq_attribute_types_place_type", "attribute_types", ["place_type","key"], unique=True)` and `op.create_index("ix_attribute_types_place_type", "attribute_types", ["place_type","is_active","sort_order"])`.
  - `op.create_table("attribute_observations", ...)` — FKs to fountains (CASCADE), users (CASCADE) for `user_id` NOT NULL and `hidden_by_user_id` nullable; `sa.UniqueConstraint("fountain_id","user_id","attribute_type_id", name="uq_attribute_observations_fountain_id")`; then `op.create_index("ix_attribute_observations_fountain_id_attr", "attribute_observations", ["fountain_id","attribute_type_id"])`.
  - `op.create_table("fountain_attribute_consensus", ...)` — composite PK `pk_fountain_attribute_consensus` on `(fountain_id, attribute_type_id)`; FK fountains CASCADE + FK attribute_types; then `op.create_index("ix_fountain_attribute_consensus_attr_value", "fountain_attribute_consensus", ["attribute_type_id","consensus_value"])`.
  - `op.create_table("contribution_events", ...)` — `location` as `geoalchemy2.types.Geography("POINT", 4326, from_text="ST_GeogFromText", name="geography", spatial_index=False)`; FK users CASCADE, FK fountains SET NULL, self-FK `fk_contribution_events_parent` SET NULL; `sa.CheckConstraint("status IN ('awarded','reversed')", name="status")` (SHORT name → renders `ck_contribution_events_status`); `sa.UniqueConstraint("dedup_key", name="uq_contribution_events_dedup_key")` (full explicit name, verbatim); then `op.create_index` for `ix_contribution_events_user_id` (`["user_id","created_at"]`), `ix_contribution_events_event_type`, `ix_contribution_events_target` (`["target_type","target_id"]`), and GiST `op.create_index("ix_contribution_events_location", "contribution_events", ["location"], postgresql_using="gist")`.
  - `op.create_table("user_contribution_stats", ...)` — `user_id` PK + FK users CASCADE; integer counters `server_default text("0")`.
  - `downgrade()` drops all in FK-safe reverse order, then `op.drop_index("ix_rating_types_place_type", ...)` + `op.drop_column("rating_types","place_type")`.
- [ ] **Step 2: extend `conftest.py` TRUNCATE** to prepend the new **non-reference** tables (FK-safe; `CASCADE` is present): `contribution_events, user_contribution_stats, fountain_attribute_consensus, attribute_observations, fountain_import_events, osm_fountain_import_candidates, fountain_provenances, osm_fountain_import_runs, ratings, fountains, users`. **Do NOT truncate `attribute_types` or `rating_types`** — they hold migration-seeded reference rows (`0006`/`0003`) the tests rely on, exactly as `rating_types` is excluded today. Truncating the child tables (`attribute_observations`, `fountain_attribute_consensus`) that FK to `attribute_types` is fine and leaves the reference rows intact.
- [ ] **Step 3: migration verification test** — assert: `rating_types.place_type` exists, NOT NULL, all rows `'fountain'`; each new table's columns + nullability; PK/unique/index names via `pg_indexes`/`pg_constraint`; CHECK names via `pg_constraint` + **negative-insert** behavior tests (illegal `value_kind`, illegal `category`, illegal `status` each raise); `attribute_observations.user_id` NOT NULL; composite PK on consensus; GiST index present on `contribution_events.location` (`pg_indexes.indexdef ILIKE '%gist%'`).
- [ ] **Step 4: apply + drift + tests** — `cd backend; python -m alembic upgrade head && python -m alembic check && python -m pytest tests/test_contribution_data_migration.py -v`. `alembic check` MUST report no drift; reconcile ORM/migration names until clean.
- [ ] **Step 5: downgrade round-trip** — `python -m alembic downgrade -1 && python -m alembic upgrade head && python -m alembic check` (all exit 0). (Note: `0005` downgrade goes to `0004`; reference data from `0006` seed isn't present yet at `0005`, so no data-loss caveat here.)
- [ ] **Step 6: commit** `feat(db): migration 0005 — place_type + attribute/consensus + contribution-event/stats schema`

---

## Task 4: Contribution chokepoint `app/contributions.py`

**Files:** Create `backend/app/contributions.py`, `backend/tests/test_contributions.py`. Depends on Tasks 2–3.

- [ ] **Step 1: failing tests** (`test_contributions.py`):
  - `points_for` returns the §8 defaults; unknown event_type raises `ValueError` (domain validation — the only writer).
  - `record_contributions` rejects an unknown `event_type` AND an illegal `(event_type, target_type)` pair via `EVENT_TARGET_TYPES` (e.g. `rate` with `target_type="fountain"`, or an unknown `target_type` string, raises `ValueError`); a `rate` spec with `target_type="rating"` is accepted.
  - A batch spanning two users increments each user's stats correctly (aggregation keyed by the returned `user_id`, not assumed single-user).
  - `record_contributions` inserts a new event and increments `user_contribution_stats` (creates the row on first contribution).
  - Re-submitting the SAME `dedup_key` inserts nothing and does NOT change `total_points` (idempotency) — returns `[]`.
  - A `first_*` bonus spec submitted twice (same dedup_key) awards once; a different user/fountain awards separately.
  - Stats per-type counters: `add_fountain`→`fountains_added`, `rate`→`ratings_count`, `observe_attribute`→`attributes_count` increment only on actual insert.
- [ ] **Step 2: run — expect ImportError.**
- [ ] **Step 3: implement.**
  - `POINTS = {"add_fountain":10, "first_fountain_bonus":5, "first_in_area_bonus":15, "rate":2, "first_rating_bonus":5, "observe_attribute":2}` (verify-working/report-condition/add-note added in later slices). `points_for` raises `ValueError` on unknown type.
  - `record_contributions`: first validate every spec (`points_for` + `EVENT_TARGET_TYPES` pair check → `ValueError` on bad input). Then build one `pg_insert(ContributionEvent)` per spec (or a single multi-values insert) with `.on_conflict_do_nothing(index_elements=["dedup_key"]).returning(ContributionEvent.id, ContributionEvent.user_id, ContributionEvent.event_type, ContributionEvent.points)`; collect inserted rows; if none, return `[]`. Aggregate inserted points + per-type counts **grouped by the returned `user_id`** (do not assume one user per call); upsert each user's `user_contribution_stats` via `pg_insert(...).on_conflict_do_update(index_elements=["user_id"], set_={col: stats.c.col + increment, "updated_at": func.now()})` (ON CONFLICT increment is race-safe; no SELECT-then-write gap).
  - Map event_type→counter column: add_fountain→fountains_added; rate→ratings_count; observe_attribute→attributes_count; bonuses contribute only to total_points.
  - Dedup-key builders return the §8 strings (e.g. `dk_first_in_area(gh) -> f"first_in_area:{gh}"`).
  - INFO log per call: counts inserted vs deduped, per the logging standard (no PII beyond user_id).
- [ ] **Step 4: run — pass.**
- [ ] **Step 5: commit** `feat(contributions): idempotent contribution-event chokepoint + user stats`

---

## Task 5: Retrofit emission into add_fountain + submit_ratings

**Files:** Modify `backend/app/routers/fountains.py`; test `backend/tests/test_contribution_emission.py`. Depends on Task 4.

- [ ] **Step 1: failing tests:**
  - `POST /fountains` (first ever fountain for the user, in an empty geohash cell) creates `add_fountain` (10) + `first_fountain_bonus` (5) + `first_in_area_bonus` (15) events; `user_contribution_stats.total_points == 30`, `fountains_added == 1`.
  - A second add by the same user in a DIFFERENT cell: `add_fountain` (10) + `first_in_area_bonus` (15) but NO second `first_fountain_bonus` (dedup) → +25.
  - A second add by a DIFFERENT user in an ALREADY-seeded cell: `add_fountain` (10) only (no first_in_area) → +10.
  - `POST /fountains/{id}/ratings` with 2 dimensions on a fresh fountain: 2×`rate` (4) + `first_rating_bonus` (5) → +9; re-submitting the same 2 dimensions awards 0 more (dedup); a 3rd new dimension awards +2.
  - Inline ratings on add also emit `rate` + `first_rating_bonus`.
  - Imported (`created_source!='user'`) fountains: adding a rating to one still emits the rater's events normally (rating an OSM fountain is a real user contribution) — but the OSM row itself awarded nobody (no add_fountain event exists for it). Assert no orphan/`NULL`-user events.
  - **Target linkage:** emitted `rate` events have `target_type='rating'` and a non-null `target_id` equal to the actual `ratings.id` row; the `add_fountain` event has `target_type='fountain'`, `target_id=fountain.id`. (Asserted so future confirmation/moderation can find the exact source row — spec §6.6.)
- [ ] **Step 2: run — expect failure.**
- [ ] **Step 3: implement.** First modify `_upsert_ratings` to **`RETURNING (rating_type_id, id)`** on its `ON CONFLICT DO UPDATE` (it already dedupes within-request, so the conflict updates the existing row and returns its id) and return that `dict[int, UUID]` (rating_type_id → ratings.id) to callers — this is the durable `target_id` for each `rate` event. In `add_fountain`, after the fountain + inline ratings are flushed (within the existing txn, before commit), build specs: `add_fountain` (target_type='fountain', target_id=fountain.id, location=point), `first_fountain_bonus` (dedup `first_fountain:{user_id}`), `first_in_area_bonus` (dedup from `geohash_encode(lat,lng,6)`), plus one `rate` spec per inline rating (target_type='rating', `target_id` from the upsert mapping, event_metadata `{"rating_type_id":...}`) + `first_rating_bonus`. Call `record_contributions`. In `submit_ratings`, after `_upsert_ratings` + `recompute_fountain_ranking` (under the existing `FOR UPDATE`), build `rate` specs (one per submitted dimension, each with its returned `target_id`) + `first_rating_bonus` and call `record_contributions`. The dedup keys make re-rates/bonuses idempotent automatically — **no first-detection query**. (Existing add/rate tests must still pass — `_upsert_ratings`'s external behavior is unchanged apart from the added return value.)
  - **Accepted limitation (document in code + plan):** first-X bonuses are forward-only — users who added their first fountain or a fountain's first rating *before* this slice shipped have no historical event, so a subsequent action MAY award a first-X bonus late. Acceptable pre-launch; no backfill (per spec).
- [ ] **Step 4: run — pass** (incl. existing `test_fountains_add.py`/`test_ratings_api.py` unaffected).
- [ ] **Step 5: commit** `feat(fountains): emit contribution events from add + rate paths`

---

## Task 6: Attribute consensus `app/consensus.py`

**Files:** Create `backend/app/consensus.py`, `backend/tests/test_consensus.py`. Depends on Tasks 2–3.

- [ ] **Step 1: failing tests** for `derive_consensus` (pure):
  - boolean: 3 yes / 0 no → `consensus_value="yes"`, `confidence="high"`; 2 yes / 1 no → "yes"/"medium"; 1 yes/0 no → "yes"/"low"; **1 yes / 1 no → `consensus_value=None`, `confidence="mixed"`, `latest_observation_value` = the most-recent of the two**; all-unknown → `None`/`none`; 0 obs → `None`/`none`. Unknowns counted in `unknown_count`/`observation_count` but never decide.
  - enum: plurality wins with thresholds; top-two tie → `None`/`mixed`; `value_counts` populated.
  - `latest_observation_value` ignores unknowns and is independent of the winner.
  - `recompute_attribute_consensus` (DB): writing observations then recomputing upserts the consensus row; a hidden observation is EXCLUDED (flip a row `is_hidden=true`, recompute, assert counts drop).
- [ ] **Step 2: run — expect failure.**
- [ ] **Step 3: implement** `derive_consensus` per spec §6.3 (thresholds as module constants `MIN_HIGH_COUNT=3`, `HIGH_RATIO=0.75`, `MED_MIN_COUNT=2`, `MED_RATIO=0.6`); ties (boolean equal, or enum top-two equal) → `consensus_value=None, confidence="mixed"`. `recompute_attribute_consensus` selects non-hidden `(value, created_at)` for the pair, calls `derive_consensus`, upserts the consensus row (`pg_insert(...).on_conflict_do_update` on the composite PK). DEBUG-log counts.
- [ ] **Step 4: run — pass.**
- [ ] **Step 5: commit** `feat(consensus): attribute consensus derivation + denormalized recompute`

---

## Task 7: Attribute types API + observation write

**Files:** Modify `backend/app/schemas.py`, `backend/app/routers/rating_types.py`, `backend/app/routers/fountains.py`; new `backend/app/routers/attribute_types.py` (mirrors `rating_types.py`); tests `test_attribute_types_seed.py`, `test_attributes_api.py`; extend `test_rating_types_api.py`. Depends on Tasks 4 & 6.

- [ ] **Step 1: seed migration `0006_seed_attribute_types`** (mirror `0003`): bulk-insert ONLY the §6.1 **physical + accessibility** rows (stable ids, `place_type='fountain'`, all `value_kind='boolean'`): `bottle_filler`, `dual_height`, `lower_spout` (physical); `wheelchair_reachable`, `step_free_approach`, `clear_approach_space`, `push_button_usable` (accessibility). **The access-category rows (`access_kind`, `indoor_outdoor`, `venue_type`, `hours_dependent`, `requires_entry`, `seasonal`) are deferred to Slice 4 (#42)** — this matches the Goal + Out-of-scope sections; resolves plan-review-2. (The enum consensus path is still unit-tested in `test_consensus.py` via `derive_consensus`; it just isn't exercised through the API until Slice 4 seeds the first enum attribute.) `down_revision="0005_contribution_data"`. Verify via `test_attribute_types_seed.py` (the 7 rows present; `(place_type,key)` unique; every `value_kind`/`category` legal; all slice-1 rows boolean with null `allowed_values`).
- [ ] **Step 2: `GET /attribute-types`** — new `backend/app/routers/attribute_types.py` (mirror `rating_types.py`) filtering `place_type=='fountain'` and `is_active`, ordered by `sort_order`; `AttributeTypeOut`. **Register it in `backend/app/main.py`** (`app.include_router(attribute_types.router)`). Test the endpoint returns the seeded set.
- [ ] **Step 3: `rating_types` filter (read + write)** — `GET /rating-types` filters `place_type=='fountain'` (pin with a test: insert a non-fountain rating_type row, assert excluded from the list). **AND** update `_validate_rating_types` in `fountains.py` to require the submitted ids be `place_type=='fountain'` (not merely "known"), so a restroom dimension can't be applied to a fountain — test: a non-fountain `rating_type_id` on `POST /fountains/{id}/ratings` → 422.
- [ ] **Step 4: `POST /fountains/{id}/attributes`** (auth) — load fountain `FOR UPDATE` with `is_hidden` filter (404 if missing/hidden); validate each `attribute_type_id` **exists, is active, AND is `place_type=='fountain'`** and `value` is legal for its `value_kind` (`yes`/`no`/`unknown` for boolean; in `allowed_values` or `unknown` for enum) — else 422 with WARNING log (service-layer branch); upsert observations via `pg_insert(...).on_conflict_do_update` on `(fountain_id,user_id,attribute_type_id)` set value+updated_at **`RETURNING (attribute_type_id, id)`** (the durable `target_id`); `recompute_attribute_consensus` per affected attribute; emit `observe_attribute` specs (target_type='attribute_observation', `target_id` from the upsert mapping, event_metadata `{"attribute_type_id":...}`, dedup `attr:{user_id}:{fountain_id}:{attribute_type_id}`); commit; return updated `FountainDetail`.
- [ ] **Step 5: API tests** (`test_attributes_api.py`): upsert reflected in consensus; editing replaces the user's value (no dup, consensus updates); two users → consensus/confidence; unknown stored, doesn't decide; **auth required (401/seam)**; 404 hidden fountain; 422 unknown type id; 422 illegal value for kind; **422 for a non-fountain (`place_type!='fountain'`) attribute_type_id**; emitted `observe_attribute` event has non-null `target_id` = the observation row id; concurrency (two users observe same attr concurrently serialize — extend the existing `FOR UPDATE` test pattern); contribution event emitted once (re-observe no double-award).
- [ ] **Step 6: run + commit** `feat(attributes): attribute-types API, observation upsert, consensus + emission`

---

## Task 8: Attributes in fountain detail

**Files:** Modify `backend/app/schemas.py` (FountainDetail), `backend/app/routers/fountains.py` (`serialize_fountain_detail`); extend `test_fountains_detail.py`. Depends on Task 7.

- [ ] **Step 1: failing test** — `GET /fountains/{id}` returns `attributes`: **only attribute_types that have a consensus row** (observed at least once), each with value/confidence/counts. Unobserved types are omitted — clients get the complete registry from `GET /attribute-types`. Test: observe one attribute → it appears in detail; an unobserved type does not.
- [ ] **Step 2: implement** — join `fountain_attribute_consensus` × `attribute_types` for the fountain, map to `AttributeConsensusOut`, attach to `FountainDetail`.
- [ ] **Step 3: run — pass.**
- [ ] **Step 4: commit** `feat(fountains): surface attribute consensus in fountain detail`

---

## Task 9: `GET /me/contributions` (auth)

**Files:** Modify `backend/app/routers/users.py` (+ schemas); test `test_me_contributions.py`. Depends on Task 4.

- [ ] **Step 1: failing tests** — auth required (no seam user → 401); returns the caller's `user_contribution_stats` (zeros if none yet) + the caller's recent events (most recent N, e.g. 20), ordered desc; **never** another user's data (seed two users' events, assert isolation).
- [ ] **Step 2: implement** `GET /me/contributions` using `get_current_user`; `MeContributionsOut`. Auth-required read (the only authenticated read in this slice).
- [ ] **Step 3: run — pass.**
- [ ] **Step 4: commit** `feat(me): authenticated GET /me/contributions (caller's own stats + recent events)`

---

## Task 10: Full check, OpenAPI, api-client regen

- [ ] **Step 1:** extend `test_openapi.py` — new paths (`/attribute-types`, `/fountains/{id}/attributes`, `/me/contributions`) + components (`AttributeTypeOut`, `AttributeConsensusOut`, `MeContributionsOut`, request bodies) present; `FountainDetail` has `attributes`.
- [ ] **Step 2:** `./run.ps1 check -Backend` — full backend mirror green (ruff + format + `alembic upgrade head` + `alembic check` no-drift + pytest).
- [ ] **Step 3:** `./run.ps1 generate` to regenerate `packages/api-client` from the new OpenAPI (gitignored output; confirms the schema generates cleanly). Do NOT attempt web/mobile checks locally (broken `node_modules`) — CI covers them; this slice ships no web/mobile code.
- [ ] **Step 4: commit** `test(api): OpenAPI assertions for contribution-data endpoints` (+ any fixups).

---

## Definition of done (Slice 1)

- All tasks' tests pass; `./run.ps1 check -Backend` green (incl. `alembic check` no-drift).
- New endpoints behave per spec; aggregates exclude hidden rows; contribution events idempotent; emission retrofit live on add/rate.
- PR opened on `feat/contribution-data-foundation`; CI green; **Codex PR review `VERDICT: APPROVED`**; every PR comment addressed; squash-merge.
- **Forward-only first-X guard (Codex plan-review):** before deploy, query prod for pre-existing **user-added** fountains/ratings (`SELECT count(*) FROM fountains WHERE created_source='user'` and `SELECT count(*) FROM ratings`). If any exist, the first-X bonuses (`first_fountain`, `first_rating`) will award late for those users (no historical events). Decision for this slice: **accept late awards and record it in the handoff** (gamification UI is not live, points are immaterial pre-surfacing); a one-off backfill of baseline `contribution_events` is a documented option if we later want exactness. Record the actual counts in the handoff.
- Deploy via CI (migrations `0005`/`0006` apply in the deploy); probe `GET /api/v1/attribute-types` live; verify a sample attribute upsert + `/me/contributions` against prod (or staging) per the spec.
- Update `handoffs/` with the slice outcome + next slice (#40 status/verification).

## Out of scope (later slices, per spec §13)

#40 conditions/verification + `current_status`; #41 notes; #42 access-context attribute seeds + `placement_note`; #43 filters on bbox/nearby; #39 capture UI (web+mobile); gamification surfacing (badges, leaderboards, profile/local progress, confirmation bonuses, moderation reversal endpoints); #44 place generalization migration. The schema hooks for all of these (hidden fields, `target_type`/`target_id`/`parent_event_id`/`status`, `place_type`) exist now so they need no backfill.
