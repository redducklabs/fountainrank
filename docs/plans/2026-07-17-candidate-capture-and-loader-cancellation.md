# Implementation plan — candidate-capture rewrite + fail-closed loader cancellation (2026-07-17)

Spec: `docs/specs/2026-07-17-candidate-capture-and-loader-cancellation-design.md` (Codex
`VERDICT: APPROVED`, review round 4). One branch, one PR; tasks land as separate commits in this
order, TDD within each task. Every task's tests run via `./run.ps1 check -Backend` (isolated
`UV_PROJECT_ENVIRONMENT`; CI authoritative against real PostGIS 17).

Review-4 minor incorporated here: the teardown state machine defines an explicit
`FINALIZATION_RESERVE_SECONDS` never lent to subprocesses or sleeps (details in Task 7).

## Task 1 — shared session-marker module

`backend/app/imports/loader_session.py` (stdlib-only — it must import on a bare GitHub runner):

- `LOADER_JOB_NAMES = frozenset({"boundary-load", "osm-import", "osm-pbf-import"})` — extending
  this allow-list is a reviewed code change.
- `compose_session_marker(job_name: str, run_id: str) -> str` returning
  `loader:<job_name>:<run_id>`; raises `ValueError` unless `job_name ∈ LOADER_JOB_NAMES`,
  `run_id` matches `^[0-9]{1,20}$`, and the composed marker is ASCII and ≤ 63 bytes (PostgreSQL
  `NAMEDATALEN-1` truncation would silently break exact matching).

Tests (`backend/tests/test_loader_session.py`): the three allow-listed names compose correctly;
rejection matrix — unknown/empty job name, lookalikes (`boundary-load2`, case variants), control
characters, empty/non-decimal/overlong run ids, and the composed-length bound (monkeypatch the
allow-list with an overlength ASCII name via pytest's `monkeypatch` fixture and call the
**public** `compose_session_marker` — pinning that the public path enforces the bound, not merely
that an internal helper exists). No database involvement anywhere in this module.

## Task 2 — config settings + engine server_settings

`backend/app/config.py`:

- `db_application_name: str | None = None`
- `db_client_connection_check_interval_ms: Annotated[int, Field(gt=0, le=600_000)] | None = None`
- `db_lock_timeout_ms: Annotated[int, Field(gt=0, le=18_000_000)] | None = None`

`backend/app/db.py` `engine_connect_args()`: when any of the three is set, add
`"server_settings": {...}` with string values (`application_name` verbatim; the two intervals as
`str(ms)` — PostgreSQL parses a bare integer for these GUCs as milliseconds). No settings set →
returned dict unchanged (both the TLS and the plaintext local-dev shapes).

Also `backend/app/db.py`: `log_session_config(settings)` — logs one INFO
`loader_session_config` (`application_name`, `client_connection_check_interval_ms`,
`lock_timeout_ms`; no DSN, no secrets) only when at least one is set; called from **exactly the
two current Job entrypoints** — `app.imports.boundary_cli` and `app.imports.cli` — right after
`configure_logging()` and before any database work. `app.imports.membership_cli` is explicitly
unchanged (it is not wired through `run-loader-job`); if it ever becomes a Job entrypoint, it
adopts the same call then.

Tests (`backend/tests/test_db_config.py` or the existing config/db test module):

- **Parameterized `engine_connect_args` matrix**: each of the three settings alone, all three
  together, and a representative partial pair — each case asserts the **exact returned dict
  shape** (a `server_settings` entry appears with exactly the configured GUCs and correct string
  values, and nothing else changes).
- **TLS merge**: with `db_ssl_root_cert` configured (SSL-context creation mocked for the
  dict-shape assertion), the all-three case and at least one single-setting case return
  `{"ssl": ctx, "server_settings": {...}}` — merged, neither key displacing the other. The exact
  unchanged `{}` (plaintext) and `{"ssl": ctx}` (TLS) shapes are retained when no new setting is
  set.
