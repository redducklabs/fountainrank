# Durable Contribution-Write Rate Limits — Implementation Plan

**Goal:** Enforce durable, race-free per-user attempt budgets on contribution writes and profile
sync while preserving authentication availability and existing photo/report limits.

**Spec:** `docs/specs/2026-07-13-durable-write-rate-limits-design.md` (approved review 2).

**Delivery:** This plan is implemented as program PRs C–E. PR F (trusted client IP + ingress
limiting) remains separate and is not specified here.

## Fixed decisions

- Shared `contribution_write`: 20 rolling minute / 200 rolling day.
- Separate `profile_sync`: 10 rolling minute / 100 rolling day.
- One syntactically valid authenticated HTTP request consumes one attempt.
- Use the existing request `AsyncSession`; commit admission before domain work.
- Counts key on budget, never endpoint. Five contribution codes share one budget.
- `429` detail is the machine reason, matching photos/reports; `Retry-After` is calculated wholly in
  PostgreSQL from the oldest in-window row and database time.
- A dedicated hourly cleanup CronJob drains 30-day-old rows; do not couple account-deletion cleanup.
- No Redis, per-IP limiting, trust tiers, success quotas, or point-rule changes.

## PR C — Ledger, limiter primitive, and cleanup

### Task C1 — Migration and ORM model

**Files:** `backend/app/models.py`, new `backend/migrations/versions/0024_write_attempts.py`,
`backend/tests/test_write_attempts_migration.py`, `backend/tests/conftest.py`.

- [ ] Add failing migration tests for upgrade/downgrade/upgrade and exact metadata:
      `fk_write_attempts_user`, `ck_write_attempts_rate_budget`,
      `ck_write_attempts_rate_endpoint`, `ix_write_attempts_user_budget_created`, and
      `ix_write_attempts_created_at`. Query `pg_constraint`/`pg_indexes` and assert CHECK definitions,
      because `alembic check` does not compare them.
- [ ] Add `WriteAttempt` with application UUID default, cascading user FK, both short-named CHECKs,
      server timestamp, and the two indexes. Add the table to test cleanup ordering.
- [ ] Write reversible migration `0023_ratings_is_proximate -> 0024_write_attempts`, using names that
      match ORM metadata. Downgrade drops the table.
- [ ] Run focused migration tests, full backend migration sequence, and `alembic check`.

### Task C2 — Admission primitive and lock

**Files:** `backend/app/locks.py`, `backend/app/rate_limit.py`,
`backend/tests/test_write_rate_limit.py`.

- [ ] Add `WRITE_RATE_LIMIT_LOCK_NS = 0x57524154` and typed budget/endpoint constants.
- [ ] Add failing tests for exact minute/day boundaries, budget/user isolation, contribution
      endpoint sharing, no row on rejection, exact reason codes, and `Retry-After` ranges. Seed
      `created_at` explicitly; assert `1 <= retry_after <= window_seconds`, never an exact wall-clock
      integer that can flake as database time advances.
- [ ] Calculate count, oldest row, and remaining seconds in PostgreSQL expressions using one DB
      clock; never mix database timestamps with Python `datetime.now()`.
- [ ] Implement `reserve_write_attempt(session, user_id, budget, endpoint)`:
      acquire the per-user advisory lock, test minute then day, roll back before raising on rejection,
      insert and commit on admission. Return no attempt ID.
- [ ] Preserve auth provisioning atomicity: the flushed new `User` row and attempt insert commit in
      the same transaction so the FK target and attempt cannot split. Do not use a nested transaction.
- [ ] Inspect and pin the actual `get_or_create_user`/`_reconcile_admin` commit boundaries in tests.
      Explicitly test rejection semantics: a rate-rejected first-ever request may roll back its
      uncommitted user insert, leaves no orphan attempt/FK state, and the next authenticated request
      safely re-provisions it. Already-committed admin reconciliation remains durable.
