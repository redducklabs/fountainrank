# Handoff — fan-out fix shipped and proven; monitor the queue to drain (2026-07-17, late)

Supersedes the operational portion of `handoffs/2026-07-17-boundary-fanout-failure-cascade-handoff.md`
(keep that file for the incident record). Both defects from that incident are **fixed, merged,
deployed, and production-proven**. The worldwide fan-out is re-dispatched and draining. The next
session's job is to **monitor the queue to completion**, handle the expected special cases, and
finish two small trailing items. No design work is pending.

## 1. What shipped (all gates passed: CI green + Codex `VERDICT: APPROVED` + comments addressed)

- **PR #248** (`01514db`, **deployed** — live backend image `01514db594ec`, verified):
  - `_CAPTURE_COUNTRY_CANDIDATES_SQL` rewritten as an exact-parity index-driven 4-branch UNION
    (was O(all fountains) `OR EXISTS`; ran 37+ h on Spain, now bounded by country size).
  - Fail-closed loader cancellation: loader sessions arm `application_name =
    loader:<job>:<github-run-id>` + `client_connection_check_interval=30s` + `lock_timeout=15min`
    (asyncpg `server_settings`; config in `app/config.py` → `app/db.py`, marker composed ONLY in
    `backend/app/imports/loader_session.py`); run-scoped session reaper
    (`python -m app.imports.session_reaper --job-name X --run-id Y`, allow-listed components);
    budgeted teardown state machine (`app.imports.loader_teardown`, hard 210 s deadline) wired
    into all three loader workflows via `.github/actions/teardown-loader-job`.
  - Spec: `docs/specs/2026-07-17-candidate-capture-and-loader-cancellation-design.md`;
    plan: `docs/plans/2026-07-17-candidate-capture-and-loader-cancellation.md`.
