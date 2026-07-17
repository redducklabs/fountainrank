# Handoff — boundary fan-out failure cascade after city-parenting fix (2026-07-17)

This handoff supersedes the operational/fan-out portion of
`handoffs/2026-07-15-city-parenting-perf-optimization-handoff.md`. The city-parenting index work is
shipped and proven, but the worldwide fan-out is currently broken by a **different slow query** plus
PostgreSQL sessions that survive Kubernetes Job deadlines. Read this file before taking any recovery
action.

## 1. Executive summary

- The city-parenting optimization is complete:
  - PR #239 added `ix_place_boundaries_country_kind` on
    `place_boundaries (country_code, place_kind)`.
  - It was independently reviewed (`VERDICT: APPROVED`), fully green, squash-merged, deployed, and
    verified in production.
  - Production `EXPLAIN (ANALYZE, BUFFERS)` on Albania used the new index for both city and country
    probes and finished in **3.10 s** with the previous two near-full scans gone.
  - Estonia's first real post-deploy load succeeded in **13m34s**. Its city-parenting stage ran from
    `03:12:19Z` to `03:13:45Z` (about **86 s**) instead of exceeding five hours.
- The fan-out then exposed the next bottleneck:
  `_CAPTURE_COUNTRY_CANDIDATES_SQL` in `backend/app/membership.py`, logged/visible as
  `INSERT INTO membership_candidate_fountains ...`.
- Spain reached `region_parented` quickly, then spent the rest of its five-hour Job deadline in that
  candidate-fountain statement and timed out.
- Deleting the loader pod/Job did **not** cancel the server-side PostgreSQL query. Spain's transaction
  remains active, holds `ADD_FOUNTAIN_LOCK`, and has accumulated a chain of orphan sessions from every
  subsequent timed-out country waiting for the same advisory lock.
- The queue is therefore not making useful progress. Every current old-image run waits five hours,
  fails, leaves another PostgreSQL waiter, and advances to the next queued country.
- **Do not let the existing queue continue unattended.** The next session should pause/cancel the
  old-image queue, terminate the rediscovered orphan sessions, then design and ship the candidate-query
  + cancellation fix before re-dispatching missing countries.

## 2. Exact live state at handoff

Observed on 2026-07-17 with kube context
`do-sfo3-fountainrank-production-cluster`:

- Workflow: `Boundary Load (Overture division_area)`, workflow ID `306378652`.
- Runs in the latest 100:
  - `completed: 64` (includes earlier canceled history)
  - `in_progress: 1`
  - `pending: 35`
  - completed conclusions: `cancelled: 56`, `failure: 7`, `success: 1`
- The sole success in this re-dispatch batch is Estonia (`ee`), run `29468117462`.
- Seven consecutive five-hour failures:

  | Country | Run ID |
  | --- | ---: |
  | Spain (`es`) | `29468119138` |
  | France (`fr`) | `29468120988` |
  | Georgia (`ge`) | `29468122908` |
  | Hungary (`hu`) | `29468128548` |
  | Ireland (`ie`) | `29468130509` |
  | Italy (`it`) | `29468132313` |
  | Kenya (`ke`) | `29468134154` |

- Current run: South Korea (`kr`), run `29468135928`, Job pod `boundary-load-5kl2k` at observation.
  The pod name is ephemeral; always re-resolve it.
- The live Job is using the **old deployed backend image**:
  `registry.digitalocean.com/fountainrank/fountainrank-backend:22df44c6c728`.
- South Korea's only application log was `advisory_lock_wait`; it was not computing membership.
- There were 35 pending old-image runs behind it.

Recheck rather than trusting these counts:

```bash
gh run list --workflow 306378652 --limit 100 \
  --json databaseId,status,conclusion,createdAt,updatedAt \
  --jq 'group_by(.status)[] | "\(.[0].status): \(length)"'

kubectl config current-context
kubectl get jobs,pods -n fountainrank -l app=boundary-load -o wide
```

## 3. Production database evidence — root blocker and lock cascade

