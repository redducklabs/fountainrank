# FountainRank — Contribution Data & Gamification-Ready Foundation

**Status:** Approved (Codex spec-review loop A — review-3 `VERDICT: APPROVED`)
**Date:** 2026-06-22
**Owner:** Aron Weiler (Red Duck Labs)
**Extends:** `docs/specs/2026-06-16-architecture-and-foundation-design.md` (§6 data model, §8 ranking, §9 API, §13 moderation)
**Covers issues:** #38 (attributes), #39 (capture flow), #40 (operational status/verification), #41 (notes/reviews), #42 (access context), #43 (filters), #44 (extensible place ratings) — **plus** the gamification layer captured in `temp/gameification/` (concept + design-plan), which has no issue yet.

---

## 1. Summary

Today a fountain carries a single `is_working` boolean, a free-text `comments`, and four subjective star dimensions (Clarity, Taste, Pressure, Appearance). ~360 imported San Diego fountains are live but **shallow** — unrated, unverified, no structured attributes. This spec designs the **contribution data model** that turns shallow pins into **trustworthy, multi-dimensional, time-aware, filterable** data, and designs it so a **gamification layer ("Water Scouts")** sits on top **without repainting the schema later**.

The design is anchored on three reusable pillars:

1. **Observations** — per-user, per-target, structured statements, with provenance and upsert semantics. Star ratings are already observations (the `ratings` table). We generalize the pattern to **attributes** (#38, #42) and **conditions** (#40), and add **notes** (#41) as a sibling.
2. **Consensus** — a derived, denormalized aggregate per (fountain, attribute) and a derived current operational status, so the map/detail/filters read fast and can express uncertainty ("likely yes", "mixed reports").
3. **Contribution events** — an append-only, idempotent log of every accepted, point-worthy contribution, carrying location and a points value. This is the **gamification substrate**: points, badges, first-X bonuses, local progress, and leaderboards all derive from it. It is built from day one so no backfill is ever needed.

A fourth, cross-cutting decision: **place-type scoping** (#44). Rating-type and attribute-type definitions gain a `place_type` discriminator (default `fountain`) so bathroom/restroom support can be added later by adding definition rows + a place table, **reusing the contribution logic** above — the only later cost is a mechanical schema generalization (`fountain_id → place_id`), not a logic rewrite (see §5).

This spec is the **design**. Implementation is decomposed into shippable slices (§13); the first slice (backend foundation) gets its own dated plan and is the immediate build target.

---

## 2. Goals and non-goals

### Goals
- Capture structured **attributes** (bottle filler, dual-height, wheelchair-reachable, lower spout, step-free, clear approach, push-button) as first-class typed observations with yes/no/unknown values, per-user provenance, and a derived consensus that preserves conflict (#38).
- Capture time-sensitive **operational status / verification** (still-working, broken/no-water, low pressure, dirty, blocked, seasonal, hours-dependent) distinct from stable attributes, with a derived current status and `last_verified_at` (#40).
- Capture **access context** (public/restricted, indoor/outdoor, venue type, hours-dependent, requires-entry, placement note, seasonal) as access-category attributes (#42).
- Add first-class **notes/reviews** tied to a user+fountain, moderation-ready, independent of aggregate rating logic (#41).
- Add **discovery filters** on bbox/nearby for status, attributes, and access, with defined unknown-handling (#43).
- Make the contribution **logic reusable for other place types** (bathrooms) so adding them is a mechanical schema generalization (`fountain_id → place_id`), not a logic rewrite (#44).
- Make every contribution **emit a contribution event** so the gamification layer (points, badges, first-X bonuses, local progress, leaderboards) can be built later with zero backfill, with **anti-farming safeguards** designed in.
- Preserve the existing ranking/aggregate behavior and the existing public/auth split.

### Non-goals (this spec / first slices)
- Building the full gamification **UI** (badge shelf, leaderboard screens, quests, profile progress) — we build the **data substrate + emission** now and a minimal profile-stats read; surfacing is a later slice.
- Photos (#Phase 4 / separate), moderation queue UI (#10–#13) — we make notes/attributes/conditions **moderation-ready** (hidden flags, ownership, timestamps) but do not build the admin queue here.
- Actually creating bathroom places — #44 is a **design-only** decision here.
- Tag→attribute mapping from OSM `source_tags` — deliberately deferred (the ingestion spec §4.3 already notes this); the model is built so a later pass can populate attribute observations with `source = 'osm_import'`.

---

## 3. What we carry forward vs. what we add

| Carry forward (unchanged) | Add |
|---|---|
| `users`, `fountains`, `rating_types`, `ratings` (incl. the `(fountain,user,rating_type)` upsert + 1–5 CHECK) | `attribute_types` registry (rows, not columns) |
| `fountains` denormalized `average_rating`/`rating_count`/`ranking_score`/`last_rated_at` + `app/ranking.py` | `attribute_observations` (per user/fountain/attribute, upsert) |
| Existing nearby/bbox/detail/add/rate endpoints + their concurrency model (advisory lock on add; `FOR UPDATE` on rate) | `fountain_attribute_consensus` (denormalized aggregate) |
| OSM provenance/import machinery | `condition_reports` (append-only, time-sensitive) + derived `current_status`/`last_verified_at` on `fountains` |
| Public-read / auth-write split | `fountain_notes` (one current note per user/fountain, moderation-ready) |
| Hand-written Alembic migrations with strict ORM↔migration name parity | `contribution_events` (append-only, idempotent) + `user_contribution_stats` (denormalized) |
| | `place_type` column on `rating_types` + `attribute_types` (default `fountain`) |

The existing `Fountain.is_working` and `Fountain.comments` are **kept**: `is_working` becomes the **baseline/seed** condition (the add-time claim and the import default), and `current_status` is derived from recent `condition_reports` layered over it (§6.3). `comments` remains the **add-time/owner note**; multi-user feedback moves to `fountain_notes` (§6.4). Issue #41 explicitly wants `comments` kept for add-time notes — so we keep it and do not migrate it.

---

## 4. Design principles (from the issues + gamification docs)

- **Observation vs. fact.** A *fact about the physical fountain that rarely changes* (bottle filler present, dual-height) is an **attribute** → one upsert per user, consensus aggregate. A *fact about the fountain's current state* (it's broken today) is a **condition** → append-only, recency-weighted. Don't conflate them.
- **Never overstate crowd input.** Every aggregate carries counts so the UI can say "likely yes (4 of 5)" or "mixed reports", never a bare boolean from one writer.
- **Unknown is a first-class value.** Users are never forced to guess; `unknown` observations are stored (they're signal) but don't count toward positive consensus.
- **Quality over volume (gamification).** Points attach to *accepted, deduplicated, distinct* contributions — re-rating the same dimension does not farm points; confirmation by a second user can grant a bonus; duplicates and unverified-by-proximity actions are capped.
- **Extensible without migrations.** New attributes/access fields = new `attribute_types` rows + (optionally) seed migration; no schema change per attribute. New place types reuse the definition-scoped logic but still require the one-time Slice-8 mechanical place-key migration (`fountain_id → place_id`) — see §5.
- **Read-fast, write-correct.** Map/filters read denormalized consensus + denormalized fountain status; writes recompute within the same transaction under the existing per-fountain locking discipline.

---

## 5. Place-type generalization decision (#44)

**Decision: scope definitions by `place_type` now; defer a generalized `places` table.**

- Add `place_type TEXT NOT NULL DEFAULT 'fountain'` to `rating_types` and `attribute_types`. All current rows are `fountain`. Bathroom dimensions (Cleanliness, Odor, Privacy, …) and bathroom attributes (baby-changing, gendered, …) become rows with `place_type = 'restroom'` when that product ships.
- The **observation / consensus / condition / note / contribution-event** *logic* is place-type-agnostic (it operates on a place id + a definition id; the definition carries the place type). **Honest limitation (Codex finding):** the physical tables still FK to `fountains` via `fountain_id`, so adding a second place type WILL require a **mechanical column-generalization migration** (`fountain_id → place_id`, add a place table/discriminator) — but that is a rename-and-repoint migration, **not a redesign** of the rating/attribute/consensus/condition/note/event logic. This is what satisfies #44's acceptance ("no major rewrite of ratings, attributes, moderation, notes, import provenance"): the algorithms are untouched; only the FK target generalizes. That migration is scoped as Slice 8.
- We do **not** rename `fountains` → `places` now. Rationale: a rename is a large, risky migration touching every FK, index, the OSM provenance machinery, and both clients, for zero current user value. The `place_type` scoping already satisfies #44's acceptance ("bathroom support can be added later without a major rewrite of ratings, attributes, moderation, notes, or import provenance"). The documented future path: when a second place type ships, introduce a `places` table (or a `place_kind` column + table partition) and migrate `fountains` to be a typed view/subset; the definition-scoping built now means rating/attribute/condition/note/event code keys off the definition's `place_type`, so the Slice-8 generalization is a schema migration, not a logic rewrite.
- API + `rating_types`: discovery responses gain no `place_type` field yet (everything is a fountain). `place_type` is added to `rating_types` with `server_default 'fountain'` (the existing four rows backfill automatically); the existing `GET /rating-types` is updated to filter `place_type = 'fountain'` (so future restroom dimensions never leak into fountain clients) and a test pins this. Index `(place_type, sort_order)` on `rating_types`; `attribute_types` likewise filters `place_type='fountain'` in `GET /attribute-types`.

This is the cheapest change that keeps the door open: the design decision is documented (#44 acceptance), the logic is reusable, and the future generalization is a scoped, mechanical migration (Slice 8) rather than an open-ended rewrite.

---

## 6. Data model

All new tables follow the repo conventions: UUID PKs (`default uuid4`), `timezone=True` timestamps with `server_default now()`, the `NAMING_CONVENTION` from `models.py`, GiST geography where spatial, and **strict ORM↔migration name parity** (constraint/index names must match exactly or `alembic check` fails — see the `stars_range`/`created_source` short-name trap documented in `models.py`). New tables must also be added to the `TRUNCATE` list in `tests/conftest.py`.

### 6.1 `attribute_types` (registry — #38, #42)

Defines what attributes exist. Rows, not columns, so new attributes need no schema migration (a data-only seed migration adds rows).

| Column | Type | Notes |
|---|---|---|
| `id` | smallint PK, **not** autoincrement | stable seed ids (like `rating_types`) |
| `key` | text | stable machine key, e.g. `bottle_filler`, `wheelchair_reachable`, `access_kind`, `indoor_outdoor`; unique **per place type** (see constraints) |
| `place_type` | text, not null, default `'fountain'` | §5 |
| `category` | text, not null | `physical` \| `accessibility` \| `access` \| `usability` — drives UI grouping & default filters |
| `name` | text, not null | display label |
| `description` | text, not null | help text |
| `value_kind` | text, not null | `boolean` (yes/no/unknown) \| `enum` (one of `allowed_values`) |
| `allowed_values` | JSONB, nullable | for `enum`: ordered list of canonical values (e.g. `["public","customer_only","restricted"]`); null for `boolean` |
| `sort_order` | int, not null | |
| `is_active` | bool, not null, default true | retire an attribute without deleting history |

Constraints: **unique `(place_type, key)`** (convention name `uq_attribute_types_place_type`) — `indoor_outdoor` can exist for both fountains and restrooms without prefixing; CHECK `value_kind IN ('boolean','enum')` (short name `value_kind`); CHECK `category IN ('physical','accessibility','access','usability')` (short name `category`). Index `(place_type, is_active, sort_order)` for the list endpoint. (Short CHECK/unique names per the repo's `ck_%(table)s_%(name)s` / `uq_%(table)s_%(col0)s` convention — see `models.py`; passing a full name double-prefixes.)

Initial seed (`place_type='fountain'`):
- **physical:** `bottle_filler` (bool), `dual_height` (bool), `lower_spout` (bool).
- **accessibility:** `wheelchair_reachable` (bool), `step_free_approach` (bool), `clear_approach_space` (bool), `push_button_usable` (bool — "is the push-button/lever usable?"; resolved to boolean for consensus simplicity).
- **access:** `access_kind` (enum: `public`/`customer_only`/`restricted`), `indoor_outdoor` (enum: `indoor`/`outdoor`), `venue_type` (enum: `park`/`school`/`transit`/`trail`/`building`/`playground`/`restroom_area`/`store`/`other`), `hours_dependent` (bool), `requires_entry` (bool), `seasonal` (bool).
- Free-text `placement_note` (#42, e.g. "near restrooms") is **not** an attribute_type (free text has no meaningful consensus) and is **deferred to the access-context slice (#42)**, where it will be resolved as either a single nullable `placement_note` column on `fountains` (most-recent-observer wins) or a structured field on a note. It is out of scope for slice 1.

### 6.2 `attribute_observations` (per-user — #38, #42)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `fountain_id` | uuid FK→fountains (CASCADE) | |
| `user_id` | uuid FK→users (CASCADE), **not null** | every observation in slice 1 is a user observation (see import note) |
| `attribute_type_id` | smallint FK→attribute_types | |
| `value` | text, not null | `yes`/`no`/`unknown` for boolean; one of `allowed_values` (or `unknown`) for enum |
| `is_hidden` | bool, not null, default false | moderation — hidden rows are **excluded** from consensus recompute |
| `hidden_by_user_id` | uuid FK→users, nullable | audit |
| `hidden_at` | timestamptz, nullable | audit |
| `created_at`, `updated_at` | timestamptz | |

Constraints: **unique `(fountain_id, user_id, attribute_type_id)`** (convention name `uq_attribute_observations_fountain_id`; one current observation per user per attribute; upsert to edit — mirrors `ratings`). Index `(fountain_id, attribute_type_id)` for consensus recompute. Value validation (is `value` legal for the type's `value_kind`/`allowed_values`) is enforced in the **service layer** (like `_validate_rating_types`), not a DB CHECK (values are dynamic per type).

**`user_id` is NOT NULL in slice 1** — this removes the NULL-dedup ambiguity Codex flagged. The deferred OSM tag→attribute pass (§2 non-goals) adds the import path *then*, not now: a nullable `user_id` + a `source` column with CHECK `source IN ('user','osm_import')` and CHECK `source <> 'user' OR user_id IS NOT NULL` (mirroring `fountains.created_source`), plus a **partial unique index** `(fountain_id, attribute_type_id) WHERE source = 'osm_import'` so an import contributes at most one observation per attribute and is deterministically de-duped on refresh. Designed there, built there.

**Moderation interplay:** consensus (§6.3) reads only `WHERE is_hidden = false`. Hiding an observation (admin moderation #12, or cascaded from user-blocking #10) MUST trigger a consensus recompute for the affected `(fountain, attribute_type)` so the public aggregate stops reflecting the hidden row — `consensus.py` is therefore called from BOTH the write path and the moderation path.

### 6.3 `fountain_attribute_consensus` (denormalized — #38, #43)

Recomputed on every observation write **and on moderation hide/unhide** for that (fountain, attribute), inside the same transaction (mirrors `recompute_fountain_ranking`). The recompute reads only non-hidden observations (`WHERE is_hidden = false`).

| Column | Type | Notes |
|---|---|---|
| `fountain_id` | uuid FK→fountains (CASCADE) | composite PK part |
| `attribute_type_id` | smallint FK→attribute_types | composite PK part |
| `consensus_value` | text, nullable | derived majority/plurality of non-unknown observations; null if no non-unknown observations |
| `confidence` | text, not null | `none` \| `low` \| `medium` \| `high` \| `mixed` (see rule) |
| `yes_count`/`no_count`/`unknown_count` | int (boolean kinds) | for enums, see `value_counts` |
| `value_counts` | JSONB, nullable | for enum kinds: `{value: count}` of non-unknown observations |
| `observation_count` | int, not null | total incl. unknown (non-hidden) |
| `latest_observation_value` | text, nullable | most-recent non-unknown value — for UI display only, **never used by filters** |
| `last_observed_at` | timestamptz, nullable | |

PK = `(fountain_id, attribute_type_id)`. Index `(attribute_type_id, consensus_value)` for filter queries (§9).

**Consensus rule (deterministic, documented):** Let non-unknown, non-hidden observations be the deciding set.
- 0 non-unknown → `consensus_value = NULL`, `confidence = none`.
- **Ties never set a filterable winner (Codex finding).** If the top value is tied (boolean `yes_count == no_count > 0`, or an enum top-two tie) → `consensus_value = NULL` and `confidence = mixed`. Because filters match only a definite `consensus_value` (§9), a 1-yes/1-no fountain can **never** satisfy `bottle_filler=true`. The most-recent value is preserved separately in `latest_observation_value` for UI ("mixed reports — latest: yes") and is never used by filters.
- Boolean (no tie): `consensus_value` = majority of yes/no; confidence scales with agreement ratio and count: `high` if winner ≥ 3 and ratio ≥ 0.75; `medium` if winner ≥ 2 and ratio ≥ 0.6; else `low`.
- Enum (no tie): `consensus_value` = plurality value; confidence by the plurality's share and count (same thresholds).
- Thresholds (`min_high_count`, ratios) are module constants in a single `consensus.py`, documented and unit-tested; tunable later.

### 6.4 `condition_reports` (append-only, time-sensitive — #40)

Distinct from attributes: a fountain's working state changes over time, so reports are **events**, not upserts, and recency matters.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `fountain_id` | uuid FK→fountains (CASCADE) | |
| `user_id` | uuid FK→users (CASCADE) | |
| `status` | text, not null | `working` \| `broken` \| `low_pressure` \| `dirty` \| `bad_taste` \| `blocked` \| `seasonal_unavailable` \| `hours_limited` |
| `is_proximate` | bool, not null, default false | client asserted GPS proximity at report time (gamification proximity guard, §10) — **server does not yet verify**; stored for later trust weighting (documented limitation) |
| `is_hidden` | bool, not null, default false | moderation — hidden rows **excluded** from status recompute |
| `hidden_by_user_id` | uuid FK→users, nullable | audit |
| `hidden_at` | timestamptz, nullable | audit |
| `created_at` | timestamptz | |

CHECK on `status` enum (short name `status`). Index `(fountain_id, created_at desc)` for recency aggregation.

**Derived status (denormalized on `fountains`):** add `current_status TEXT` (nullable) and `last_verified_at TIMESTAMPTZ` (nullable) to `fountains`, recomputed (over non-hidden reports) on each report inside the txn. Status is computed over a configurable **freshness window** (default 90 days, setting `condition_freshness_days`) and is **corroboration-gated so one actor cannot flip the public pin (Codex finding):**
- `last_verified_at` = most recent `working` report's `created_at`.
- `current_status` ∈ {`ok`, `reported_issue`, `degraded`, `not_working`, NULL}:
  - **Symmetric corroboration (Codex review-2):** EVERY authoritative state — `ok`, `degraded`, AND `not_working` — requires **≥`condition_corroboration_min` distinct users** (default 2) supporting that state among the most-recent in-window reports. The authoritative `current_status` is the corroborated state with the most recent corroborating activity, breaking ties by severity. This applies to recovery too: a corroborated outage is cleared to `ok` **only when ≥2 distinct users** report `working` more recently — a single `working` report can NOT flip a corroborated outage back to working (it only updates `last_verified_at`). One actor cannot flip the public pin in either direction.
  - A single **uncorroborated** outage report (when no corroborated outage is already in effect) yields `current_status = reported_issue` — a softer "issue reported (unconfirmed)" advisory that does **not** flip the pin. A single uncorroborated `working` report against a corroborated outage leaves the authoritative outage in place.
  - `NULL` when there is no corroborated signal in-window → the pin falls back to baseline `is_working` (a `reported_issue` advisory may still be surfaced alongside the baseline).
- The public map pin's working/not-working presentation changes from baseline `is_working` only when `current_status` is **authoritative** (`ok`/`not_working`/`degraded`); `reported_issue` is surfaced as an advisory badge, not a status flip. `is_proximate` is client-asserted and is **not** used as trust input (documented limitation; server-side proximity verification is future work).
- The bbox/nearby payload gains `current_status` + `last_verified_at` (additive, optional fields — existing clients ignore them). Exact rule lives in `conditions.py`, unit-tested (including the one-bad-actor case), tunable.

(This is Slice 2 work; specified here so the model is coherent. Recency/trust weighting beyond distinct-user corroboration remains a documented future enhancement.)

### 6.5 `fountain_notes` (#41)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `fountain_id` | uuid FK→fountains (CASCADE) | |
| `user_id` | uuid FK→users (CASCADE) | |
| `body` | text, not null | Pydantic-validated **1–1000 chars** (min 1 after strip, max 1000), enforced in the request schema + tested |
| `is_hidden` | bool, not null, default false | moderation |
| `hidden_by_user_id` | uuid FK→users, nullable | audit |
| `hidden_at` | timestamptz, nullable | audit |
| `created_at`, `updated_at` | timestamptz | |

**Decision (the open question in #41):** **one current note per user per fountain**, upsert to edit — unique `(fountain_id, user_id)`. Rationale: matches the rating/attribute upsert mental model, reduces spam surface, simpler moderation. Multiple-notes-over-time is a documented future option (drop the unique constraint + add soft-delete). Hidden notes never appear in public reads but remain in the table (auditable). Aggregate rating logic does **not** read notes (acceptance criterion). Index `(fountain_id)` filtered `WHERE is_hidden = false` for the detail read.

### 6.6 `contribution_events` (gamification substrate — new; aligns architecture spec §8 contributor leaderboard)

Append-only log of accepted, point-worthy contributions. **Written in the same transaction as the contribution it records**, so it can never diverge. Built now; surfaced later.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK→users (CASCADE) | |
| `fountain_id` | uuid FK→fountains (SET NULL), nullable | SET NULL so fountain deletion keeps the audit/points record |
| `target_type` | text, nullable | the kind of contribution row this event records: `fountain` \| `rating` \| `attribute_observation` \| `condition_report` \| `note` \| `photo` (future); NULL for pure bonus events |
| `target_id` | uuid, nullable | **durable link to the exact contributing row** (the rating/observation/report/note id) — the source of truth for confirmation ("a 2nd distinct user corroborated target X"), moderation reversal, and accepted-report auditing. Not a hard FK (targets span many tables); integrity enforced in the service layer |
| `event_type` | text, not null | `add_fountain`, `rate`, `observe_attribute`, `report_condition`, `verify_working`, `add_note`, `add_photo` (future), `accepted_report` (future), `first_fountain_bonus`, `first_rating_bonus`, `first_in_area_bonus`, `confirmation_bonus` (future) |
| `points` | int, not null | from the rules module (§10); may be 0 |
| `status` | text, not null, default `'awarded'` | `awarded` \| `reversed`; set `reversed` (and decrement `user_contribution_stats`) when the underlying contribution is moderated/blocked, so points for hidden content are revoked. CHECK `status IN ('awarded','reversed')` (short name `status`) |
| `parent_event_id` | uuid FK→contribution_events (SET NULL), nullable | links a bonus/confirmation event to the event it derives from (e.g. `confirmation_bonus` → the original `observe_attribute`) |
| `location` | geography(Point,4326), nullable | copied from the fountain at write time → enables local leaderboards without a join |
| `dedup_key` | text, not null, **unique** | idempotency / anti-farming key (§10) |
| `is_confirmed` | bool, not null, default false | flips true when a 2nd distinct user corroborates this event's `target` — drives confirmation bonuses |
| `event_metadata` | JSONB, nullable | denormalized detail for badge queries (e.g. `{attribute_type_id, rating_type_id, status}`). **ORM attribute + column are both `event_metadata`** — NOT `metadata` (reserved by SQLAlchemy `Base.metadata`) |
| `created_at` | timestamptz | |

Unique `dedup_key` (convention name `uq_contribution_events_dedup_key`) is the anti-farming spine. Index `(user_id, created_at desc)`; GiST on `location` for local leaderboards; index `(event_type)` for badge queries; index `(target_type, target_id)` for confirmation/moderation lookups. The `target_type`/`target_id`/`parent_event_id`/`status` columns exist from slice 1 (populated by slice-1 emitters where applicable) so confirmation bonuses, accepted-report bonuses, and moderation reversal need **no backfill** when their logic ships in later slices.

**Domain validation (Codex review-2):** `status` gets a DB CHECK (closed 2-value set). `event_type` and `target_type` are **deliberately NOT DB CHECKs** — both domains grow across slices (new event/target types each slice), and a CHECK would force a migration per addition; instead they are validated in the single `contributions.py` chokepoint (the only writer), with unit tests covering accepted values and rejection of unknown ones. This keeps the security-relevant `target_type` (used for moderation reversal) constrained by the one code path that writes it, without per-slice migrations.

### 6.7 `user_contribution_stats` (denormalized — profile/leaderboard read)

Recomputed/incremented on event write (mirrors the ranking denormalization pattern; we use an upsert-increment to avoid recount).

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK FK→users (CASCADE) | |
| `total_points` | int, not null, default 0 | |
| `fountains_added` | int, not null, default 0 | |
| `ratings_count` | int, not null, default 0 | distinct fountain-dimensions rated |
| `attributes_count` | int, not null, default 0 | |
| `conditions_reported` | int, not null, default 0 | |
| `verifications_count` | int, not null, default 0 | |
| `notes_count` | int, not null, default 0 | |
| `updated_at` | timestamptz | |

Badges and richer breakdowns are **derived from `contribution_events`** on demand (a later slice); `user_contribution_stats` is the hot-path profile/leaderboard counter. Keeping both is intentional: the event log is the source of truth, the stats row is the cache.

---

## 7. Aggregation, ranking, and status interplay

- `app/ranking.py` is **untouched** in behavior — star ranking stays as-is.
- A new `app/consensus.py` recomputes `fountain_attribute_consensus` for a single (fountain, attribute) (called after each attribute observation upsert, under the existing per-fountain `FOR UPDATE` discipline extended to attribute/condition writes).
- A new `app/conditions.py` recomputes `current_status`/`last_verified_at` on the fountain after each condition report.
- A new `app/contributions.py` is the single chokepoint that (a) computes points via a pure rules function, (b) inserts the `contribution_events` row with a `dedup_key` (ON CONFLICT DO NOTHING → idempotent), and (c) upsert-increments `user_contribution_stats` **only when the event was actually inserted** (so re-submits don't double-count). Every write path (existing `add_fountain`/`submit_ratings` retrofitted; new attribute/condition/note endpoints) calls it.

Concurrency: attribute/condition/note writes take the same per-fountain `SELECT ... FOR UPDATE` lock as `submit_ratings` before recomputing the relevant denormalized aggregate, so concurrent writers serialize per fountain. Contribution-event insert relies on the `dedup_key` unique index for idempotency independent of the lock.

---

## 8. Contribution event emission map (what earns what)

The points values below are **defaults in one rules module**, tunable; the *structure* is what matters for the schema.

| Action | event_type | dedup_key (idempotency) | points (default) | confirm bonus later? |
|---|---|---|---|---|
| Add a fountain | `add_fountain` | `add_fountain:{fountain_id}` | 10 | — |
| …first ever in a ~1km cell | `first_in_area_bonus` | `first_in_area:{geohash6}` | +15 | — |
| …user's first fountain | `first_fountain_bonus` | `first_fountain:{user_id}` | +5 | — |
| Rate a dimension (per fountain-dimension, first time) | `rate` | `rate:{user_id}:{fountain_id}:{rating_type_id}` | 2 | — |
| First rating on a fountain (by anyone) | `first_rating_bonus` | `first_rating:{fountain_id}` | +5 | — |
| Set/confirm an attribute (per user/fountain/attribute) | `observe_attribute` | `attr:{user_id}:{fountain_id}:{attribute_type_id}` | 2 | yes (2nd-user confirm) |
| Verify working | `verify_working` | `verify:{user_id}:{fountain_id}:{yyyymmdd}` | 3 | — |
| Report a condition | `report_condition` | `cond:{user_id}:{fountain_id}:{yyyymmdd}` | 2 (cap/day) | yes |
| Add/update a note | `add_note` | `note:{user_id}:{fountain_id}` | 2 | — |

Notes:
- **Re-editing** a rating/attribute/note does **not** re-award (dedup_key already exists → ON CONFLICT DO NOTHING). This is the anti-farming guarantee #38/#39/gamification-doc demand.
- **Repeatable** actions (verify/condition) dedup **per day** so a user can re-verify over time but not spam in one session; an additional per-(user,fountain,day) cap is enforced in the rules module.
- `geohash6` ≈ 1.2km cell — good enough for "first in area"; computed in Python from the point (no PostGIS dependency for the key). *Codex: validate cell size / collision behavior.*
- Confirmation bonuses (`is_confirmed` flips when a 2nd distinct user corroborates) are **designed here, implemented in the gamification slice** — the column exists so no backfill.

---

## 9. API surface additions

All additive under `/api/v1`. Public reads; auth writes (existing split). Slice tags in brackets.

**Reads (public):**
- `GET /attribute-types` — list active attribute types for `place_type=fountain` (mirrors `/rating-types`). [Slice 1]
- Extend `GET /fountains/{id}` detail with: `attributes` (list of consensus per type: key, name, category, consensus_value, confidence, counts), `current_status`, `last_verified_at`, and (later) `notes`. [Slice 1 attributes; Slice 2 status; Slice 3 notes]
- Extend `GET /fountains` and `GET /fountains/bbox` pins with optional `current_status`/`last_verified_at` and **filter query params** (`working_now`, `verified_within_days`, `bottle_filler`, `wheelchair_reachable`, `dual_height`, `indoor`, `public_access`, `min_rating`, `min_rating_count`, `include_unknown`). [status in Slice 2; filters in Slice 5]
- `GET /fountains/{id}/notes` — public, non-hidden notes. [Slice 3]

**Authenticated reads (caller's own data only):**
- `GET /me/contributions` — the **caller's own** `user_contribution_stats` + recent events; auth-required, never exposes another user's contribution history. [Slice 1 minimal stats; richer in gamification slice]

**Writes (auth):**
- `POST /fountains/{id}/attributes` — upsert the caller's attribute observations (list of `{attribute_type_id, value}`), validated against the type registry; recompute consensus; emit events. [Slice 1]
- `POST /fountains/{id}/conditions` — append a condition report (`{status, is_proximate}`); recompute current status; emit event. A `verify_working` convenience is `status=working`. [Slice 2]
- `POST /fountains/{id}/notes` — upsert the caller's note (`{body}`); emit event. [Slice 3]
- Extend `POST /fountains` and `POST /fountains/{id}/ratings` to **emit contribution events** (no request-shape change). [Slice 1 — retrofit]

**Filter semantics (#43):** positive attribute filters (e.g. `bottle_filler=true`) match fountains whose **`consensus_value = 'yes'`** (a tie/`mixed` has `consensus_value = NULL` and therefore never matches — §6.3); by default they **exclude** unknown/no-consensus fountains; `include_unknown=true` widens to include `confidence=none`. `working_now=true` matches authoritative `current_status = 'ok'` OR (no in-window reports AND baseline `is_working=true`); it excludes `reported_issue`/`not_working`/`degraded` — documented + tested. **Execution order (correctness, Codex finding):** the spatial predicate AND all attribute/status/rating filters go in the `WHERE` clause; ordering and `LIMIT max_results` are applied **only after every filter** — the cap must never be applied before filtering (that would drop matching fountains just outside an initially-capped set). Filters use joins/`EXISTS` against the consensus table + fountain status columns. Tests prove capped bbox/nearby results stay correct under filtering, across the full unknown-handling matrix.

OpenAPI is the source of truth; `packages/api-client` regenerates from it (existing `./run.ps1 generate`).

---

## 10. Gamification design (captured now; substrate built, UI later)

This section exists so the build never has to repaint. Source: `temp/gameification/{gamification-concept,design-plan-and-approach}.md`.

- **Points** — every contribution emits a `contribution_events` row with points from `app/contributions.py::points_for(...)` (pure function, unit-tested, tunable). Totals cached in `user_contribution_stats`.
- **First-X bonuses** — `first_fountain_bonus`, `first_rating_bonus`, `first_in_area_bonus` are separate events with their own dedup keys (§8), so they're awarded exactly once and are independently auditable.
- **Badges** — **derived**, not stored as schema now: computed from `contribution_events` aggregates (e.g. *Pressure Tester* = ≥10 `rate` events with `event_metadata.rating_type_id = 3`; *Field Verifier* = ≥10 `verify_working`; *Founding Scout* = account `created_at` before a launch cutoff; *Original 100* = among first 100 users by `created_at`). A `badges` definition table + `user_badges` award cache is a **gamification-slice** addition; the events carry enough metadata to compute them with no backfill.
- **Local progress** — computed from spatial queries over `fountains`/`fountain_attribute_consensus`/`condition_reports` within the user's viewport (e.g. "2 mapped here", "3 more verified completes this neighborhood", "needs first rating"). No new schema; a read endpoint in a later slice.
- **Leaderboards** — local boards from `contribution_events.location` (GiST) aggregated by area + time window; global from `user_contribution_stats`. Architecture spec §8 already lists fountain + contributor leaderboards (Phase 5) — this is the data path.
- **Anti-farming safeguards (designed into the substrate):**
  - dedup_key unique index → no double-award on re-edit.
  - per-day dedup + per-(user,fountain,day) cap on repeatable actions (verify/condition).
  - `is_proximate` recorded on condition reports for future server-side proximity verification (documented as **client-asserted only** for now — not a security control yet).
  - confirmation bonus (`is_confirmed`) rewards corroborated contributions over solo ones.
  - duplicate fountains: the existing 409-proximity guard prevents duplicate *fountains*; the add→confirm hook means a near-duplicate add routes to rating the existing one (no full add points for a dup).
  - leaderboards weight by events (accepted contributions), not raw row writes.
  - suspicious bursts: the event log + timestamps make burst detection a later moderation query (no schema needed now).
- **Open product decisions (defaults chosen so the build proceeds; revisit before the gamification UI slice):** contributor name "Water Scouts" (tentative, not user-visible yet); points shown as a number *and* badges (both supported by the data); badges global to start, local/seasonal later; proximity strictness deferred (client-asserted now); founder badges gated by `created_at` cutoff + first-N — all derivable.

---

## 11. Security, privacy, moderation, logging

- **Auth/visibility:** all new writes require the existing auth seam; all new public reads are public; `GET /me/contributions` is auth-required and returns the caller's own data only (never another user's history). Hidden notes never appear in public reads.
- **Validation:** attribute values validated against the registry server-side (reject unknown type ids / illegal values with 422, like `_validate_rating_types`); note bodies length-capped; condition status enum-checked. No user free-text in points/dedup keys.
- **Moderation across aggregates (Codex finding):** `attribute_observations`, `condition_reports`, and `fountain_notes` ALL carry `is_hidden`/`hidden_by_user_id`/`hidden_at`. Aggregates exclude hidden rows — consensus (§6.3) and current-status (§6.4) recompute over `WHERE is_hidden = false` — so a hidden observation stops affecting the public aggregate. **Hiding a contribution MUST trigger the relevant recompute** (consensus for an attribute observation; status for a condition report) **AND reverse its `contribution_events` row** (`status='reversed'`, decrement stats). This wires user-blocking (#10) and admin moderation (#12) so hiding a user's contributions is reflected in public aggregates + points. The admin/blocking endpoints are later slices; the columns + recompute hooks exist now so there is **no leak-by-aggregation gap and no backfill**.
- **PII:** no new PII; `location` on `contribution_events` is the fountain's public location, not the user's.
- **Logging (per repo MANDATORY logging rules):** request/response is covered by existing middleware; the contribution chokepoint logs `event_type`, `user_id`, `fountain_id`, computed `points`, and inserted-vs-deduped at INFO; consensus/status recompute logs at DEBUG with counts. **Domain validation failures are logged explicitly at WARNING in the service-layer validation branches** (unknown `attribute_type_id`, illegal value for the type's `value_kind`) — not relying on middleware for FastAPI/Pydantic 422s. No secrets/PII/full tokens.

---

## 12. Testing strategy

Mirrors the existing backend test suite (pytest + real PostGIS test DB; `alembic upgrade head` + `alembic check` in `run.ps1 check -Backend`).

- **Migration tests** (like `test_schema_migration.py`/`test_osm_ingestion_migration.py`): new tables/columns/constraints exist with exact names; `alembic check` is clean (ORM↔migration parity); downgrade works.
- **Consensus unit tests** (`consensus.py`): boolean majority, enum plurality, ties→mixed, unknown handling, confidence thresholds, single-observer, conflicting observers.
- **Conditions unit tests** (`conditions.py`): freshness window, most-recent-in-window severity, `last_verified_at`, fallback to baseline when stale/empty.
- **Contribution rules unit tests** (`contributions.py`): each event_type's points; dedup (re-edit awards 0/no double count); per-day dedup; first-X bonuses fire once; stats increment only on insert.
- **API tests**: attribute upsert + consensus reflected in detail; condition report changes current_status; note upsert + hidden visibility; filter matrix incl. unknown-handling; auth required on writes; 422 on bad type/value; concurrency (two raters/observers serialize correctly — extend the existing pattern).
- **OpenAPI test** (`test_openapi.py`): new endpoints/schemas present.
- `conftest.py` `TRUNCATE` list updated to include all new tables (order respects FKs / `CASCADE`).

Web/mobile slices add their own type-check/lint/test via CI (local web checks are currently blocked by the broken `node_modules` — backend is locally verifiable, web/mobile via CI; see handoff).

## 13. Implementation slices (decomposition → each its own plan → Codex → PR → deploy)

1. **Slice 1 — Foundation (backend), one PR.** `attribute_types` (+seed), `attribute_observations`, `fountain_attribute_consensus`, `contribution_events`, `user_contribution_stats`, `place_type` on `rating_types`/`attribute_types`; `consensus.py` + `contributions.py`; migration `0005`; `GET /attribute-types`, `POST /fountains/{id}/attributes`, attributes in detail, auth-only minimal `GET /me/contributions`; retrofit event emission into existing add/rate. **Internal task order** (per Codex Q1 — keeps it one coherent PR with no deploy-separated backfill gap): (a) migration + models, (b) `contributions.py` chokepoint, (c) retrofit emission into existing `add_fountain`/`submit_ratings`, (d) attribute types + observations + `consensus.py` + the new endpoints. If it ever must be split across PRs, the contribution-event substrate + add/rate emission ships **first**, before any new contribution endpoint. **This is the immediate build target.**
2. **Slice 2 — Operational status & verification (#40).** `condition_reports`; `current_status`/`last_verified_at` on `fountains`; `conditions.py`; `POST /fountains/{id}/conditions`; status in detail + bbox/nearby.
3. **Slice 3 — Notes/reviews (#41).** `fountain_notes`; notes endpoints; notes in detail.
4. **Slice 4 — Access context (#42).** Seed access-category `attribute_types`; `placement_note` resolution; (reuses Slice 1 machinery — mostly data + minor read shaping).
5. **Slice 5 — Filters (#43).** bbox/nearby filter params + unknown-handling + indexes.
6. **Slice 6 — Capture flow (web + mobile) (#39).** Progressive-disclosure rating+attribute UI; verify/condition/note actions; consume the APIs. (CI-verified; style-guide updated.)
7. **Slice 7 — Gamification surfacing.** `badges`/`user_badges`; confirmation-bonus logic; profile progress, local progress, leaderboards (fountain + contributor, architecture §8 Phase 5).
8. **Slice 8 — Place generalization / bathrooms (#44).** Only when the product is ready; reuses everything.

Each slice: dated plan in `docs/plans/` → Codex `VERDICT: APPROVED` → branch → CI green + Codex PR approved + comments addressed → squash-merge → deploy via CI → verify live.

## 14. Resolved decisions & remaining risks

Resolved in Codex spec-review loop A (review-1):
- **Slice 1 scope** — kept as one coherent PR with the internal task order in §13 (substrate + emission before new endpoints) to avoid a backfill gap.
- **Ties never filter** — tied/mixed consensus sets `consensus_value = NULL`; filters match only definite values (§6.3, §9); `latest_observation_value` carries the UI-only most-recent value.
- **Current-status manipulation** — **symmetric corroboration**: every authoritative state (`ok`/`degraded`/`not_working`, including recovery) requires ≥2 distinct-user corroboration; a single report can't flip a corroborated outage in either direction and instead yields a non-flipping `reported_issue` advisory (§6.4).
- **Moderation across aggregates** — observations/conditions/notes carry hidden fields; aggregates exclude hidden rows; hiding triggers recompute + points reversal (§6.2, §6.4, §6.6, §11).
- **Nullable-user import ambiguity** — `attribute_observations.user_id` is NOT NULL in slice 1; the import path (nullable user + source CHECKs + partial unique index) is designed for the deferred tag-mapping pass (§6.2).
- **`/me/contributions` auth** — moved to authenticated reads, caller's own data only (§9, §11).
- **Event linkage** — `contribution_events` gains `target_type`/`target_id`/`parent_event_id`/`status` so confirmation, accepted-reports, and moderation reversal need no backfill (§6.6).
- **Filter execution order** — all filters in `WHERE`, `LIMIT` applied only after filtering; tested under the cap (§9).
- **place-type generalization** — claim narrowed: logic is reusable; a mechanical `fountain_id→place_id` migration (Slice 8) is accepted, not a redesign (§5).
- **Bikesheds** — `push_button_usable` resolved to boolean; `attribute_types` uniqueness is `(place_type, key)`; `metadata` column/attr renamed `event_metadata` (ORM-reserved); note body 1–1000 chars; `rating_types.place_type` filtering/index/backfill specified.

Remaining (accepted) risks:
- Consensus/current-status weighting beyond distinct-user corroboration (recency/trust) is deferred; documented and tunable.
- `is_proximate` is client-asserted, explicitly not a security control; server-side proximity verification is future work.
- `comments` (owner add-time note) and `fountain_notes` (multi-user) coexist intentionally per #41; mild redundancy accepted.