- [ ] Add true concurrency tests using N independent `async_sessionmaker(engine)()` sessions, each
      with its own transaction/connection and launched together with `asyncio.gather`. Size the test
      engine pool for every participant so the limiter—not pool starvation—rejects excess requests;
      pool-pressure behavior, if tested, is a separately named test. Assert admitted rows never exceed
      the boundary and excess calls return 429 data. Never share one AsyncSession across gather.
- [ ] Prove a committed attempt survives a later, separate domain transaction rollback.

### Task C3 — Injectable route seam and named-user guard

**Files:** `backend/app/rate_limit.py`, `backend/app/auth.py`, focused auth tests.

- [ ] Define `WriteAttemptReserver` and a production dependency that delegates to the primitive
      with the request session; keep it overrideable without patching globals.
- [ ] Extract a pure `ensure_named_user(user)` guard from `require_named_user`, preserving the exact
      typed 409 response. Keep `require_named_user` for routes outside this plan.
- [ ] Test named/unnamed behavior directly and verify no token, subject, name, or email enters new
      limiter logs.

### Task C4 — Dedicated retention command

**Files:** new `backend/app/write_attempt_cleanup.py`, new cleanup tests,
new `infra/k8s/write-attempt-cleanup.yaml`, `.github/workflows/deploy.yml`.

- [ ] Write cleanup tests: retain rows at/inside 30 days, delete older rows, batch at 10,000,
      commit between batches, stop on a short batch, cap at ten batches, and log only count/cutoff/cap.
- [ ] Implement an idempotent CLI with non-zero exit only for its own unhandled cleanup failure.
- [ ] Add a `37 * * * *` hardened CronJob (avoids both top-of-hour load and the account-deletion job
      at minute 17) using the backend image, database URL/CA wiring, non-root UID, RuntimeDefault
      seccomp, dropped capabilities, read-only root filesystem, resource bounds, concurrency policy
      `Forbid`, bounded history/backoff, and `automountServiceAccountToken: false`. Hitting the ten-batch
      cap logs a `WARNING` but exits zero; only an actual cleanup failure exits non-zero.
- [ ] Add the manifest to deploy's `envsubst | kubectl apply` set and rollout-independent validation;
      never apply it locally.
- [ ] Render with non-secret placeholders and validate with kubeconform/static assertions.

### Task C5 — PR C verification

- [ ] Run backend Ruff/format, migration upgrade/downgrade/upgrade, named metadata assertions,
      `alembic check`, and full pytest against PostGIS.
- [ ] Run manifest rendering/validation and actionlint for the deploy edit.
- [ ] Run `./run.ps1 check`; record host/CI-only limitations accurately.
- [ ] Complete hosted CI/security and review gates before merge.

## PR D — Contribution endpoint gates

### Task D1 — Route contract tests first

**Files:** fountain route test modules plus new shared route-limit test helpers.

For fountain create, ratings, attributes, conditions, and notes:

Endpoint codes are fixed by spec §4: create → `fountain_create`, ratings → `rating_submit`,
attributes → `attribute_submit`, conditions → `condition_submit`, and notes → `note_submit`.

- [ ] Override `WriteAttemptReserver`; assert the exact `contribution_write` budget and endpoint code.
- [ ] Assert an unnamed authenticated user is reserved before existing 409.
- [ ] Assert a limiter rejection returns 429, reason detail, and precise `Retry-After`.
- [ ] Assert rejection precedes target lookup, catalog validation, fountain/advisory row locks,
      proximity work, and mutations.
- [ ] Assert syntactically valid 404/403/409/422-after-parse outcomes leave the committed attempt.
- [ ] Keep all existing success, points, logging, aggregate, and concurrency tests unchanged/green.

### Task D2 — Wire routes

**Files:** `backend/app/routers/fountains.py`, imports/dependencies only as required.

- [ ] Replace endpoint-level `require_named_user` with `get_current_user` only on the five scoped
      routes. First endpoint-body action reserves; second calls `ensure_named_user`.
- [ ] Map `RateLimited` consistently to 429 `detail=reason` plus `Retry-After`; use one helper to
      prevent drift across five routes.