- **Live `SHOW`**: against the CI database, an engine configured with all three settings reflects
  them via `SHOW application_name` / `SHOW client_connection_check_interval` /
  `SHOW lock_timeout`; plus one live single-setting case (only
  `db_client_connection_check_interval_ms`) proving conditional assembly works for a lone
  optional setting.
- Settings validation (0, negative, over-limit rejected); `loader_session_config` emitted/not
  emitted appropriately and contains no DSN; one entrypoint-level test per modified CLI proving
  the log fires after `configure_logging()` and before database work (patch the engine to fail
  if touched first).

Document the three env vars by name in `backend/README.md`.

## Task 3 — capture SQL rewrite + parity tests

`backend/app/membership.py`: replace `_CAPTURE_COUNTRY_CANDIDATES_SQL` with the four-branch
UNION from the spec (verbatim). No other SQL changes.

Tests (extend `backend/tests/test_membership.py`, reusing the scoped-fixture helpers):

- **Same-snapshot equivalence**: the OLD query text kept verbatim in the test as the oracle.
  Pinned approach: **one `REPEATABLE READ` transaction, one canonical temp table** — set the
  isolation level before the first statement (asserted in-test via
  `SHOW transaction_isolation`), create `membership_candidate_fountains`, run the verbatim old
  query, collect its UUID set, `TRUNCATE`, run the production (new) query on the same still-open
  transaction, collect, compare sets. `REPEATABLE READ` makes it one genuine snapshot (default
  `READ COMMITTED` re-snapshots per statement); both texts verbatim.
- **Branch fixtures**: spatial-only (place columns NULL), assignment-only per column (fountain
  outside every cell), both (dedupes to one row), neither (absent).
- **Cross-country fixtures**: fountain spatially in the refreshed country but assigned to a
  foreign country's places; fountain outside the country with one target-country and two foreign
  assignments. Assert captured IDs, affected-place IDs (foreign places included), old/new
  counts, canonical remapping, final membership — through the staged country refresh
  (`run_staged_membership_refresh`), asserting `candidate_fountains` in the summary.
- Full existing membership suite green, unchanged. If any existing test disagrees, the SQL is
  wrong — fix the SQL.

## Task 4 — session reaper CLI

`backend/app/imports/session_reaper.py`
(`python -m app.imports.session_reaper --job-name <name> --run-id <id>`):

- Validates via `compose_session_marker` **before** any database connection; refuses otherwise.
- On the app engine (`get_engine()`), one statement selecting `pid, state, wait_event_type,
  wait_event, now() - xact_start` + `pg_terminate_backend(pid)` for sessions of the current
  database where `application_name = :marker AND pid <> pg_backend_pid()`; then a re-query
  counting survivors.
- Logs `loader_session_reaped` per terminated session (PID, state, wait events, xact age,
  marker — **never query text**); prints one JSON line `{"terminated": n, "remaining": m}`.
  Zero matches → exit 0.

Tests (`backend/tests/test_session_reaper.py`): invalid inputs refused with no engine creation
(monkeypatch `get_engine` to fail the test if touched); live — open a raw asyncpg/SQLAlchemy
session with `application_name` set to a composed marker, another with a different marker, one
unmarked; run the reaper; only the exact-marker session dies; JSON counts correct; log records
carry no `query` field; zero-match path exits 0.

## Task 5 — cancellation-mechanics integration tests

`backend/tests/test_loader_cancellation.py` (CI Postgres, real sockets):

- **Busy-query cancellation**: raw asyncpg connection A with
  `server_settings={"client_connection_check_interval": "1000"}`; A takes
  `pg_advisory_xact_lock` and starts a long `pg_sleep` (background task); abort A's transport
  with no protocol goodbye (`connection._transport.abort()` or the public equivalent under the
  installed asyncpg); assert via a second connection that A's backend disappears and a queued
  advisory waiter acquires the lock, within a few seconds (generous CI bound). The background
  `pg_sleep` task MUST be awaited/gathered and its disconnect exception asserted (no
  "Task exception was never retrieved" warnings), and every surviving connection is
  deterministically closed in test teardown.
