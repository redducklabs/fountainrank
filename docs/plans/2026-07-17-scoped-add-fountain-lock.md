# Bounded add-lock waits + staged membership refresh — implementation plan (2026-07-17)

Spec (Codex-approved): `docs/specs/2026-07-17-scoped-add-fountain-lock-design.md`. Issue: #242.
TDD; branch `feat/bounded-add-lock-staged-refresh`; Conventional Commits, one commit per task
with the subject given below; never commit `temp/codex-reviews/`. **Every task boundary is
independently green**: `./run.ps1 check -Backend` (which includes `alembic upgrade head` +
`alembic check` — the no-drift check runs at EVERY task, not only at the end; any unexpected
Alembic diff stops the work) via the isolated `UV_PROJECT_ENVIRONMENT` per `local-dev.md`.
Task 3 additionally touches the tracked api-client artifacts (see below), so this branch is
**not** backend-only.

## Task 1 — setting + docs — `feat(backend): add_lock_timeout_ms setting`

- Tests first: default 8000 valid; `0`, negative, > 60 000 rejected (`gt=0, le=60_000`).
- Implement in `app/config.py`; document the env-var name in `backend/README.md`.

## Task 2 — `interactive_lock_timeout` context manager (`app/locks.py`) — `feat(backend): bounded interactive lock waits`

- Tests first (real asyncpg/SQLAlchemy stack; two-session harness pattern from
  `test_osm_merge.py`): `set_config('lock_timeout', CAST(:ms AS text) || 'ms', true)` applies and
  is transaction-local; a lock-wait expiry surfaces the installed wrapper shape with SQLSTATE
  55P03 (asserted, not assumed); the helper classifies without issuing SQL, rolls the session
  back (usable after; no writes persisted), logs one WARNING `interactive_write_lock_timeout`
  with `context`/`elapsed_ms`/correlation id and no driver internals, raises
  `InteractiveWriteBusy`; non-55P03 errors propagate untouched.
- Implement the context manager + domain exception + logging.

## Task 3 — endpoint wiring + API contract — `feat(backend): 503 busy on interactive lock timeout`

- Tests first (spec Verification 2a/2b/3 + placement): `POST /fountains` against a held advisory
  lock → 503, `Retry-After: 30`, `{"detail":"busy"}`, succeeds once freed; admin patch/delete
  same; OpenAPI declares 503 + `Retry-After` on all three (mirroring the 429 assertions);
  route-level held-ROW-lock test proving `add_fountain` enters the context AFTER
  `_reserve_contribution_write` (a misorder leaves the domain transaction unbounded and must
  fail the test); the rate-limit reservation survives a lock-timeout rollback.
- Implement ordering per spec §1, the 503 mapping, and `responses=` declarations. **Then
  regenerate the tracked api-client artifacts** (`packages/api-client/openapi.json` +
  `src/schema.d.ts`), verify the diff contains exactly the intended 503/`Retry-After` contract
  and no unrelated drift, and run the api-client checks plus web/mobile `tsc --noEmit` (render
  suites stay CI-gated per `local-dev.md`; type/lint/build run locally). Same commit.

## Task 4 — pure extraction: compute/publish seam — `refactor(backend): extract membership compute/publish seam`

- Tests: the full existing membership suite passes unchanged with `refresh_country_memberships`
  / `refresh_all_memberships` recomposed as `compute_boundary_derivation` +
  `publish_membership_state` running back-to-back in the caller's transaction, advisory lock
  first (merge-path semantics). **Strictly live-SQL extraction — no staging, no behavior
  change**; the boundary is green because publish still consumes exactly what compute mutated
  live.
- Implement the two functions + thin compositions; `merge.py` behavior untouched.

## Task 5 — generation-closed staged compute + atomic publish (ONE task — a split here would
leave compute staging data publish ignores, an unreviewable broken intermediate) —
`feat(backend): staged generation-atomic membership refresh`

