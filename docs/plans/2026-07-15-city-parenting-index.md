# City-parenting membership index implementation plan

**Goal:** Remove the confirmed table-growth-dependent scans from city parenting by adding the
`place_boundaries (country_code, place_kind)` btree index, then validate the improvement in production.

**Design:** `docs/specs/2026-07-15-city-parenting-index-design.md`

## Constraints

- Keep membership SQL and behavior unchanged.
- Use a normal reversible Alembic migration and keep SQLAlchemy metadata in sync.
- Do not disturb the running fan-out for development or benchmarking.
- Use an isolated `UV_PROJECT_ENVIRONMENT` for backend checks in WSL.
- Follow branch → PR → CI green + independent review approval + all comments addressed → squash-merge.
- Deploy through `deploy.yml`; do not mutate Kubernetes resources manually.

## Task 1: Add the schema index

Files:

- Modify `backend/app/models.py`.
- Create `backend/migrations/versions/0027_boundary_country_kind_idx.py`.
- Modify `backend/tests/test_place_boundaries_migration.py`.

Steps:

- [ ] Add `Index("ix_place_boundaries_country_kind", "country_code", "place_kind")` to
  `PlaceBoundary.__table_args__`.
- [ ] Add migration `0027_boundary_country_kind_idx`, revising
  `0026_index_all_countries` (the current head).
- [ ] In `upgrade()`, create the non-unique index with `op.create_index`.
- [ ] In `downgrade()`, drop that index by its exact name.
- [ ] Add a pytest regression assertion that `pg_indexes` contains the exact index name, uses btree,
  and has the ordered key list `(country_code, place_kind)`.

## Task 2: Verify schema and behavior

- [ ] Start the existing PostGIS development service through `./run.ps1`.
- [ ] Run the backend CI mirror with an isolated `UV_PROJECT_ENVIRONMENT`.
- [ ] Verify `alembic upgrade head` creates the exact index name and ordered columns in
  `pg_indexes`.
- [ ] Verify `alembic downgrade 0026_index_all_countries` removes it, then upgrade back to head.
- [ ] Run `alembic check` and confirm no drift.
- [ ] Run the membership test files explicitly, in addition to the backend mirror.
- [ ] Run a representative `EXPLAIN` against the local schema/fixture if sufficient data exists;
  otherwise record operator-level plan verification in production after deployment.

## Task 3: Review and deliver

- [ ] Commit the approved spec and plan, then the implementation, using Conventional Commits.
- [ ] Run the full locally supported pre-PR checks and confirm the worktree contains only scoped
  changes.
- [ ] Push the branch and open a PR with no AI attribution or time estimates.
- [ ] Wait for every required CI check to pass.
- [ ] Run the independent adversarial PR review loop to `VERDICT: APPROVED` and address every PR
  comment.
- [ ] Squash-merge the PR.

## Task 4: Deploy and validate production

- [ ] Confirm the production Kubernetes context before read-only inspection.
- [ ] Wait until no boundary loader Job is actively mutating membership, then manually dispatch
  `deploy.yml` from `main`.
- [ ] Confirm deployment succeeds and the backend is healthy.
- [ ] Confirm the production index definition.
- [ ] Observe a real post-deploy boundary load and record its city-parenting duration and terminal
  result.
- [ ] Confirm the plan no longer performs the two broad country/kind scans.
- [ ] Treat the first completed post-deploy load as an initial smoke/performance check. Keep the
  five-hour acceptance criterion open until representative remaining fractal countries complete.
- [ ] Let the queue drain and reconcile rolled-back or missing target countries according to the
  handoff; retire only registry entries proven to fail closed on zero Overture country features.
- [ ] Declare the production success bar met only after the representative/fractal queue coverage
  confirms no country reaches the five-hour deadline.
