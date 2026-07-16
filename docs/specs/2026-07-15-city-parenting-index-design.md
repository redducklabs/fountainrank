# City-parenting membership index — design (2026-07-15)

## Problem

The worldwide Overture boundary fan-out is correct but the city-parenting phase of
`refresh_country_memberships()` takes hours for some countries and risks the loader Job's five-hour
deadline. Production `EXPLAIN (ANALYZE, BUFFERS)` identified two broad scans of
`place_boundaries` in `_CITY_PARENT_COUNTRY_SQL`:

- materializing the country's `place_kind = 'city'` rows scans nearly the entire table; and
- finding the same-country `place_kind = 'country'` row scans most of the unique
  `overture_id` index before filtering.

At roughly 95,000 rows, those scans read about 82,000 and 65,000 buffer pages respectively for a
400-city country. The cost grows as each newly loaded country enlarges `place_boundaries`.
Production A/B profiling also showed that precomputing region area improves the current query only
modestly and does not address the dominant I/O.

## Decision

Add one non-unique btree index named `ix_place_boundaries_country_kind` on
`place_boundaries (country_code, place_kind)`.

Both predicates use equality on both columns, and the country-leading order matches the table's
existing country-scoped access patterns. The index serves city materialization, the country lookup,
and same-country region lookup without adding separate per-kind indexes. It also helps the full-DB
`_CITY_PARENT_SQL` path where the same country/kind predicates appear.

Declare the index in `PlaceBoundary.__table_args__` and create it in a new reversible Alembic
migration. The downgrade drops only this index.

Use Alembic's normal transactional `op.create_index`, not `CREATE INDEX CONCURRENTLY`. Production
runs `alembic upgrade head` transactionally in the backend pod. The table is small enough that a
plain build is appropriate, and introducing Alembic autocommit handling would add failure modes that
are disproportionate to this index. Deployment must not overlap an active boundary load, consistent
with the loader operational runbook.

## Scope and correctness

This change is planner-only. It does not alter membership SQL, transaction boundaries, locking,
geometry operations, parent selection, or canonical selection. Therefore existing parent assignments
remain the correctness oracle.

Explicitly out of scope:

- rewriting either city-parent query;
- precomputing or storing region area;
- changing JIT settings;
- changing loader deadlines, concurrency, or Kubernetes resources; and
- cancelling or redispatching the current fan-out merely to benchmark.

Those changes require fresh post-index evidence. In particular, the observed area-precomputation
gain must be remeasured after the dominant scans disappear.

## Verification

Local verification must cover:

1. Alembic upgrade creates `ix_place_boundaries_country_kind` with exactly
   `(country_code, place_kind)` and downgrade removes it.
2. `alembic check` reports no model/migration drift.
3. The backend lint, format, migration, and test mirror passes, including membership tests.
4. A representative PostgreSQL plan with the index present no longer uses broad scans to locate the
   selected country's city/country rows.

Production validation after merge and backend deployment must record the city-parenting duration for
real queued countries. The first completed load is an initial smoke/performance check; confirming that
no country reaches the five-hour Job deadline remains open until the queue exercises representative
fractal giants. The operational target is single-digit minutes for a typical country. Fractal giants
may take longer in proportion to their genuine point-in-polygon work, but must complete within the
deadline.

If production still shows material residual cost, capture a new plan and buffer profile before
proposing any SQL rewrite.

## Rollout and rollback

Merge through the normal PR gates, then manually run the backend deploy workflow from `main` when no
boundary load is in flight. New loader Jobs use the newly deployed backend image. Observe the next
real country load and reconcile any countries that previously rolled back or failed.

Rollback is the migration downgrade or a forward migration dropping the index. Dropping the index
restores the previous performance characteristics without changing data.