At the last read-only inspection, `pg_stat_activity` showed:

- PID `3831787`: the original Spain transaction, active for about 37 hours, executing
  `INSERT INTO membership_candidate_fountains ...`, no blocker, actively computing.
- Seven later PIDs (`3908067`, `3957101`, `4012345`, `4067183`, `4120561`, `4177621`, `38016`)
  waiting on the advisory lock, each blocked by the sessions ahead of it.
- The PIDs are evidence only. **Never terminate hard-coded PIDs from this document. Rediscover and
  verify the query/lock chain immediately before acting.**

Read-only rediscovery command (resolve the current backend pod first):

```bash
POD=$(kubectl get pods -n fountainrank -l app=fountainrank-backend \
  -o jsonpath='{.items[0].metadata.name}')

kubectl exec -i -n fountainrank "$POD" -- python - <<'PYEOF'
import asyncio
from sqlalchemy import text
from app.db import get_engine

async def main():
    async with get_engine().connect() as c:
        result = await c.execute(text("""
            SELECT pid, state, now() - xact_start AS xact_age,
                   wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by,
                   left(query, 180) AS query
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND xact_start < now() - interval '10 minutes'
            ORDER BY xact_start NULLS LAST
        """))
        for row in result:
            print(dict(row._mapping))

asyncio.run(main())
PYEOF
```

Why the cascade happens:

1. Loader Jobs have `activeDeadlineSeconds=18000` (five hours).
2. Kubernetes deletes the pod at the deadline and the workflow performs guaranteed Job teardown.
3. The managed PostgreSQL server does not promptly notice/stop the killed client's in-flight query.
4. The server-side transaction continues and retains the transaction-scoped advisory lock.
5. The next serialized workflow starts, waits on that lock for five hours, is killed, and can itself
   leave another server-side waiter.

This invalidates the earlier operational assumption that Job teardown alone always releases database
locks. Kubernetes cleanup is working; PostgreSQL query cancellation is not.

## 4. The newly exposed slow SQL

File: `backend/app/membership.py`, `_CAPTURE_COUNTRY_CANDIDATES_SQL` (around lines 550-575 on current
`main`):

```sql
INSERT INTO membership_candidate_fountains (id)
SELECT DISTINCT f.id
FROM fountains f
WHERE EXISTS (
    SELECT 1
    FROM place_boundary_cells cell
    JOIN place_boundaries pb ON pb.id = cell.place_id
    WHERE pb.country_code = :cc
      AND ST_Covers(cell.geom, f.location::geometry)
)
OR EXISTS (
    SELECT 1
    FROM place_boundaries pb
    WHERE pb.country_code = :cc
      AND pb.id IN (f.country_place_id, f.region_place_id, f.city_place_id)
)
ON CONFLICT DO NOTHING
```

The query scans/correlates against the entire fountain population and country cell set. Spain reached
`region_parented` at `2026-07-16T03:31:34Z`, then produced no later membership-stage log before the
five-hour deadline at `08:20:07Z`. `pg_stat_activity` identifies this exact INSERT as the still-running
statement.

Do not assume the final rewrite without profiling. A likely shape to evaluate is a set-based union of:

- spatially matched fountain IDs from the target country's cells, and
- fountain IDs already assigned to one of the target country's places,

rather than scanning every fountain with two correlated `OR EXISTS` predicates. Correctness must
preserve the generation/affected-place semantics and membership parity tests.

Use a clean, idle production window for read-only/rolled-back `EXPLAIN (ANALYZE, BUFFERS)` with a
statement timeout, or reproduce against representative local data. Do not profile while orphan
sessions are saturating the database.

## 5. Important repository/deployment gap

Current repository state at handoff:

- Local branch: `main`, clean, aligned with `origin/main`.
- Current `main`: `17b6b8a`.
- Production loader image: `22df44c6c728` — older than current `main`.
- PR #245 (`8e7efd1`, merged and green) is **not deployed**:
  <https://github.com/redducklabs/fountainrank/pull/245>