- Tests first, all passing at this single boundary:
  - staged dataflow equivalence: staged place-kind → staged canonical-region winners (live
    `_CANONICAL_REGIONS_*` ordering: partition `(country_code, slug)`,
    `ST_Area DESC, overture_id ASC`; identical `place_scope_config` behavior) → staged
    region/city parents reading staged cells + the staged canonical relation;
  - adversarial generation-change fixture (region qualification AND canonical winner change):
    staged results == legacy single-transaction results;
  - plan-shape: EXPLAIN on a representative staged city-parenting run shows the staging-cells
    GiST probe, never a seq scan;
  - reset-first publish-order regression: two previous-generation canonical cities sharing a
    slug re-parented under one new parent publish without hitting
    `uq_place_boundaries_city_canonical` and converge to one winner; a staged `place_kind`
    transition changing partial-index participation;
  - the full existing membership suite green on both compositions; an add committed between the
    stages ends with correct final membership.
- Implement: temp staging tables (unconditional `DROP IF EXISTS` + `CREATE TEMP`); staging-cell
  GiST `geom` + `place_id` indexes + `ANALYZE` before staged city parenting (same predicate
  shapes as live); the staged canonical-region relation; publish order (1) canonical reset on
  old hierarchy, (2) cells replacement + staged kind/parent apply, (3) region canonical = staged
  winners, (4) existing fountain-dependent tail per scope.

## Task 6 — pinned-connection staged wrapper + CLI wiring + stage observability — `feat(backend): staged refresh CLI on pinned connection`

- Tests first:
  - connection lifecycle: both transactions on one pinned physical connection (identity
    asserted); consecutive staged runs on a reused connection cannot leak stale staging; a
    publish exception leaves no open/aborted transaction on the returned connection;
  - forced publish-failure: public place/SEO reads still serve the previous generation (cells,
    winners, parents, kinds); an add AFTER the failure computes membership from the coherent
    previous generation; a rerun converges; the CLI exits nonzero (loader Job fails visibly — no
    orchestration change);
  - **stage-boundary logging** (structured, correlation/run context, scope/country + safe
    summary fields, no payload/PII/SQL/driver internals): `compute_started` /
    `compute_completed` / `publish_waiting` (advisory) / `publish_started` /
    `publish_completed` / `publish_failed`; `publish_completed` is emitted only after the commit
    is durable, never before.
- Implement: `async with engine.connect()` + `AsyncSession(bind=connection,
  expire_on_commit=False)` with the session as sole transaction owner; staged wrapper
  compute → commit → publish → commit; `boundary_cli.py` / `membership_cli.py` switched to it;
  the logging above.

## Task 7 — lock-graph + reconciliation-invariant tests — `test(backend): staged lock graph and duplicate serialization`

- Tests (spec Verification 2c/2d/2e): compute concurrent with an add → add unaffected (no
  live-table write locks in compute); publish holding advisory + cells replacement while an add
  waits → add 503s at the bound, no `40P01` on either side; the v1 inversion recreation retained
  as a timeout-mapping regression; **two concurrent identical-coordinate creates** serialize on
  the advisory lock — one commits, the other receives the typed duplicate 409. This test is the
  **#241 cross-spec gate**: the mobile add-flow-resilience PR must not merge before this test is
  on `main` and green.

## Task 8 — verification, PR + post-deploy validation (docs/chore commits as needed)

- Full `./run.ps1 check` (backend fully verifiable locally per `local-dev.md`; JS render suites
  CI-gated — report honestly). PR: `gh pr create` linking #242 + the spec, noting the #241 gate
  satisfied by Task 7; confirm `mergeable != CONFLICTING`; CI green → Codex PR review loop →
  every PR comment addressed → **squash-merge only**. No AI attribution, no time estimates.
- Post-merge: manual deploy (`gh workflow run deploy.yml --ref main`) when no boundary load is
  in flight (loader runbook). **Post-deploy production validation checklist (from the spec)**:
  correlate `advisory_lock_wait` with `advisory_lock_acquired` OR
  `interactive_write_lock_timeout` per request id (the timed-out population must be visible; a
  timeout event does not imply an advisory wait — it may be a row/table-lock timeout after
  acquisition); during the next real boundary load's compute phase, adds succeed or 503 within
  the bound; 503 rates fall back to zero outside refresh windows; stage-boundary events appear
  with correct correlation for a real staged run.
