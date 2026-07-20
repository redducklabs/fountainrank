# Moderation audit trail + rating removal (#216) — implementation plan

Design: `docs/specs/2026-07-20-moderation-audit-and-rating-removal-design.md`.

## Task 1 — schema and model

- Add migration `0029_moderation_actions.py` with constraints, FKs, and indexes from the design.
- Add `ModerationAction` to `backend/app/models.py` with migration/model name parity.
- Hand-name every FK and composite index identically in the model and migration.
- Add migration tests covering upgrade, downgrade, exact `pg_constraint`/`pg_indexes` names, and
  Alembic drift. Recheck the migration head before PR creation in case `main` advanced.

## Task 2 — audit chokepoint and existing actions

- Add bounded reason schemas and `_record_moderation_action`.
- Audit effective fountain/note/photo hide/unhide transitions.
- Audit both dismiss paths and the fountain/photo delete paths in the mutation transaction.
- Add backend tests for rows, reasons, no-op/zero-resolved dismiss semantics, authorization, and
  rollback coupling. Explicitly cover photo storage deletion failure: 500, photo preserved, cleanup
  ledger committed, and no moderation action. For fountain hard-delete, assert durable
  `content_id`; `fountain_id` is expected to become null through `ON DELETE SET NULL`.

## Task 3 — admin rating detail and deletion

- Add `AdminRatingOut` to admin fountain detail serialization.
- Include account-detached ratings via a left join and a "Deleted account" label.
- Add an actor-scoped first-rating-bonus reversal helper that mirrors target reversal's
  awarded→reversed transition and denormalized-stat decrement/clamp; detached ratings skip it.
- Correct shared `recompute_fountain_ranking` freshness to `max(Rating.updated_at)` and add
  regression coverage for submit-ratings and add-fountain inline ratings. Document/test that
  `last_rated_at` is latest rating-row mutation time and account detachment can advance it.
- Add the admin rating DELETE route with `interactive_lock_timeout`, Fountain-then-Rating locks,
  target and conditional bonus reversal, aggregate recomputation, audit insertion, and logging.
- Test authorization, 404/422, 503 bounded waits, lock order, deletion, and audit contents. Cover:
  multi-dimension same-actor vs last-row/last-actor aggregate behavior; true `last_rated_at`; bonus
  remains until the bonus owner's final rating; deleting a later rater never affects the first
  rater's bonus; final bonus reversal decrements stats; detached rating is visible/removable and
  both reversal helpers no-op; zero-rating aggregates are fully cleared.

## Task 4 — generated client and web

- Regenerate the tracked OpenAPI document and TypeScript schema.
- Add the rating-removal server action and admin rating list/confirmation/reason UI.
- Thread optional moderation reasons through existing queue actions.
- Update tests and `docs/style-guide.md`.

## Task 5 — mobile

- Add admin rating rows and removal flow with required reason/confirmation.
- Thread optional moderation reasons through existing queue actions.
- Add unit/component coverage without new native dependencies.
- Confirm the existing admin fountain-detail GET remains force-authenticated by the mobile API
  allowlist; the new DELETE is authenticated by the existing non-GET rule.

## Task 6 — verification and delivery

- Run backend migration/ruff/pytest checks using an isolated uv environment.
- Run JS lint, typecheck, unit tests, formatting, web build, and Expo Doctor in an isolated worktree
  where needed; rely on CI for the authoritative component-render and React Compiler gates.
- Confirm generated files and build rewrites leave the branch clean.
- Open the PR, obtain green CI, complete the independent review loop, address every comment, and
  squash-merge.
- Update/close #216 and correct dangling #12 references only after the implementation is merged.