- **Lock-wait coverage probe**: same, but A is *waiting* on the advisory lock when aborted;
  record and pin the observed behavior (culled within the interval, or not). If the probe shows
  lock waits are NOT covered, update the spec's bounds-table waiter row wording in the same
  commit (it already documents both outcomes; the pin removes the ambiguity).
- **`lock_timeout` end-to-end**: engine configured with a short `db_lock_timeout_ms`; hold the
  advisory lock from a second session; `run_staged_membership_refresh` fails with a `DBAPIError`
  carrying SQLSTATE `55P03` at ~the bound (assert elapsed ≪ unbounded).

## Task 6 — renderer: marker + GUC env injection

`backend/app/imports/loader_job_render.py`:

- New required `--run-id`; compose the marker via `loader_session` (invalid inputs exit
  nonzero). Inject into the container env: `DB_APPLICATION_NAME=<marker>`,
  `DB_CLIENT_CONNECTION_CHECK_INTERVAL_MS=30000`, `DB_LOCK_TIMEOUT_MS=900000`.

Tests (`backend/tests/test_loader_job_render.py`): env vars present with composed marker;
invalid job name/run id rejected; existing argv-escaping and manifest tests unchanged. Plus a
subprocess test running the exact runner-side invocation from the repo root:
`PYTHONPATH=backend python3 -m app.imports.loader_job_render --help` (import-clean on a bare
interpreter; on Windows dev the test uses `sys.executable` with the same `PYTHONPATH` mechanics).

## Task 7 — teardown state machine

`backend/app/imports/loader_teardown.py` (stdlib-only; command runner and clock injectable):

- Constants (production defaults, asserted by test): `GLOBAL_DEADLINE_SECONDS = 210`,
  `FINALIZATION_RESERVE_SECONDS = 10` (never lent to subprocesses or sleeps — attempt timeouts
  are computed from `deadline − now − reserve`, and an attempt that cannot fit is skipped
  straight to final structured failure), delete `--wait --timeout=30s` one attempt; absence poll
  5 s × 6; reaper exec 3 × 20 s + 5 s backoff; re-query 3 × 15 s + 5 s apart. Serial nominal
  worst case ~185 s < 210 s < GitHub's 5-minute post-cancellation window.
- Phase results collected into a structured summary printed at the end; exit nonzero if any
  phase failed or was curtailed; later success never erases earlier failure; pod-absence
  unconfirmed is fatal even with `remaining == 0`.
- CLI: `--job-name`, `--run-id` (validated via `loader_session`), `--namespace`.

Tests (`backend/tests/test_loader_teardown.py`, fake runner + fake clock — the full spec
Verification-6 matrix): command order; retry counts/backoff per injected config; production
defaults asserted; reap attempted after delete failure; failure preservation; absence-unconfirmed
fatal; transient exec failure recovery; permanent failure exhausts; malformed JSON = attempt
failure; `remaining > 0 → 0` success; exhausted re-query fails; multiple failures all in
diagnostics; healthy and zero-match paths exit 0; no secrets in diagnostics; global-deadline
boundary tests (never exceeded, capped timeouts, insufficient-budget skip, pre-deadline exit,
reserve honored); subprocess `--help` invocation test as in Task 6.

## Task 8 — composite actions + workflows

- New `.github/actions/teardown-loader-job/action.yml`: inputs `job_name`, `run_id`,
  `namespace`; single step running
  `PYTHONPATH=backend python3 -m app.imports.loader_teardown --job-name "$JOB_NAME"
  --run-id "$RUN_ID" --namespace "$NS"`. No marker string composed in YAML.