PR #245 added two relevant behaviors:

1. Interactive fountain/admin writes now get a bounded transaction-wide lock wait and return a typed
   503 + `Retry-After`, so user requests do not wait indefinitely behind membership publication.
2. Standalone membership refresh now computes expensive boundary derivation in staging before taking
   `ADD_FOUNTAIN_LOCK`, then publishes atomically in a second transaction on the same pinned
   connection.

Design and plan:

- `docs/specs/2026-07-17-scoped-add-fountain-lock-design.md`
- `docs/plans/2026-07-17-scoped-add-fountain-lock.md`

PR #245 passed CI and independent review after its three major test findings were fixed. It improves
interactive availability and keeps city-parent computation outside the lock, but **it does not by
itself optimize `_CAPTURE_COUNTRY_CANDIDATES_SQL` or guarantee server-side cancellation when the Job
dies**. Deploying it without clearing/pausing this fan-out will not make the current old-image queue
healthy.

## 6. Recommended recovery sequence

These are operationally mutating actions. Re-verify current state and obtain/confirm task authority in
the new conversation before executing them.

1. Read `CLAUDE.md`, `claude_help/github-cli.md`, `claude_help/kubernetes-infra.md`, and the relevant
   design/process docs.
2. Verify `gh auth status` and kube context.
3. Stop the failure factory:
   - cancel the current in-progress boundary workflow;
   - cancel the 35 pending old-image runs;
   - wait for guaranteed Kubernetes Job teardown.
4. Rediscover the PostgreSQL chain using `pg_stat_activity`/`pg_blocking_pids`.
5. Terminate only the positively identified orphan loader sessions, root blocker first, and confirm no
   membership/advisory waiters remain. Do not use the stale PIDs in this handoff.
6. Reconcile the database loaded set. A run marked failed/canceled is not proof of rollback completion;
   use committed cells as the source of truth:

   ```sql
   SELECT DISTINCT lower(pb.country_code)
   FROM place_boundary_cells c
   JOIN place_boundaries pb ON pb.id = c.place_id
   ORDER BY 1;
   ```

7. Start a new spec/plan for both remaining defects:
   - optimize `_CAPTURE_COUNTRY_CANDIDATES_SQL` with production-plan evidence and parity coverage;
   - make loader deadlines/cancellation fail closed at the database session, so a killed Job cannot
     leave an unbounded server query or advisory-lock waiter. Reconcile this with the documented reason
     `statement_timeout` was rejected in `docs/specs/2026-07-15-job-isolated-loader-design.md` §D.
8. Follow branch → PR → all CI green → independent Codex `VERDICT: APPROVED` → all comments addressed
   → squash-merge.
9. Deploy via manual CI only, with no boundary load in flight:

   ```bash
   gh workflow run deploy.yml --ref main
   ```

10. Validate `/readyz`, homepage, live image SHA, DB/session behavior, and a representative real load.
11. Re-query committed loaded countries and re-dispatch only the missing configured targets. Observe at
    least one previously failing large country through completion before leaving the remaining queue
    unattended.

## 7. Already completed work and evidence

### Expo/CI unblock

- PR #240 refreshed the coordinated Expo SDK 56 patch set and added the owner-authorized exact-version
  `minimumReleaseAgeExclude` list.
- All CI green, independent Codex review approved, squash-merged.

### City-parenting index

- PR #239, squash merge `22df44c`.
- Files:
  - `backend/app/models.py`
  - `backend/migrations/versions/0027_boundary_country_kind_idx.py`
  - `backend/tests/test_place_boundaries_migration.py`
  - `docs/specs/2026-07-15-city-parenting-index-design.md`
  - `docs/plans/2026-07-15-city-parenting-index.md`
- Local migration upgrade/downgrade/re-upgrade and `alembic check` passed.
- Backend suite passed before merge; PR CI fully green; independent review approved with no findings.
- Deploy workflow run `29467732828` succeeded after orphan loader sessions blocking the migration were
  positively identified and terminated.