- [ ] Add structured admission/rejection context with local user UUID, budget, endpoint, window,
      count, retry; never log body content, coordinates, or identity subjects.
- [ ] Do not change domain transaction, points, response schema, or photo/report behavior after the
      early admission commit.
- [ ] Audit existing named-user tests (especially notes) for dependency-time/no-DB-work assumptions;
      update only the intentional invariant that an unnamed request now commits an attempt before the
      same typed 409 response.

### Task D3 — API artifacts and verification

- [ ] Declare/document 429 responses on all five OpenAPI operations and add schema tests. Preserve
      every existing typed 409 declaration exactly; add-fountain keeps its
      `DuplicateFountainConflict | DisplayNameRequiredConflict` union, and generated artifacts should
      show only the intended additive 429 response changes.
- [ ] Regenerate tracked OpenAPI/TypeScript artifacts and inspect the diff.
- [ ] Run backend suite, API-client/web/mobile typechecks, and full `./run.ps1 check`.
- [ ] Complete hosted CI/security and review gates before merge.

## PR E — Profile-sync gate and graceful clients

### Task E1 — Backend sync gate

**Files:** `backend/app/routers/users.py`, `backend/tests/test_logto_auth.py`, rate-limit route tests.

- [ ] Add tests for exact `profile_sync` budget/code, 429 contract, admission before userinfo fetch,
      and no userinfo call on rejection.
- [ ] Prove 10 rapid/parallel attempts admit and the eleventh defers without changing auth/user data.
- [ ] Prove userinfo 502/sub-mismatch attempts remain counted; normal successful sync stays unchanged.
- [ ] Wire reservation as the first endpoint-body action after authentication/body validation.

### Task E2 — Web behavior

**Files:** `web/lib/server/sync.ts`, its existing tests, `web/lib/server/account-gate.ts`, and
`web/app/callback/route.ts` tests as needed.

- [ ] Preserve the shared server-only `postProfileSync` core and cover both callers:
      `syncProfile` through the account RSC gate and `syncProfileForRoute` through the callback route.
      Do not introduce a client token path.
- [ ] The current helper is already best-effort for every non-OK response. Extend its existing tests
      to prove explicitly that 429 on each caller retains the session/profile, performs no retry or
      sign-out, and does not make account/callback flow fatal. Do not invent control-flow churn when the
      existing behavior already satisfies the spec.
- [ ] Add explicit 502 no-loop coverage and, only if diagnostics need it, distinguish 429 from 502
      in structured warnings without token/body/subject data.

### Task E3 — Mobile behavior

**Files:** `mobile/lib/auth/sync.ts`, its existing tests, and focused auth-provider tests.

- [ ] The current `syncProfileOnSignIn` already returns `failed` on non-OK and the provider ignores
      that best-effort result. Extend the existing sync tests to prove 429 preserves Logto auth/cached
      profile, schedules no retry, and never invokes logout; change implementation only if the test
      exposes a real gap.
- [ ] Add explicit 502 bounded/no-loop diagnostics coverage.
- [ ] Add pure/helper tests plus provider behavior tests without relying only on render tests or
      creating a parallel sync test suite.

### Task E4 — Verification

- [ ] Regenerate API artifacts if the documented response set changes.
- [ ] Run backend, web/mobile lint/typecheck/tests, production web build, and full local mirror.
- [ ] Treat hosted mobile React-Compiler lint, full isolated-linker tests, and expo-doctor as final
      authority where required by `claude_help/local-dev.md`.
- [ ] Complete hosted CI/security and review gates before merge.

## Completion evidence

- [ ] Each PR is independently mergeable and contains only its named scope.
- [ ] Security review finding 5 is updated only after PRs C–E are merged and hosted gates are green;
      per-IP/account-farm residual risk remains explicitly open until PR F.
- [ ] Handoff links migrations, PRs, CI runs, review verdicts, deployed CronJob evidence, and 429
      smoke results without secrets or raw identity data.