- **PR #251** (`67e88ee`, **merged, NOT yet deployed** — see §5):
  - Timed publish-stage log events (`publish_cells_replaced`, `publish_derivation_applied`,
    `candidates_captured`, `candidates_assigned`, `place_counts_recomputed`) — the
    observability half of #249. Needs the next backend deploy to take effect.
  - Loader pod `terminationGracePeriodSeconds` 30→5 + teardown `ABSENCE_POLL_ATTEMPTS` 3→4
    (closes #250). **Already effective** for queued runs — workflows check out `main` at run
    start, so no deploy is needed for the teardown/renderer half.

## 2. Production proof already obtained (do not re-prove)

- **Spain end-to-end**: run `29613690452`, success in 1h46m (previously three consecutive 5-hour
  deadline deaths). 90,023 committed cells; 42,891 fountains assigned. Marker + GUCs confirmed
  armed in its `loader_session_config` log line.
- **Publish-stage cancellation drill** (the incident's exact failure mode): Hungary run
  `29619375079` cancelled **1 s after `publish_started`** → mid-publish DB session dead in
  **~58 s**; teardown report showed reap `terminated=1` → re-query `remaining=0`; publish rolled
  back atomically (0 hu cells, 0 canonical/counted rows); clean re-dispatch (`29619547230`)
  converged (10,145 cells).
- Spain timing detail (context for #249): compute ~13 min (unlocked), publish ~89 min (locked) —
  75 min of it in the then-unlogged span. Adds stay 503-bounded during publish (#245).

## 3. Live state at handoff (~2026-07-17 23:45Z — RE-VERIFY, don't trust)

- **Loaded countries (21)**: `ad al at au ba be bg bn by bz ch cy cz de dk ee es hu lu mc us`.
- **Queue**: 41 countries dispatched ~23:05Z in this order (FIFO via the shared `queue: max`
  concurrency group):
  `fr ge ie it ke kr li lt lv md me mk mt mu my nl pl pt ro rs sg si sk tr ua uy za fo gg im je nc xk cl fi gb gr hr is no se`
  France (`fr`) was in progress (compute stage); 40 pending. Dispatch params were
  `scope_id=overture:<cc>`, `overture_release_id=2026-06-17.0`, `dry_run=false`.
- Database session state clean: zero stale (>5 min) or advisory-waiting sessions.
- The previous session's in-session queue monitor **died with that session** — re-establish
  monitoring (below).

Re-verify commands:

```bash
gh run list --workflow 306378652 --limit 50 \
  --json databaseId,status,conclusion,createdAt --jq 'group_by(.status)[] | "\(.[0].status): \(length)"'
kubectl config current-context   # must be do-sfo3-fountainrank-production-cluster
kubectl get jobs,pods -n fountainrank -l app=boundary-load -o wide
```

Committed-countries reconciliation (source of truth — a failed/cancelled run proves nothing):

```sql
SELECT DISTINCT lower(pb.country_code)
FROM place_boundary_cells c JOIN place_boundaries pb ON pb.id = c.place_id ORDER BY 1;
```

(run read-only via `kubectl exec` into the serving backend pod with `get_engine()`, as in the
incident handoff §3.)

## 4. The monitoring job

Poll `gh run list --workflow 306378652` periodically (runs take ~15 min to ~2 h each; the whole
queue is likely **2–4 days**). Per terminal outcome:

- **success** → nothing to do. Optionally spot-check committed cells for that country.
- **failure — expected fail-closed territories `fo gg im je nc xk`**: the pinned Overture
  release likely has no country feature for these; the run should fail fast in the fetch/validate
  step. After a **confirmed** such failure (read `gh run view <id> --log-failed` — confirm it is
  the no-feature case, not something new), retire that registry row from
  `.github/boundary-source-regions.yml` via a **reviewed one-line PR each** (normal gates: CI +
  Codex loop + squash-merge). Do not re-dispatch them.
- **failure — anything else**: read the logs. The fail-closed design means a failure can no
  longer poison the queue (session reaped by teardown; worst-case orphan bound ~15 min via
  `lock_timeout`), so the queue keeps draining — but diagnose before re-dispatching the failed
  country. Verify no orphan session survived:
  the teardown step's JSON report in the run log (`"ok": true/false`, per-phase status), and the
  `pg_stat_activity` check above. **Gotcha**: `pg_stat_activity` is snapshot-cached per
  transaction — run `SELECT pg_stat_clear_snapshot()` between polls on a reused connection.
- **teardown step failed but reap succeeded**: with #251 merged this should no longer happen
  spuriously (grace 5 s < ~35 s absence budget); if it still does, read the report — it is
  designed to fail loudly rather than lie.
- **Zero-fountain countries** (`bg bn by`, already loaded): correctly never appear in the public
  indexed-country API. Committed cells are the success criterion, not the API.

Queue-drained definition: no pending/in-progress runs AND the reconciliation query covers every
configured target except the retired territories.

## 5. Trailing items (in order)

1. **Deploy `67e88ee`** (the publish-stage logging) — **only when no boundary load is in
   flight** (loader runbook rule). The natural window is after the queue drains; deploy is
   manual: `gh workflow run deploy.yml --ref main`, then validate `/readyz` + homepage + image
   SHA. Until then the logging is merged-but-inert; the #250 fix is already active.
2. **Registry retirement PRs** for confirmed no-feature territories (§4).
3. **#249 remainder** (publish-window optimization): after the deploy, the new stage events
   attribute the ~75-min span. Profile in an **idle** window (queue drained) with rolled-back
   `EXPLAIN (ANALYZE, BUFFERS)` + statement timeout before proposing changes; likely suspects are
   `_ASSIGN_CANDIDATE_SQL` over large candidate sets and the cells replacement. Any change needs
   the full spec/plan/Codex flow and must respect the generation-atomicity constraints in
   `docs/specs/2026-07-17-scoped-add-fountain-lock-design.md` §2.
4. This handoff file is uncommitted in the worktree — commit it with the next PR (e.g. the first
   registry-retirement PR).

## 6. Guardrails (unchanged)

- Never print secrets/DSNs; DB inspection read-only via the backend pod's `get_engine()`.
- Verify kube context before any kubectl read; no `kubectl apply`/helm by hand; deploy via CI only.
- `pg_terminate_backend` remains last-resort-by-hand; the teardown/reaper now owns the routine
  case — prefer re-running the teardown (`PYTHONPATH=backend python3 -m app.imports.loader_teardown
  --job-name <job> --run-id <run> --namespace fountainrank`) over ad-hoc SQL.
- All source changes: branch → PR → CI green + Codex `VERDICT: APPROVED` + every comment
  addressed → squash-merge. No AI attribution, no time estimates.

## 7. Reference index

- Incident record: `handoffs/2026-07-17-boundary-fanout-failure-cascade-handoff.md`
- Fix spec/plan: `docs/specs/2026-07-17-candidate-capture-and-loader-cancellation-design.md`,
  `docs/plans/2026-07-17-candidate-capture-and-loader-cancellation.md`
- Staged-refresh design (constraints for any publish change):
  `docs/specs/2026-07-17-scoped-add-fountain-lock-design.md`
- Open: #249 (optimization half). Closed this session: #250, PRs #248, #251.
- Key runs: Spain `29613690452`; drill cancel `29619375079`; drill re-dispatch `29619547230`;
  deploy `29613349533`.
