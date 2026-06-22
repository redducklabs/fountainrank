# Notes / Reviews (Slice 3) — Implementation Plan

> TDD, task-by-task. Source spec: `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` §6.5 (Codex-approved).

**Goal:** First-class user notes (#41) tied to a (user, fountain), moderation-ready, independent of aggregate rating logic. One current note per user per fountain (upsert to edit). Public read of non-hidden notes; `add_note` contribution event.

## Global constraints
Same as prior slices (Python 3.13, no new deps, `./run.ps1 check -Backend` mirror, CHECK/FK/index name parity verified via `pg_constraint`/`pg_indexes`, per-fountain `FOR UPDATE` before any aggregate work, Conventional Commits, no AI attribution, no time estimates). Branch `feat/fountain-notes` → PR → CI green + Codex `VERDICT: APPROVED` + comments addressed → squash-merge → deploy.

## Data model (migration `0008_fountain_notes`, down_revision `0007_condition_reports`)
`fountain_notes`: `id` uuid PK; `fountain_id` uuid FK→fountains CASCADE (`fk_fountain_notes_fountain`); `user_id` uuid FK→users CASCADE (`fk_fountain_notes_user`); `body` text NOT NULL; `is_hidden` bool NOT NULL default false; `hidden_by_user_id` uuid FK→users NULL (`fk_fountain_notes_hidden_by`); `hidden_at` timestamptz NULL; `created_at`/`updated_at` timestamptz (server_default now(); `updated_at` ORM `onupdate=now()`). **Unique `(fountain_id, user_id)`** (`uq_fountain_notes_fountain_id`) — one current note per user/fountain (upsert). **Partial index** (matches spec §6.5) `ix_fountain_notes_fountain_visible` on `(fountain_id)` `WHERE is_hidden = false` (the public read path) — created via `op.create_index(..., postgresql_where=sa.text("is_hidden = false"))` and `Index(..., postgresql_where=...)` on the model; the migration test asserts the predicate via `pg_indexes.indexdef` (not just the name) so it can't drift. `conftest.py` TRUNCATE gains `fountain_notes`. Downgrade: drop index → drop table.

**Moderation-safe edit (plan-review-1 MAJOR):** the upsert's `on_conflict_do_update` sets **only** `body` + `updated_at` — it must **NOT** touch `is_hidden`/`hidden_by_user_id`/`hidden_at`. So a moderator-hidden note stays hidden after the author edits it (no self-unhide bypass); the edit succeeds (200) and the row body updates, but public reads still exclude it. (Author-facing moderation feedback is a later moderation slice.) Tested explicitly.

(No DB CHECK on `body` — length is enforced by the Pydantic request schema; the column is free text.)

## Schemas
- `AddNoteRequest{ body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)] }` — Pydantic v2 strips FIRST then length-checks, so whitespace-only and leading/trailing whitespace are handled deterministically; >1000 (after trim) → 422; empty/whitespace-only → 422. The stripped value is what's persisted.
- `NoteOut{ id: uuid, body: str, author_display_name: str, created_at, updated_at }` — public shape (author name, not raw user_id; from a single `users` join).

## API
- `POST /api/v1/fountains/{id}/notes` (auth): load fountain `FOR UPDATE` (is_hidden filter, 404); upsert the caller's note via `pg_insert(...).on_conflict_do_update` on `(fountain_id, user_id)` set **only** `body`+`updated_at` (NOT moderation fields — see moderation-safe edit) `RETURNING id`; emit `add_note` (2) — `target_type='note'`, `target_id`=note id, dedup `note:{user}:{fountain}` (re-edit doesn't re-award); commit; return the caller's `NoteOut`. INFO log `fountain_id`, `user_id`, `note_id`, and event inserted-vs-deduped (no create-vs-edit claim — `ON CONFLICT ... RETURNING id` can't distinguish reliably, so it's omitted rather than logged inaccurately).
- `GET /api/v1/fountains/{id}/notes` (public): non-hidden notes for the fountain, **deterministic order `created_at DESC, id DESC`**, joined to `users.display_name` → `list[NoteOut]`. 404 if the fountain is hidden/missing (consistent with detail). **Fixed server cap** (newest `settings.max_results`, no client `limit` param this slice — cursor pagination is a later concern); tests assert the cap + ordering.
- Aggregate rating/consensus logic does NOT read notes (acceptance criterion). Notes are NOT embedded in `FountainDetail` (kept lean + independently fetchable/paginatable); documented.

## Contribution chokepoint
`POINTS`: `add_note=2`. `EVENT_TARGET_TYPES`: `add_note→{"note"}`. `_STAT_COUNTER`: `add_note→notes_count`. Builder `dk_note(user, fountain) -> f"note:{user}:{fountain}"`. Unit-test the new point + pair validation.

## Tests
- Migration test: table/columns/unique/FK names + `created_at`/`updated_at` defaults via `pg_constraint`/`pg_indexes`/`information_schema`; **partial-index predicate** asserted via `pg_indexes.indexdef ILIKE '%is_hidden%'`; `alembic check` no-drift; downgrade round-trip.
- API (`test_notes_api.py`): create note → appears in `GET notes`; edit (same user) replaces (one row, body updated, no dup) and **`updated_at` advances**; two users → two notes (ordering newest-first); **hidden note excluded** from the public read; **moderation-safe edit** — hide a note, same user POSTs an edit → public read still excludes it, body updated in DB, still `is_hidden=true`; whitespace-only/empty body → 422; leading/trailing whitespace persisted trimmed; exactly-1000-after-trim ok, >1000 → 422; auth required on write (401); `add_note` event emitted with target linkage; re-edit no double-award (notes_count stays 1, points unchanged); 404 on hidden/missing fountain.
- OpenAPI: `POST/GET /fountains/{id}/notes` paths + `AddNoteRequest`/`NoteOut` components.

## Definition of done
Backend mirror green (`alembic check` no-drift); PR CI green + Codex `VERDICT: APPROVED` + comments addressed; squash-merge; deploy via CI (`0008` applies); verify create/read notes live. Then Slice 4.
