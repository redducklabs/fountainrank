# Country candidate-capture rewrite + fail-closed loader session cancellation — design (2026-07-17)

Operational context: `handoffs/2026-07-17-boundary-fanout-failure-cascade-handoff.md`. Builds on
`2026-07-17-scoped-add-fountain-lock-design.md` (#245, staged compute/publish refresh) and
`2026-07-15-job-isolated-loader-design.md` (#236/#237, Job-isolated loaders). Supersedes §D of the
latter in one specific respect (below).

## Problem

The worldwide boundary fan-out exposed two production defects after the #239 city-parenting index
fix removed the previous bottleneck:

1. **`_CAPTURE_COUNTRY_CANDIDATES_SQL` is unbounded.** Spain reached `region_parented` in minutes,
   then spent the rest of its five-hour Job deadline inside
   `INSERT INTO membership_candidate_fountains ...`. The server-side statement survived the Job
   teardown and ran for **37+ hours** until manually terminated.
2. **Killing a loader Job does not cancel its in-flight PostgreSQL query.** A busy backend never
   reads its client socket, so it cannot notice the client died. Spain's orphaned statement kept
   `ADD_FOUNTAIN_LOCK` (transaction-scoped advisory lock); each subsequent serialized run then
   waited five hours on that lock, was killed at the deadline, and left **another** orphan advisory
   waiter. Observed cascade on 2026-07-17: one 37-hour root statement plus seven advisory waiters;
   seven consecutive five-hour workflow failures; zero queue progress. Recovery required manual
   `pg_terminate_backend` of all eight positively identified sessions.

Defect 2 invalidates the operational assumption in `2026-07-15-job-isolated-loader-design.md` §D
that "deleting the Job … drops the connection and releases the lock". Job deletion drops the
*client*; PostgreSQL only notices when it next touches the socket, which a long-running statement
never does. That assumption held in the #237 verification only because the killed session was
*waiting* on the advisory lock (a wait state that observed the disconnect sooner), not mid-query.

Both defects must be fixed before the fan-out can be re-dispatched: the first bounds the work, the
second bounds the damage any dead loader can do to the queue.

## Production evidence (2026-07-17, idle DB, rolled-back `EXPLAIN (ANALYZE, BUFFERS)` into a session-local temp table with a statement timeout)

Table sizes: `fountains` 285,107; `place_boundaries` 157,087; `place_boundary_cells` 892,841
(us 245,906; de 239,252; ee 42,031).

- **Current query, `cc=ee` (smallest loaded country): 85.2 s.** Plan: index scan over **all 285k
  fountains** with a correlated `EXISTS` SubPlan per fountain (GiST probe into
  `place_boundary_cells` + per-cell `place_boundaries` PK lookups; 3.8M shared-buffer accesses).
  The `OR` across two `EXISTS` blocks prevents the planner from decomposing the predicate into
  index-driven sets, so cost is O(world), not O(country) — with an empirically unbounded worst
  case under a freshly-published-cells run (Spain).
- **Set-based UNION rewrite (this spec): 14.5–20 s (ee), 32–41 s (us), 55 s (de, cold cache).**
  Bounded plan: the spatial branch drives from the country's cells
  (`ix_place_boundaries_country_kind` → hash join → one `ix_fountains_location_geometry` probe per
  country cell); the assignment branches resolve via the `pk_place_boundaries` /
  `ix_fountains_*_place_id` btrees.
- Every index the rewrite needs already exists (`ix_fountains_location_geometry` GiST,
  `idx_place_boundary_cells_geom` GiST, `ix_place_boundary_cells_place_id`,
  `ix_place_boundaries_country_kind`, the three `ix_fountains_*_place_id` btrees). No schema
  change.
- **PostgreSQL 17.10** (DO managed). `client_connection_check_interval`, `lock_timeout`,
  `application_name`, and the `tcp_keepalives_*` GUCs are all **`user` context** — settable
  per-session/per-connection without server reconfiguration. Server defaults:
  `client_connection_check_interval=0` (disabled — hence defect 2),
  `tcp_keepalives_idle=180`, `tcp_keepalives_interval=10`, `tcp_keepalives_count=6`.

## Decision

### 1. Rewrite `_CAPTURE_COUNTRY_CANDIDATES_SQL` as an exact-parity UNION

Replace the per-fountain `OR EXISTS` shape with a set union that computes the **same result set**:

```sql
INSERT INTO membership_candidate_fountains (id)
SELECT id FROM (
    SELECT f.id
    FROM place_boundaries pb
    JOIN place_boundary_cells cell ON cell.place_id = pb.id
    JOIN fountains f ON ST_Covers(cell.geom, f.location::geometry)
    WHERE pb.country_code = :cc
    UNION
    SELECT f.id
    FROM place_boundaries pb
    JOIN fountains f ON f.country_place_id = pb.id
    WHERE pb.country_code = :cc
    UNION
    SELECT f.id
    FROM place_boundaries pb
    JOIN fountains f ON f.region_place_id = pb.id
    WHERE pb.country_code = :cc
    UNION
    SELECT f.id
    FROM place_boundaries pb
    JOIN fountains f ON f.city_place_id = pb.id
    WHERE pb.country_code = :cc
) candidates
ON CONFLICT DO NOTHING
```

**Semantic equivalence argument** (the parity tests are the oracle, but the algebra is simple):
the current predicate is `EXISTS(spatial) OR EXISTS(pb.id IN (country, region, city))`. Branch 1
is exactly the spatial `EXISTS` unnested; branches 2–4 are the three-column `IN` unnested per
column (each an inner join, correctly skipping NULL columns). `UNION` (not `UNION ALL`)
deduplicates, replacing `SELECT DISTINCT`; `ON CONFLICT DO NOTHING` is unchanged. The
geography→geometry conversion and `ST_Covers` argument order are byte-identical to the current
query.

**The capture stays inside the locked publish tail** (position unchanged,
`_publish_country_tail`). It must see the just-published live cells and any fountains added while
compute ran unlocked (#245's convergence argument depends on this). The rewrite makes the locked
window acceptable (tens of seconds at current data volume) rather than moving the query.

**Recorded headroom, explicitly out of scope**: a bbox prefilter from the country-kind `boundary`
geography, or restricting the spatial branch to country-kind cells, could cut the spatial branch
further — both change or risk changing semantics and neither is needed to un-wedge the fan-out.
Revisit only with fresh production plans if capture time grows with data volume.

### 2. Loader session cancellation — layered bounds, each honest about what it covers

Today a dead loader's statement is **unbounded** (37+ hours observed) and its advisory waiters
are **unbounded**. This design does not claim an absolute "nothing can ever leak" invariant —
layer (b) depends on Kubernetes/API/backend availability and layer (a) on TCP semantics — it
replaces *unbounded* with **explicit, measurable per-failure-mode bounds** (table below), with a
worst-case orphan lifetime of ~15 minutes against today's infinity.

**(a) Loader sessions self-arm dead-client detection and identify themselves.**

- New optional settings in `app/config.py`, all with safe defaults that change nothing for the
  serving backend and local dev (documented by env-var name in `backend/README.md`):
  - `db_application_name: str | None = None` — when set, sent as the `application_name` startup
    GUC on every connection of the engine.
  - `db_client_connection_check_interval_ms: int | None = None` — when set (validated `gt=0,
    le=600_000`), sent as `client_connection_check_interval`.
  - `db_lock_timeout_ms: int | None = None` — when set (validated `gt=0, le=18_000_000`), sent as
    `lock_timeout` (layer c).
- Applied in `engine_connect_args()` via asyncpg `server_settings` (startup-packet GUCs; all
  three are `user` context on the production server — verified above). No settings configured →
  the returned connect args are unchanged.
- The loader Job manifest (rendered by `loader_job_render.py`) sets, for every loader:
  - `DB_APPLICATION_NAME` = the **session marker** (construction and validation in §2d — the
    renderer composes it internally from `--job-name` + `--run-id`; no raw marker string is ever
    passed across a tool boundary).
  - `DB_CLIENT_CONNECTION_CHECK_INTERVAL_MS=30000`.
  - `DB_LOCK_TIMEOUT_MS` per layer (c).
- Effect on a **busy statement**: when the pod dies, the connection closes (FIN/RST at container
  teardown; for silent network death, the server's keepalives mark the socket dead within ~5
  minutes conservatively — 180 + 10×6 = 240 s plus scheduling allowance, same arithmetic as the
  bounds table). The busy backend polls its socket every 30 s and **aborts the in-flight
  statement**;
  the transaction rolls back and the advisory lock releases. #245's publish atomicity makes this
  rollback safe by construction — the previous generation stays coherent.
- Effect on an **advisory-lock waiter**: PostgreSQL documents the connection check "while running
  queries"; whether it fires during a lock wait is settled **empirically by a CI integration test**
  (Verification 4). If it does, waiters share the 30 s bound; if it does not, waiters are bounded
  by layer (c)'s `lock_timeout` (15 min). The bounds table below claims only what the test proves.
- The loader logs `loader_session_config` at startup (marker, interval, lock timeout — no secrets,
  no DSN) so the armed state is diagnosable from logs alone.

**(b) Guaranteed-teardown reaper (belt and braces, and the fast path).**

- Shared marker module `backend/app/imports/loader_session.py` (see §2d) plus a reaper CLI
  `backend/app/imports/session_reaper.py`:
  `python -m app.imports.session_reaper --job-name <name> --run-id <id>`.
  - **Validates before any database connection**: `--job-name` must be in the fixed allow-list
    `{boundary-load, osm-import, osm-pbf-import}` (the only loader Jobs; extending the list is a
    reviewed code change), `--run-id` must be decimal digits. It composes the marker itself via
    the shared module — it never accepts a caller-supplied marker string, so it structurally
    cannot be pointed at the serving backend's (empty) `application_name` or any other session
    population.
  - Terminates only `pg_stat_activity` sessions of the current database whose `application_name`
    **equals** the composed marker and whose PID differs from its own backend.
  - Logs each terminated session as `loader_session_reaped` with PID, state, `wait_event_type`/
    `wait_event`, transaction age, and the marker — **never query text** (truncation is not
    redaction; the logging standard forbids raw payloads). Prints one JSON result line
    (`terminated` count, plus a `remaining` re-query count). Zero matches is success.
- **Teardown control flow (the current single `kubectl delete` line is replaced) — implemented as
  a tested stdlib state machine, not shell.** The state machine lives in
  `backend/app/imports/loader_teardown.py` (stdlib-only: `argparse`/`subprocess`/`json`/`time`,
  with the command runner and clock **injectable** so every branch is unit-testable without a
  cluster). A dedicated composite action `.github/actions/teardown-loader-job` is a thin adapter
  that only invokes it (invocation contract in §2d) from all three workflows' `if: always()`
  teardown step.

  **The platform sets the budget**: when a workflow run is cancelled, GitHub Actions gives the
  job — including its `if: always()` cleanup steps — a documented grace period of **5 minutes**
  from the cancellation request before the runner's remaining processes are force-terminated.
  The teardown must finish, or record failure, strictly inside that window, and it shares the
  window with runner/step overhead. `loader_teardown.py` therefore enforces a **global hard
  wall-clock deadline of 210 s** (3.5 minutes, ≥90 s platform margin): every subprocess timeout
  and inter-attempt sleep is capped by the remaining global budget; a phase whose remaining
  budget cannot cover one attempt proceeds immediately to final structured failure instead of
  starting an attempt that cannot finish; and the final diagnostics + exit always occur before
  the deadline.

  Phases — each captures its status; a later success never erases an earlier failure; no phase
  aborts the remaining ones; nominal per-phase budgets, each additionally capped by the global
  deadline:
  1. `kubectl delete job` (`--ignore-not-found --wait --timeout=30s`), one attempt.
  2. Verify **pod absence** for the Job selector: poll every 5 s, 6 attempts (~30 s ceiling).
  3. Run the reaper via `kubectl exec` into the serving backend Deployment: 3 attempts, 5 s
     backoff, 20 s per-attempt command timeout (~70 s ceiling). The reaper re-queries after
     terminating and reports `remaining`; its JSON result line is parsed (malformed output =
     attempt failure).
  4. If `remaining > 0`, re-run the reaper: 3 attempts, 5 s apart, 15 s per-attempt timeout
     (~55 s ceiling — covers the terminate race and a straggler pooled connection).
  5. Exit **nonzero with structured diagnostics** (phase statuses, identifiers — no secrets) if
     any phase failed: Job delete failed, pods could not be confirmed absent, the reaper was
     unreachable or unparseable, matching sessions remain, or the global deadline curtailed any
     phase. Pod-absence-unconfirmed is explicitly NOT success even with `remaining == 0`, because
     a still-live loader process could reconnect afterwards; the run-scoped marker makes any such
     reconnect attributable and re-reapable.
  Serial worst-case sum of the nominal budgets is ~185 s, under the 210 s hard deadline, which is
  in turn under the 5-minute platform window with margin; the healthy path (delete + absence
  confirm + one clean exec) completes in ≤ ~60 s. A teardown killed by the platform anyway (e.g.
  runner death) leaves residue that layers (a)/(c) bound. These constants are the production
  defaults; tests inject shortened values while separately asserting the defaults, and fake-clock
  boundary tests prove the global deadline is never exceeded, later phases receive the reduced
  remaining timeout, and final diagnostics/exit occur before the configured ceiling.
- Because job cancellation kills the in-flight `run-loader-job` step, the caller's `if: always()`
  teardown is the guaranteed path on **every** outcome (success, failure, cancel, deadline).

**(c) Bounded loader lock waits.**

- The loader Jobs set `DB_LOCK_TIMEOUT_MS=900000` (15 minutes). `lock_timeout` bounds **only lock
  waits** — advisory, row, or table — never executing statements.
- **Reconciliation with `2026-07-15-job-isolated-loader-design.md` §D**, which this spec
  supersedes *only as follows*: §D rejected a loader `statement_timeout`, and that rejection
  stands — `statement_timeout` would abort the legitimately long membership statements. But §D's
  second argument ("the Job model already covers the wedged case … deleting the Job … releases the
  lock") is disproven by this incident. `lock_timeout` does not share `statement_timeout`'s flaw:
  the loaders are strictly serialized by the shared `queue: max` concurrency group, so the only
  legitimate advisory-lock holders a loader can wait behind are interactive writes, which hold the
  lock for at most their own 8-second bounded transaction (#245). A loader waiting 15 minutes on
  any lock is therefore *definitionally* behind an orphan or a wedged holder, and failing fast
  with a visible nonzero Job beats burning the five-hour deadline and re-feeding the cascade.
- This supersedes #245 §1's "bulk/CLI paths keep the unbounded wait as deliberate policy" for the
  Job-isolated loader paths specifically: that policy's premise ("a job queues patiently and is
  monitored/cancellable by its operator") assumed cancellation worked. Non-Job callers (local dev
  CLI use without the env vars) keep unbounded waits — the settings default to `None`.
- On a `lock_timeout` expiry the CLI surfaces SQLSTATE `55P03` as a normal fatal error: the Job
  fails, teardown runs, the reaper sweeps. No new error-mapping machinery — the loader's existing
  fail-visibly contract (`restartPolicy: Never`, `backoffLimit: 0`) is the handler.

**(d) The session marker — one implementation, validated components, never a free string.**

- `loader_session.py` owns `compose_session_marker(job_name, run_id) -> str` returning
  `loader:<job_name>:<run_id>`, and the validation used by every consumer:
  - `job_name` ∈ the fixed allow-list above;
  - `run_id` matches `^[0-9]{1,20}$`;
  - the composed marker is ASCII and **≤ 63 bytes** (PostgreSQL truncates `application_name` at
    `NAMEDATALEN-1`; truncation would silently break exact matching, so overlength is a hard
    error — with the allow-list the maximum is far below the limit, and the check pins that).
- The renderer (`--job-name` it already effectively has, plus new `--run-id`), the reaper, and
  the teardown state machine all compose the marker through this one function; the composite
  actions pass **components** (`job_name` input, `$GITHUB_RUN_ID`), never a composed string.
  There is exactly one place the string shape exists.
- **Runner-side invocation contract**: the modules that run on the GitHub runner
  (`loader_job_render`, `loader_teardown`) are stdlib-only, and the single supported invocation
  is `PYTHONPATH=backend python3 -m app.imports.<module>` from the repository root (both
  `app/__init__.py` and `app/imports/__init__.py` are empty, so the package import pulls in no
  application dependencies). The composite actions use exactly this form — the renderer's current
  script-path invocation is migrated to it — so `loader_session` imports identically on the
  runner and in-image (`python -m app.imports.session_reaper`). A test executes the exact
  runner-side command as a subprocess from the repo root.
- Rejection tests (Verification 3) prove bad job names (including the serving backend's empty
  application name, lookalike prefixes, control characters), bad run ids, and overlength
  compositions are refused **before** any database connection.

**Failure-mode bounds** (the honest replacement for an absolute invariant; "detection" =
statement aborted / session terminated, advisory lock released):

| Failure mode | Owning layer | Bound (conservative) |
| --- | --- | --- |
| Workflow cancel / Job deadline / pod delete, everything healthy | (b) teardown reaper | ≤ ~60 s (teardown healthy path: delete + absence confirm + one clean exec) |
| Same, but reaper unreachable (API/backend/exec outage) | (a) check interval | ≤ ~1 min after socket close (FIN/RST at pod teardown + 30 s poll + allowance) |
| Node loss / silent network partition (no FIN ever sent), reaper unreachable | (a) keepalives + check interval | ≤ ~5 min (keepalive failure 180 + 10×6 = 240 s, + ≤30 s poll, + scheduling allowance) |
| Orphaned **advisory waiter**, reaper unreachable | (a) if the CI probe proves check-interval fires in lock waits, else (c) | ≤ ~1 min, else ≤15 min (`lock_timeout`) |
| PostgreSQL process failure / restart | the server itself | sessions and locks die with the server; nothing to reap |
| PostgreSQL running but network-isolated from cluster and reaper | (a) for busy statements, (c) for waiters | ≤ ~5 min busy / ≤15 min waiter (same arithmetic as the partition rows) |
| Teardown partially fails (delete timeout, exec flake) | (b) state machine | reap still attempted independently of delete status; global hard deadline 210 s (inside GitHub's 5-minute post-cancel window); step fails loudly; residue bounded by (a)/(c) |

Worst case **≤15 minutes** (an advisory waiter with the reaper unreachable, if the CI probe shows
check-interval does not cover lock waits) — versus unbounded today. Every "reaper unreachable"
row also ends in a **failed, visible teardown step**, so there is no silent reliance on the
passive bounds.

### Explicitly rejected alternatives

- **`statement_timeout` on loader sessions** — still rejected; §D's first argument stands (it
  would kill legitimately long membership statements, exactly the large loads this must support).
- **Raising `activeDeadlineSeconds`** — makes the cascade slower to surface while preserving
  unbounded database work (handoff guardrail).
- **Narrowed capture semantics (country-kind-only cells / bbox prefilter)** — parity risk for a
  performance win the fan-out does not need; recorded as headroom above.
- **Changing server-level GUCs via the DO console** (e.g. a global
  `client_connection_check_interval`) — invisible to the repo, unreviewed, applies to the serving
  backend where it is unnecessary; per-session config is code-reviewed, scoped, and testable.
- **Reaping by `client_addr`/query-shape or a caller-supplied marker string** — ambiguous (all
  cluster egress shares one address; query shapes recur) or an inadequate authorization boundary
  (an arbitrary string can name any session population); the component-validated allow-list is
  the boundary.
- **A dedicated reaper execution surface (one-shot Job / separate service)** instead of
  `kubectl exec` into the serving Deployment — it would survive a serving-backend outage, but in
  that outage the DB is equally likely unreachable, layers (a)/(c) still bound the damage, and
  the extra moving part (image, RBAC, manifest) is not warranted; recorded as a revisit condition
  if a real incident ever exhausts both (a) and (b).

## Scope and correctness

- **No schema change**; `alembic check` must stay drift-free. All new settings are config-only
  with `None` defaults (CI has no `.env`; the serving backend's behavior is byte-identical).
- **Membership parity is the oracle** for the capture rewrite: the full existing membership suite
  must pass unchanged, plus a same-snapshot equivalence test (old query vs new query over
  identical data — Verification 1). If any existing test disagrees with the rewrite, the rewrite
  is wrong — fix the SQL, never the test.
- The reaper is a mutating operational tool: component-validated inputs only, exact-match
  termination, never its own backend, validation before connection.
- Logging follows the observability standard: `loader_session_config`, `loader_session_reaped`
  (metadata only — **no query text**), the existing publish-stage markers; never DSNs, secrets,
  or payloads.

## Verification

Backend TDD (`./run.ps1 check -Backend` via the isolated `UV_PROJECT_ENVIRONMENT`; CI
authoritative; CI runs against real PostGIS 17):

1. **Capture parity**:
   - The full existing membership suite passes unchanged.
   - **Same-snapshot equivalence**: a test fixture runs the OLD capture SQL (kept verbatim in the
     test as the oracle) and the NEW SQL against the same seeded state and asserts identical
     captured ID sets.
   - Branch fixtures: spatial-only (all place columns NULL), assignment-only per column (located
     outside every cell), both (deduplicates), neither (absent).
   - **Cross-country fixtures**: a fountain spatially inside the refreshed country's cells while
     assigned to another country's places; a fountain outside the country with one target-country
     assignment and two foreign assignments. Assert captured IDs, affected-place IDs (including
     the foreign places), old/new place counts, canonical remapping, and final membership —
     through the staged country refresh, not just the raw SQL.
2. **`engine_connect_args`**: with no new settings → result unchanged (including the empty
   plaintext case); with each setting → `server_settings` carries the GUC, asserted against a
   live connection via `SHOW` (application_name verbatim; intervals in ms). Settings validation:
   zero/negative/over-limit rejected.
3. **Marker + reaper**: `compose_session_marker` accepts exactly the allow-listed names and
   decimal run ids and enforces the 63-byte bound; rejection tests (serving/empty names,
   lookalike prefixes such as `loaderx:`/`loader::`, control characters, non-decimal run ids,
   overlength) prove refusal **without a database connection** (asserted by construction — the
   validator runs before connect). Live: the reaper terminates a session bearing the exact
   marker, leaves a differently-marked and an unmarked session alive, reports
   `terminated`/`remaining`, exits 0 on zero matches, and its log events carry no query text.
4. **Cancellation mechanics (CI Postgres, real network)**:
   - **Busy-query cancellation**: session A (configured with `client_connection_check_interval`
     ≈1 s) acquires the advisory lock and runs a long `pg_sleep`; the test **aborts A's socket
     without a protocol goodbye** (asyncpg `transport.abort()`); assert the server-side session
     disappears and a queued advisory waiter unblocks, within a few seconds.
   - **Lock-wait coverage probe**: same shape but A is *waiting* on the advisory lock when its
     socket is aborted; the test records whether the waiter is culled within the check interval.
     The bounds table row for waiters is written from this result (30 s if culled, else 15 min
     via `lock_timeout`), and the test pins whichever behavior the installed PG 17 exhibits.
   - **`lock_timeout` end-to-end**: a loader-configured session blocked on
     `pg_advisory_xact_lock` receives SQLSTATE `55P03` at ~the bound and the
     `run_staged_membership_refresh` path fails nonzero (short test bound).
5. **Renderer**: manifest contains the three env vars with the marker composed from
   `--job-name`/`--run-id`; invalid job name / run id rejected; existing argv-escaping tests
   unchanged.
6. **Teardown state machine (executable failure-path matrix, pytest with an injected fake
   command runner and clock — no cluster needed)**: command order (delete → absence poll → exec →
   re-query); retry counts and backoff per phase match the injected config; production default
   constants asserted separately; reaping is attempted after a delete failure; a later phase's
   success never erases an earlier phase's failure; unconfirmed pod absence is fatal even with
   `remaining == 0`; a transient exec failure followed by success recovers; permanently
   unreachable reaper exhausts retries and fails; malformed reaper JSON is an attempt failure;
   `remaining > 0` then `0` succeeds, exhausted re-query budget fails; multiple simultaneous
   phase failures all appear in diagnostics; the healthy path and the zero-match path exit 0;
   diagnostics contain identifiers and statuses but no secrets. **Global-deadline boundary tests
   (fake clock)**: the 210 s hard deadline is never exceeded on any path; per-attempt subprocess
   timeouts and sleeps are capped by the remaining budget; a phase with insufficient remaining
   budget skips directly to final structured failure; final diagnostics/exit occur before the
   ceiling; the production default constants (and their sum being < 210 < the 5-minute platform
   window) are asserted. A subprocess test runs the exact
   runner-side invocation (`PYTHONPATH=backend python3 -m app.imports.loader_teardown --help`,
   and the renderer equivalently) from the repository root.
7. **Workflows/actions**: `actionlint` (via WSL) green on all touched files; the composite
   actions pass components (`job_name`, `$GITHUB_RUN_ID`), never a composed marker string.

Production validation after deploy (ordered, before any bulk re-dispatch):

1. Deploy with no boundary load in flight; validate `/readyz`, homepage, live image SHA.
2. **Spain end-to-end** on the new image — the previously failing country. Assert from logs:
   `loader_session_config` armed; capture completes inside the publish window in seconds-to-
   minutes, not hours; run succeeds; committed-cells check for `es` true.
3. **Publish-stage cancellation drill (the incident's actual failure mode)**: dispatch a further
   country, watch logs for `publish_started` (the advisory lock is held and the capture/tail is
   executing), cancel the workflow inside that window, then assert: the marked session and any
   advisory waiter are gone within the documented bound; the teardown step reports the reap;
   `place_boundary_cells`/counts/canonical state for that country show no partial publish (the
   publish transaction rolled back atomically); a clean re-dispatch of the same country converges.
   If the cancel misses the publish window (it is short), repeat the drill. A compute-stage
   cancel is run once as secondary coverage (process-loss during unlocked staging).
4. Only then re-dispatch the remaining missing countries and watch the queue drain.

## Rollout

Branch → PR → all CI green → independent Codex review loop to `VERDICT: APPROVED` → every PR
comment addressed → squash-merge → manual CI deploy (`gh workflow run deploy.yml --ref main`,
which also ships the merged-but-undeployed #245) → the production validation sequence above →
re-dispatch. Registry rows for expected zero-feature territories (`fo gg im je nc xk`) are retired
via separate reviewed one-line PRs only after a confirmed fail-closed load attempt on the new
image.
