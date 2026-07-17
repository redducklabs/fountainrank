# Bounded add-fountain lock waits + staged membership refresh — design (2026-07-17)

Issue: #242. Sibling designs: `2026-07-17-mobile-add-flow-resilience-design.md` (#241/#244),
`2026-07-17-mobile-live-location-design.md` (#243).

## Problem

`POST /api/v1/fountains` acquires the single global `ADD_FOUNTAIN_LOCK`
(`backend/app/routers/fountains.py:831`, `backend/app/locks.py:21`) with an unbounded
`pg_advisory_xact_lock` wait. The same key is held by:

- the OSM import merge/rollback (`backend/app/imports/merge.py:89,434`) for the whole merge
  transaction;
- the membership refreshes (`backend/app/membership.py:1172,1287`) for the **entire** refresh —
  including the boundary-only derivation phases (cells rebuild, place-kind, region parenting,
  city parenting) that never read or write fountains. City parenting is still the dominant phase
  for fractal-geometry countries even after #239;
- the admin fountain patch/delete (`backend/app/routers/admin.py:112,211`);
- the SEO coverage CLI (session-level, `backend/app/imports/seo_coverage_cli.py:46`).

Consequence: while a boundary load or import runs, every user add worldwide queues indefinitely
behind the job, and the mobile client has no request timeout (#241) — an infinite spinner. This is
the server half of the owner's "adding a fountain takes forever" report.

## Decision

Two changes. Both preserve the cross-writer mutual exclusion the lock exists for (the duplicate
probe, the first-in-area precheck, and the snapshot-based place-count/canonical recompute —
`recompute_fountain_membership`'s contract at `membership.py:996-1005` is race-safe **only** under
mutual exclusion).

### 1. Interactive paths get a transaction-wide `lock_timeout` → fast 503

`add_fountain` and the admin `patch`/`delete` run their whole write transaction under a bounded
`lock_timeout`, so an interactive request never waits more than the bound on **any** lock — the
advisory add lock, and equally the row/table locks a concurrently running refresh's boundary
transaction may hold (see §2, where this becomes load-bearing).

- **Setting**: `add_lock_timeout_ms` in `app/config.py`, default `8000`, declared with validation
  `gt=0, le=60_000` (a `0` would silently disable the timeout; unbounded values defeat the
  design). Documented (env-var name only) in `backend/README.md` per `testing-ci.md`.
- **SQL**: applied once at the start of the endpoint's transaction via
  `SELECT set_config('lock_timeout', CAST(:timeout_ms AS text) || 'ms', true)` — `set_config`
  takes `(text, text, boolean)`, so the integer setting is explicitly cast and unit-bearing; no
  bare-integer bind, no `SET LOCAL` (which cannot take binds). It is transaction-local; there is
  **no reset** — the bound deliberately covers the entire interactive transaction, and rollback
  or commit clears it.
- **Error contract** (the part that must be exact, because 55P03 aborts the transaction and any
  further SQL raises `InFailedSQLTransaction`): a shared async context manager in `locks.py`,
  e.g. `interactive_lock_timeout(session, settings, *, context)`, that (a) applies the
  `set_config` on entry, (b) on exception checks — **without issuing any SQL** — whether it is a
  SQLAlchemy `DBAPIError` whose `orig` carries SQLSTATE `55P03` (inspecting
  `getattr(exc.orig, "sqlstate", None)` and the asyncpg wrapper shape actually observed under the
  project's installed versions, asserted by test), (c) if so: `await session.rollback()`, log one
  WARNING `interactive_write_lock_timeout` — named truthfully, because the transaction-wide bound
  maps advisory, row, and table lock timeouts alike to this event (fields: `context`,
  `elapsed_ms` — the helper's clock measures time inside the context, i.e. the bounded
  transaction's elapsed time, NOT a specific lock's wait, so it is not called `waited_ms` — and
  the request's existing correlation id; **never** the driver exception string, SQL text, payload
  fields, or lock-holder identity), and raise a domain exception `InteractiveWriteBusy`,
  (d) re-raises anything else untouched (no suppression, no remapping of real failures). The
  existing `advisory_lock_wait` / `advisory_lock_acquired` events remain reserved for the
  advisory acquisition specifically.
- **Placement in `add_fountain` (explicit, because the setting is transaction-local and the
  reservation commits)**: the endpoint calls `_reserve_contribution_write(...)` FIRST — its
  internal commit would otherwise clear a previously applied `lock_timeout` and leave the domain
  transaction unbounded — and only then enters `interactive_lock_timeout`, keeping validation,
  advisory acquisition, the mutation, and the domain commit inside the context. Admin
  patch/delete (no separate reservation commit) enter the context before their first database
  statement. A route-level held-**row**-lock test pins this placement (a helper-only test cannot
  catch a misordering regression).
- **HTTP mapping**: the three endpoints translate `InteractiveWriteBusy` to **503** with
  `Retry-After: 30` and the JSON body `{"detail": "busy"}` — FastAPI's plain `HTTPException`
  shape, declared via `responses=` on all three operations (including the `Retry-After` header)
  so it appears in the OpenAPI schema, with contract assertions analogous to the existing 429
  response tests. `"busy"` exposes no lock names, SQLSTATE, or internals.
- The lock acquisition itself keeps the existing `acquire_add_fountain_lock` logging
  (`advisory_lock_wait` / `advisory_lock_acquired` with `waited_ms`).
- `reserve_write_attempt` commits its reservation in its own transaction before the domain work
  (`rate_limit.py:196`), so a lock-timeout rollback intentionally does **not** refund the attempt
  — a retry storm against a busy lock stays bounded by the attempt budget.
- **Bulk/CLI paths keep the unbounded wait as deliberate policy**: a job queues patiently and is
  monitored/cancellable by its operator. No fairness property of the Postgres lock queue is
  relied on or claimed; if starvation is ever observed, that is an application-level admission
  problem to design then (recorded on #242), not a scheduling promise to assume now.
- Mobile needs no new handling: 503 rejects `unwrap` with `ApiError(503)` → the add flow's
  existing retryable server-error path; #241 gives the request a client-side ceiling
  independently.

### 2. Stage the standalone membership refreshes: boundary derivation commits before the lock

**Why not just move the lock later in the same transaction** (the v1 proposal): the boundary
phases take and hold row locks on `place_boundaries` (and, for the full refresh's cells rebuild, a
transactional `TRUNCATE`'s ACCESS EXCLUSIVE on `place_boundary_cells`) until commit. An add that
already holds the advisory lock then blocks on those rows inside
`recompute_fountain_membership`, while the refresh finishes its prefix and blocks on the advisory
lock — a lock-order inversion Postgres resolves by deadlock-aborting one side. Same-transaction
reordering is therefore rejected.

**A second constraint shapes the staging boundary — no committed intermediate public state.** A
naive split that runs today's mutating phase SQL in stage 1 would commit cleared/partial
`is_canonical` and `parent_id` states: `_CANONICAL_RESET_*` clears **city** canonical flags that
only the count-dependent locked tail restores, so a stage-2 failure would leave every city in
scope with no canonical winner — public place pages and SEO routing broken until an operator
rerun. Nor can stage 1 simply re-parent while retaining old canonical flags:
`uq_place_boundaries_city_canonical` is UNIQUE `(country_code, parent_id, slug)` WHERE canonical
city (`models.py:889-895`), so a live `parent_id` update with stale flags can collide two old
winners under one new parent and hard-fail. Conclusion: **stage 1 must not mutate any public
`place_boundaries` column at all.**

**The staged design** therefore splits each refresh into *compute* and *publish*:

- `compute_boundary_derivation(conn_session, scope)` — takes **no** advisory lock and mutates
  **nothing live, including `place_boundary_cells`**. The expensive work — the `ST_Subdivide`
  cells rebuild, place-kind classification, region parenting, and the dominant city-parenting
  geometry — writes results into **temp staging tables only**. Cells must be staged too, not
  committed early: `_ASSIGN_SQL` / `_ASSIGN_CANDIDATE_SQL` / `_CAPTURE_COUNTRY_CANDIDATES_SQL`
  decide fountain membership from the live cells, so early-committed new-generation cells
  combined with previous-generation public columns would let every add during the gap persist
  fountain membership/count/canonical changes computed from a **mixed generation** — cells are
  behavior-carrying state, not a neutral accelerator.

  **Staged dataflow — the compute phase must be generation-closed** (it may never read live
  `place_kind` / `is_canonical`, which stay previous-generation throughout compute): staged
  `place_kind` → **staged canonical-region winners** → staged region parents / staged city
  parents, with staged city parenting reading the **staged cells** and the **staged canonical
  relation**. The staged canonical-region relation is required because the live
  `_CITY_PARENT_*` SQL selects parents only from rows with `place_kind = 'region' AND
  is_canonical = true` — reproducing that against the *new* generation means deriving the winners
  from staged `place_kind` with the exact ordering the live selection uses (partition by
  `(country_code, slug)`, order `ST_Area(boundary) DESC, overture_id ASC`, per
  `_CANONICAL_REGIONS_*`), and identical country / no-region-tier behavior through
  `place_scope_config`. Publish then resets/sets the live canonical flags to precisely those
  staged winners, so the published parents were computed against the same winners being
  published.

  **Staging-cell schema carries the live table's performance contract**: the current rebuild
  builds a GiST index on the cell geometry and immediately runs `ANALYZE` — the code comments at
  `membership.py:91-114` document that without fresh statistics the planner degrades city
  parenting to sequential scans (the #239-class failure). The staged cell table therefore gets
  the same GiST `geom` index (plus the supporting `place_id` index used by scoped operations),
  is populated, indexed, and `ANALYZE`d **before** staged city parenting runs, and the staged
  city-parenting predicate keeps the constant-vs-indexed-column `ST_Covers(cell.geom, pt)` shape
  the index probe requires. Verification includes a plan-shape assertion (EXPLAIN over a
  representative fixture must show the GiST probe, not a sequential scan) — output equivalence
  alone cannot catch a catastrophic plan regression. The publish copy into the live table
  preserves the live table's FK/index expectations (cell row identity is not meaningful; IDs may
  be regenerated).
- `publish_membership_state(conn_session, scope)` — acquires `ADD_FOUNTAIN_LOCK`, then in ONE
  transaction, in this order — **canonical flags are cleared BEFORE staged hierarchy values are
  applied**, because the partial unique indexes are enforced immediately per statement, not at
  commit: applying a staged `parent_id` while previous-generation canonical flags are still set
  can collide two old canonical winners under one new parent on
  `uq_place_boundaries_city_canonical (country_code, parent_id, slug)` and abort the publish —
  (1) reset canonical flags for the scope while rows still have their old hierarchy; (2) replace
  the live cells from staging (scope-bounded `DELETE` — or `TRUNCATE` for full scope — plus a
  set-based `INSERT … SELECT`; this bulk copy sits inside the locked window by design, and is
  cheap relative to the geometry computation it replaces) and apply the staged place-kind/parent
  values to `place_boundaries` (indexed `UPDATE … FROM staging`); (3) set the live **region**
  canonical flags to exactly the staged winners; (4) the fountain-dependent tail — country scope:
  candidate capture (`_CAPTURE_COUNTRY_CANDIDATES_SQL`), candidate assignment, raw-city capture,
  affected-place accumulation, `recompute_place_counts`, `_REMAP_CITY_CANDIDATE_SQL`,
  final-changed recount, summary; full scope (spelled out — it has no candidate machinery):
  `_ASSIGN_SQL` over **all** fountains (which by construction includes any adds committed during
  or after derivation), recount, **city** canonical selection (`_CANONICAL_CITIES_SQL` —
  count-dependent), remap, recount, `_SUMMARY_SQL` (reads all fountains).

**Staging-table lifecycle — connection-scoped, owned explicitly.** Postgres temp tables belong to
the **physical connection**, not to a SQLAlchemy `AsyncSession` (which may check out a different
pooled connection after a commit). The staged flow therefore runs on a **single dedicated
`AsyncConnection`** acquired for the whole operation, with **one transaction-ownership idiom**
(tested under the installed SQLAlchemy 2.x): `async with engine.connect() as connection`,
construct `AsyncSession(bind=connection, expire_on_commit=False)`, and the bound session
**exclusively** owns the transaction lifecycle (autobegin / `await session.commit()` /
`await session.rollback()`) — no separate `connection.begin()/commit()` while the session owns
work, so the two layers can never fight over one transaction. A publish exception is rolled back
via the session **before** any cleanup SQL, and the `async with` exit returns the connection
with no open or aborted transaction. Temp tables drop with the connection. Because a pooled
physical connection can outlive a run and carry same-named temp tables from an earlier one,
compute starts with an unconditional `DROP TABLE IF EXISTS` + `CREATE TEMP TABLE` (never a bare
`IF NOT EXISTS` reuse), so stale staging can never leak between runs even on a reused
connection.

**Externally visible intermediate state, exactly**: between the stages, the only committed
changes are the new boundary rows the loader already committed before any refresh (today's
behavior). Cells, kinds, parents, and canonical winners all change **atomically in the publish
transaction**. On publish failure the transaction rolls back: public reads AND subsequent adds
operate on the coherent **previous** generation (old cells + old columns — no mixed-generation
writes are possible). Recovery is an **explicit rerun**: the CLI exits nonzero and the loader Job
fails visibly — the loader is deliberately `restartPolicy: Never` / `backoffLimit: 0` with no
silent retry (`loader_job_render.py`, spec 2026-07-15), and this design does not change that
orchestration. A failed publish therefore leaves a correct-but-stale previous generation until
the operator reruns the refresh — an acceptable, honest posture *because* generation atomicity
holds. A forced publish-failure test asserts public place/SEO endpoints still serve the previous
generation's winners **and** that an add performed after the failure uses the coherent previous
generation.

**Callers — one code path, two transaction layouts**:

- `boundary_cli` / `membership_cli` (standalone refreshes): on the pinned connection,
  `compute_boundary_derivation` → `commit` → `publish_membership_state` → `commit`. A failure
  between the stages leaves only staging (lost with the connection on process death) — publicly
  indistinguishable from "boundaries committed, refresh not yet run", the loader's existing
  re-runnable shape (`boundary_cli.py:126-128`).
- `refresh_country_memberships` / `refresh_all_memberships` remain as thin compositions running
  compute-then-publish **in the caller's single transaction with the advisory lock acquired
  first** — the exact current semantics — for the OSM merge path (`merge.py:152,521`), which
  calls the refresh inside its own advisory-locked, all-or-nothing merge transaction and MUST NOT
  have a commit injected mid-merge. Acquiring the advisory lock again there is a no-op (advisory
  xact locks are reentrant within a transaction). Because the merge holds the lock **before** any
  boundary work, the deadlock inversion cannot occur on that path. Both layouts execute the same
  compute/publish functions — no forked SQL.

**Deadlock analysis of the staged flow**:

- Compute transaction: writes only temp staging; it takes **no** live-table write locks and never
  waits on the advisory lock → it cannot be an edge in any cycle involving adds, and adds are
  entirely unaffected while the expensive geometry runs.
- Publish transaction: advisory lock first, then live-table locks (the cells replacement's
  `TRUNCATE`/`DELETE` + insert, the `place_boundaries` applies) — the same order as adds and
  admin ops → no inversion. An add that holds the advisory lock never coexists with publish
  holding it (mutual exclusion), and an add *waiting* for the advisory lock during publish is
  bounded by its `lock_timeout` → fast 503. The publish window (cells replacement + apply +
  canonical + assign + counts) is the residual add-blocking window; it excludes the dominant
  city-parenting geometry cost by construction.

**Convergence for adds during the gap**: an add that commits between the two stages assigns its
membership against the coherent **previous** generation (old cells, old public columns) and is
then re-derived by the publish pass (`_ASSIGN_SQL` covers all fountains; the country capture
covers the country's candidates). An add in flight when publish holds the lock waits (bounded) and then
assigns against final state. Either way the end state is identical to today's. This same mutual
exclusion (advisory lock across duplicate probe + insert) is the invariant the sibling #241
mobile design's timeout-reconciliation relies on — it is pinned here by an explicit two-session
concurrency test (Verification 2e) so a future refactor cannot silently break the client's
safety argument.

### Explicitly rejected alternatives

- **Same-transaction phase reorder**: deadlock by lock-order inversion, above.
- **Spatially scoped (cell) add-vs-add locks**: `recompute_place_counts` + canonical re-selection
  are snapshot recomputes over shared `place_boundaries` rows; two concurrent adds in one city
  would each recount from a snapshot missing the other's uncommitted row — undercounts and
  canonical flapping. Making that concurrency-safe is a redesign (per-place row locks plus
  slug-group locking) with its own deadlock analysis, unwarranted at current add volume. Recorded
  on #242 as future work if add-vs-add contention ever becomes measurable.
- Chunked/incremental OSM import commits (single-transaction rollback is load-bearing), changes
  to `seo_coverage_cli`'s session-level gate, and client copy changes.

## Scope and correctness

- No schema change; `alembic check` must stay drift-free. The new setting is config-only with a
  safe default (CI has no `.env`).
- The refresh refactor must be behavior-preserving on the merge path (single transaction, lock
  first) and produce identical outcomes on the staged path — assignments, counts, canonical
  winners, and summary numbers on the existing fixtures are the oracle. If any existing
  membership test disagrees, stop and re-derive the phase partition; do not adjust the test.
- Logging follows the observability standard: every new failure branch
  (`interactive_write_lock_timeout`, staged-refresh stage boundaries) emits structured events
  with correlation context and no secrets/PII/driver internals.

## Verification

Backend TDD (`./run.ps1 check -Backend` locally via the isolated `UV_PROJECT_ENVIRONMENT`; CI
authoritative):

1. `interactive_lock_timeout` + `set_config` SQL, through the real asyncpg/SQLAlchemy stack:
   applies and is transaction-local; the exact wrapper/`sqlstate` shape of a `lock_timeout` expiry
   under the installed versions is asserted; after the helper handles it, the session has been
   rolled back and is usable, no fountain row exists, and the WARNING carries
   `context`/`elapsed_ms`/correlation id and no driver internals. Non-55P03 database errors
   propagate untouched. A route-level held-row-lock test pins the context placement in
   `add_fountain` (reservation commit first, then the context — a misordering leaves the domain
   transaction unbounded and the test catches it).
2. Two-session tests (pattern from `test_osm_merge.py`): (a) `POST /fountains` against a held
   advisory lock → 503 with `Retry-After: 30` and body `{"detail":"busy"}` after ~the bound, and
   succeeds once freed; (b) admin patch/delete → same mapping; (c) **the actual staged lock
   graph**: a compute-stage transaction running concurrently with an add — the add proceeds
   normally (compute takes no live-table write locks); then a publish transaction holding the
   advisory lock and the live cells replacement while an add waits → the add 503s at the bound;
   neither side ever receives a `40P01` deadlock abort; (d) the v1 inversion scenario (an open
   transaction holding boundary-row locks + a concurrent add) retained as a timeout/error-mapping
   regression; (e) **the #241 reconciliation invariant, pinned**: two concurrent
   identical-coordinate creates serialize on the advisory lock across the duplicate probe +
   insert — one commits, the other deterministically receives the typed duplicate 409 (this is
   the property the mobile timeout-reconciliation design depends on).
3. OpenAPI contract: all three operations declare 503 + `Retry-After`; assertions mirror the 429
   tests.
4. Staged refresh: the full existing membership suite passes unchanged on both the merge-path
   composition and the staged path (same fixtures through `boundary_cli`-style invocation) —
   assignments, counts, canonical winners, summaries are the oracle; a test proves an add
   committed between the stages ends with correct final membership; a **forced publish-failure**
   test asserts (i) the publish transaction rolled back atomically — public place/SEO reads still
   serve the previous generation's cells, canonical winners, parents, and kinds (no cleared city
   canonicals, ever), (ii) **an add performed after the failure** computes membership from the
   coherent previous generation (the mixed-generation write path is impossible), and (iii) a
   rerun fully converges (idempotency). Connection-lifecycle tests: the staged flow runs both
   transactions on one pinned physical connection (identity asserted); two consecutive staged
   runs on a **reused** physical connection cannot leak stale staging (the unconditional
   drop/create is exercised); a publish exception leaves the connection with no open/aborted
   transaction. Generation-closure tests: an adversarial fixture where the new generation
   changes which rows qualify as regions AND changes the canonical-region winner — staged
   results must match the legacy single-transaction composition exactly (existing fixtures may
   not expose an accidental read of live canonical state). Plan-shape test: EXPLAIN over a
   representative staged city-parenting run shows the staged-cells GiST probe, not a sequential
   scan. Publish-order regression: a fixture with two previous-generation canonical cities
   sharing a slug, re-parented under one new parent — the ordered publish (reset-first) must not
   hit `uq_place_boundaries_city_canonical` and must converge to exactly one new canonical
   winner; plus a staged `place_kind` transition that changes partial-index participation.
5. Settings: default valid; `0`, negative, and > 60 s overrides rejected.

Production validation after deploy: correlate `advisory_lock_wait` with
`advisory_lock_acquired` **or** `interactive_write_lock_timeout` per request id — the timed-out
population must be visible, not inferred from acquired-only deltas, and a timeout event does NOT
imply an advisory wait (it may be a row/table-lock timeout after advisory acquisition); confirm
adds during a real boundary load's compute phase either succeed or 503 within the bound, and
that 503 rates fall back to zero outside refresh windows.

## Rollout

Normal PR gates (CI + Codex loop), then the manual backend deploy (`gh workflow run deploy.yml
--ref main`) — merging does not deploy. Deploy when no boundary load is in flight (loader runbook
rule). No mobile release dependency: the 503 path uses existing client handling; #241's client
timeout ships independently.