- **Injection-safe input transport (both composite actions)**: every action input crosses into
  the shell **only** via the step's `env:` block and is then passed as a double-quoted shell
  variable — `${{ inputs.* }}` / `${{ github.* }}` expressions are NEVER interpolated directly
  into `run:` scripts (the shell would parse metacharacters/substitutions before Python sees
  argv). The same rule applies to the new `run_id` plumbing in `run-loader-job` (the existing
  action already follows this pattern for its inputs — preserve it). `loader_teardown` also
  validates `--namespace` (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, the Kubernetes namespace
  grammar) so an adversarial value is rejected in Python even if it arrives intact.
- **Action-boundary static assertion (pytest)**: a test parses both composite action YAML files
  and asserts no `${{` expression appears inside any `run:` script body (expressions are
  permitted only in `env:` values and non-script fields); plus argv-level tests that adversarial
  values (spaces, quotes, `$()`, backticks, semicolons, newlines) passed as `--namespace`/
  `--job-name`/`--run-id` reach the injectable command runner as single argv elements or are
  rejected by validation without any subprocess call.
- `.github/actions/run-loader-job/action.yml`: new required `run_id` input; renderer invocation
  migrated to `PYTHONPATH=backend python3 -m app.imports.loader_job_render` with `--run-id`.
- All three workflows (`osm-boundary-load.yml`, `osm-import.yml`, `osm-import-pbf.yml`): pass
  `run_id: ${{ github.run_id }}` to `run-loader-job`; replace the single-line guaranteed-teardown
  step with `teardown-loader-job` (same `if: always()`).
- Verify with `wsl.exe -e ./temp/actionlint/actionlint` on each touched workflow file (composite
  action files are validated by actionlint through the workflows referencing them; also run it
  directly where supported).

## Task 9 — docs, handoff, full mirror, PR

- `backend/README.md`: the three env vars (names only) + the reaper/teardown module contracts.
- Update `handoffs/2026-07-17-boundary-fanout-failure-cascade-handoff.md` with a short
  "continuation status" note pointing at the spec/plan/PR (keep the original content).
- Full `./run.ps1 check` (not just `-Backend`) before the PR; then branch → PR → CI green →
  Codex PR loop → squash-merge per `claude_help/codex-review-process.md`.

## Post-merge (operational — the spec's production-validation criteria, restated in full so each
step is independently executable)

1. Deploy (`gh workflow run deploy.yml --ref main`, no boundary load in flight); validate
   `/readyz` 200, homepage 200, and that the live backend image SHA matches the merge commit.
2. **Spain end-to-end** on the new image. Acceptance: `loader_session_config` present in the
   loader logs (marker + intervals armed); candidate capture completes inside the publish window
   in seconds-to-minutes, not hours; the run succeeds; the committed-cells check returns true
   for `es` (`SELECT EXISTS` over `place_boundary_cells JOIN place_boundaries` with
   `country_code='es'`).
3. **Publish-stage cancellation drill**: dispatch a further country; watch logs for
   `publish_started` (advisory lock held, capture/tail executing); cancel the workflow inside
   that window. Acceptance: the marked session and any advisory waiter are gone within the
   documented bound; the teardown step reports the reap and exits per its contract; the
   country's `place_boundary_cells`/counts/canonical state shows no partial publish (the publish
   transaction rolled back atomically); a clean re-dispatch of the same country converges. **If
   the cancel misses the short publish window, repeat the drill.** Run one compute-stage cancel
   as secondary coverage (process loss during unlocked staging).
4. Re-dispatch the remaining missing countries; reconcile with the committed-cells query (a
   failed/cancelled run is not proof of rollback — committed cells are the source of truth);
   verify the queue drains rather than accumulating deadline failures; retire confirmed
   zero-feature registry rows (`fo gg im je nc xk`) via separate reviewed one-line PRs only
   after a confirmed fail-closed load attempt on the new image.