- Production health after deploy: API `/readyz` 200 and homepage 200.
- Exact production index definition verified:

  ```text
  CREATE INDEX ix_place_boundaries_country_kind
  ON public.place_boundaries USING btree (country_code, place_kind)
  ```

- Post-index rolled-back Albania plan:
  - execution: `3098.92 ms`
  - city lookup: `Index Scan ... ix_place_boundaries_country_kind`, 400 rows
  - country lookup: same composite index, one row
  - previous 65k-82k-page scan floor gone
- Estonia real load:
  - Job run `29468117462`, success in 13m34s
  - `place_boundary_cells_rebuilt`: 42,031 cells
  - `city_parented`: 89,253 parented, 662 null parent
  - city-parent stage about 86 seconds
  - committed-cell existence check returned true

## 8. Fan-out target order and expected special cases

Original re-dispatch order:

```text
ee es fr ge hu ie it ke kr li lt lv md me mk mt mu my nl pl pt ro rs sg si sk tr ua uy za
fo gg im je nc xk cl fi gb gr hr is no se
```

At handoff, `ee` is the only successful country from this sequence; `es fr ge hu ie it ke` failed;
`kr` is the current doomed waiter; the rest were pending.

Expected registry special cases from the earlier handoff:

- `fo gg im je nc xk` may fail closed because the pinned Overture release has no country feature. If
  confirmed, retire each registry row through a reviewed one-line PR rather than repeatedly dispatching.
- `bg bn by` can load correctly but never appear in the public indexed-country API because they have
  zero fountains. Do not treat that as a load failure; use committed cells for reconciliation.

## 9. Operational guardrails

- Never print secrets or database URLs. Use the deployed backend's `get_engine()` inside a pod for
  controlled read-only inspection.
- Verify kube context before every Kubernetes read. Do not run `kubectl apply` or Helm manually.
- Do not mutate production data during profiling. Use read-only queries or explicit rollback.
- `pg_terminate_backend` is an operational last resort: rediscover exact sessions, verify query and
  blocker identity, target only orphan loader sessions, and record what was terminated.
- Do not increase the five-hour deadline as the primary fix. That would make the orphan cascade slower
  to surface while preserving the unbounded database work.
- Do not re-dispatch the whole list until the candidate-fountain query and database cancellation path
  are proven on a previously failing country.
- All source changes require spec → plan → implementation, full CI, independent Codex review, all
  comments addressed, squash merge, and manual CI deployment.

## 10. Useful commands

Recent failures and active queue:

```bash
gh run list --workflow 306378652 --limit 100 \
  --json databaseId,status,conclusion,createdAt,updatedAt
gh run view <run-id> --log-failed
```

Resolve active scope/image/logs:

```bash
kubectl config current-context
kubectl get job boundary-load -n fountainrank \
  -o jsonpath='{.spec.template.spec.containers[0].command}{"\n"}'
kubectl get jobs,pods -n fountainrank -l app=boundary-load -o wide
POD=$(kubectl get pods -n fountainrank -l app=boundary-load \
  -o jsonpath='{.items[0].metadata.name}')
kubectl logs -n fountainrank "$POD" --tail=240
```

Repository state:

```bash
git fetch origin main
git status --short --branch
git log --oneline -12
gh pr view 245 --comments
```

## 11. Definition of done for the continuation

The continuation is complete only when:

1. the current failure queue is stopped and all orphan membership sessions are gone;
2. the candidate-fountain query has an evidence-backed bounded plan on representative large countries;
3. loader timeout/cancellation cannot leave a live PostgreSQL statement or advisory waiter;
4. the fix is spec/plan reviewed, implemented, fully green, independently approved, squash-merged, and
   deployed;
5. Spain or another previously failing country completes end to end on the new image;
6. committed loaded countries are reconciled, missing targets are re-dispatched, and the queue is
   demonstrably draining rather than accumulating five-hour failures;
7. expected zero-feature registry entries are retired through reviewed PRs if confirmed.
