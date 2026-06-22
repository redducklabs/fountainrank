# Access Context (Slice 4) — Implementation Plan

> TDD, task-by-task. Source spec: `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` §6.1 (access category) + §13 ("Seed access-category `attribute_types`; `placement_note` resolution"). Issue #42.

**Goal:** Deliver fountain **access context** (#42): (1) seed the access-category enum/boolean `attribute_types` (first enum attributes → validates the enum consensus path end-to-end); (2) **resolve `placement_note`** (a free-text approximate-location note); (3) enable **capture-while-adding** by accepting attribute observations + `placement_note` in `POST /fountains`. Editing is already covered by the Slice-1 `POST /fountains/{id}/attributes`. Filters (#42's filter criterion) land in **Slice 5/#43**; the consensus-backed enum/boolean attributes + the existing `(attribute_type_id, consensus_value)` index preserve that path.

## Scope honesty
This slice closes #42's **capture (add + edit)**, **unknown-value**, and **distinct-display** criteria at the API/data level. It does NOT ship the filter UI/query (Slice 5) or the capture UI (Slice 6) — #42 stays partially open until those land. No overclaim of "fully done."

## Data + schema (migration `0009_access_context`, down_revision `0008_fountain_notes`)
- **Seed** `attribute_types` (stable ids 8–13, `place_type='fountain'`, `category='access'`): `access_kind` enum `["public","customer_only","restricted"]`; `indoor_outdoor` enum `["indoor","outdoor"]`; `venue_type` enum `["park","school","transit","trail","building","playground","restroom_area","store","other"]`; `hours_dependent`/`requires_entry`/`seasonal` boolean (null `allowed_values`). `sort_order=id`. The ad-hoc `sa.table` for `op.bulk_insert` MUST declare `sa.column("allowed_values", JSONB())` so Python lists bind through the JSONB processor.
- **`placement_note`**: add nullable `placement_note` TEXT column to `fountains` (model `Fountain.placement_note`). Free text (≤200 chars enforced in the request schema); no DB CHECK. This is the §6.1 resolution: a single nullable column, set at add time; multi-user "most-recent-observer-wins" editing is a documented later enhancement (not a #42 acceptance criterion).
- Downgrade: `DELETE FROM fountain_attribute_consensus WHERE attribute_type_id IN (8..13)`; `DELETE FROM attribute_observations WHERE attribute_type_id IN (8..13)`; `DELETE FROM attribute_types WHERE id IN (8,9,10,11,12,13)` (exact ids, NOT `category='access'`); then `op.drop_column("fountains","placement_note")`. (Destructive-with-cleanup like `0006`.) `alembic check` must stay clean (the `placement_note` column is the only schema change → model + migration parity).

## Schemas
- `AddFountainRequest` gains: `placement_note: str | None = Field(default=None, max_length=200)` (stripped; empty→None) and `observations: list[AttributeObservationInput] = []` (add-time attribute capture).
- `FountainDetail` gains `placement_note: str | None = None`.

## API (`POST /fountains` extension — reuse Slice-1 helpers)
- `add_fountain`: store `placement_note` on the new row. If `payload.observations` is non-empty: `_validate_attribute_observations` (422 on unknown/non-fountain id or illegal value, incl. the new enum values) → `_upsert_attribute_observations` → `recompute_attribute_consensus` per affected attribute → append `observe_attribute` specs to the contribution batch (same `dk_observe_attr` dedup, `target_type='attribute_observation'`). All inside the existing advisory-lock + single transaction; validation runs BEFORE the fountain insert is committed (a bad observation 422s the whole add). 
- `serialize_fountain_detail` includes `placement_note`.
- No change to the public read pins.

## Tests
- Migration: access rows present; `placement_note` column present + nullable; `alembic check` no-drift; downgrade round-trip; `GET /attribute-types` returns 13 fountain rows; enum rows' `allowed_values` are JSON arrays in canonical order, boolean rows null.
- **Enum consensus end-to-end** (`test_attributes_api.py`): observe `access_kind="public"` ×2 distinct users → detail consensus `public` + `value_counts={"public":2}`; +1 `customer_only` → still `public`; 2-2 tie → `consensus_value=None`/`mixed`; illegal `access_kind="spaceship"` → 422; `"unknown"` accepted, doesn't decide; `venue_type` plurality.
- **Add-time capture** (`test_fountains_add.py` extension): `POST /fountains` with `observations=[{access_kind,public}, {bottle_filler,yes}]` + `placement_note="near the north restrooms"` → 201; detail shows those attribute consensuses + the placement_note; an `observe_attribute` event emitted per observation (target-linked); an illegal observation in the add body → 422 and NO fountain created (rolled back).
- OpenAPI: `AddFountainRequest` now has `placement_note` + `observations`; `FountainDetail` has `placement_note`.

## Definition of done
Backend mirror green (`alembic check` no-drift); PR CI green + Codex `VERDICT: APPROVED` + comments addressed; squash-merge; deploy via CI (`0009`); verify `GET /attribute-types` returns access keys + an add-with-attributes works live. #42 capture/display closed; filters tracked for Slice 5. Then Slice 5.
