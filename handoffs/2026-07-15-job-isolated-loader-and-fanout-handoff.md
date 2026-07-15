# Handoff — Job-isolated loader shipped + worldwide boundary fan-out running (2026-07-15)

Pick-up doc for a fresh conversation. The **root-cause fix is built, reviewed, merged, deployed, and
verified in production.** The only work left is **watching the boundary fan-out finish + reconciling
stragglers**, plus two tracked follow-ups. Everything needed to resume is below.

Supersedes `handoffs/2026-07-15-place-hierarchy-worldwide-rollout-handoff.md` (that one ended with the
fan-out "in progress" but blocked by the orphan bug this work fixed).

---

## 1. What this was

The user asked "how's the fan-out look — I'm seeing cancelled runs, is that bad?" That led to
diagnosing why the worldwide boundary fan-out stalled/OOM'd/made-no-progress, fixing the root cause,
and running the fan-out to completion.

## 2. Root cause (confirmed in prod)

All three operator loaders (`osm-boundary-load`, `osm-import-pbf`, `osm-import`) ran their CLI **inside
the shared serving pod** via `kubectl exec`. **`kubectl exec` does not propagate a run's cancellation
to the in-pod process**, so a cancelled run **orphaned a loader that kept holding the
`ADD_FOUNTAIN_LOCK` advisory lock** (and the serving pod's memory). Symptoms: ~60-min log-silent stalls
(blocked on the lock), `exit 137` OOM kills, zero net progress. The "cancelled" runs the user saw were
GitHub's default `queue: single` cancelling *pending* runs under the previous session's bulk dispatch.
Full detail: memory `fountainrank-boundary-load-orphan-lock-root-cause`.

## 3. The fix (SHIPPED — 3 PRs, all merged to main + deployed)

| PR | What |
|---|---|
| **#236** | Loaders run in their own `batch/v1` **Job** via `.github/actions/run-loader-job` (renderer `backend/app/imports/loader_job_render.py`, stdlib `json.dumps`). All three workflows converted; ONE shared concurrency group `db-membership-write-production` with **`queue: max`** (bulk dispatch queues FIFO — no more cancelled runs). Loader lock-logging in `backend/app/locks.py::acquire_add_fountain_lock`. |
| **#237** | Job sized **256Mi/1Gi** to fit the `s-2vcpu-4gb` node (a 768Mi request was Unschedulable — caught by the action's fail-fast pod wait). |
| **#238** | Boundary `active_deadline_seconds` **5400 → 18000 (5h)** for slow fractal-geometry countries (Chile). |

**Design/plan:** `docs/specs/2026-07-15-job-isolated-loader-design.md`,
`docs/plans/2026-07-15-job-isolated-loader.md`. Codex-reviewed to `VERDICT: APPROVED` on spec (4
rounds), plan (2), and each PR. Codex review artifacts in `temp/codex-reviews/` (gitignored).

## 4. Verified live in production

- Dry-run smoke (Monaco): Job created → streamed → ran → torn down, 49s.
- **Cancellation test:** cancelled a running non-dry Monaco load → Job deleted, pod gone,
  `ADD_FOUNTAIN_LOCK` held by no one. **The orphan fix works.**
- Real Belgium load: indexed 8→9, ~13 min (a real refresh, not a stall).
- `queue: max`: 4 rapid dispatches → 1 running + 3 pending, **0 cancellations**.
- Chile diagnosed: acquired the lock in **194ms** (no stall), but its 72,845 cells made city-parenting
  run >56 min and hit the (then 90-min) deadline. Not a regression — a genuinely slow membership step.

## 5. Current fan-out state (as of 2026-07-15 ~21:30 UTC)

- **Indexed (source of truth):** 15 — `ad al at au ba be bz ch cy cz de dk lu mc us`
  (`curl -s "https://api.fountainrank.com/api/v1/places?limit=300" | python -c "import json,sys;print(sorted(set(p['country_code'] for p in json.load(sys.stdin))))"`).
- **Loaded (have cells):** 18 = indexed 15 + `bg bn by` (loaded fine but **0 fountains**, so correctly
  not in the drill-down index — nothing to fix).
- **Queue:** 1 running + **44 pending** boundary loads, all on the **free `ubuntu-latest`** runners with
  the **18000s** deadline, fractal-slow countries (`cl fi gb gr hr is no se`) ordered **LAST** so they
  don't block the fast ones. (During this session the queue was cancelled + cleanly re-dispatched twice
  — once to apply the 5h deadline, once while investigating runner cost; the current 44 is the live set.
  Remaining order used: `ee es fr ge hu ie it ke kr li lt lv md me mk mt mu my nl pl pt ro rs sg si sk tr ua uy za fo gg im je nc xk cl fi gb gr hr is no se`.)
- **Full target set** (what should end up loaded): the 8 original + the 54-country fan-out list from the
  prior handoff. Remaining-to-load at re-dispatch = 47:
  `cl cy cz dk ee es fi fr gb ge gr hr hu ie is it ke kr li lt lv md me mk mt mu my nl no pl pt ro rs se sg si sk tr ua uy za fo gg im je nc xk`
  (some now done — recompute remaining = target minus loaded, see §6).

## 6. HOW TO RESUME (the remaining work)

### A. Let the fan-out finish, then reconcile
The 43+1 process serially at ~13 min each (fractal giants take up to hours; that's why they're last).
Because `queue: max` serializes, total time ≈ sum of all country times.

1. **Check progress:** indexed count (curl above) + queue depth:
   `gh run list --workflow "Boundary Load (Overture division_area)" --limit 90 --json status --jq 'group_by(.status)[]|"\(.[0].status): \(length)"'`
2. **When the queue drains, reconcile** — dispatch (with the current 18000 deadline on `main`) any
   target country still not loaded:
   - Loaded set: `SELECT DISTINCT lower(country_code) FROM place_boundary_cells c JOIN place_boundaries pb ON pb.id=c.place_id` (run in the backend pod).
   - `remaining = full_target − loaded`; dispatch each:
     `gh workflow run osm-boundary-load.yml --ref main -f scope_id=overture:<cc> -f overture_release_id=2026-06-17.0 -f dry_run=false`
3. **Expected failures:** the 6 uncertain codes `fo gg im je nc xk` may **fail-closed on 0 features**
   (Overture has no `country` division). If one fails on 0 features, **retire its row** in
   `.github/boundary-source-regions.yml` (`status: retired`) — a one-line PR (prior handoff §6).
4. **Countries with 0 fountains** load but never index — that's correct, leave them.

### B. Fan-out operational rules (still true, easier now)
- `queue: max` makes bulk dispatch safe (FIFO, no cancellations). **Cancelling a run is now safe** —
  the Job is torn down and the lock released (verified). No more orphans.
- A slow fractal country blocks the FIFO queue while it runs; keep them ordered last.
- Do **NOT** run `deploy.yml` while a load is in flight (it rolls the pod; the Job is separate but
  don't churn). Deploy is only needed if you change **backend** code (the Job runs the deployed image);
  workflow/action/renderer changes take effect on `main` with no deploy.
- **Runners — leave the loaders on `ubuntu-latest`; do NOT move them to `redducklabs-runners`.**
  `fountainrank` is a **public repo**, so GitHub-hosted standard runners are **free/unlimited** — the
  fan-out costs $0 in Actions minutes (verified this session). The loaders are Class B on `ubuntu-latest`
  *by design* (they wield the prod `DIGITALOCEAN_ACCESS_TOKEN` + cluster kubeconfig; Class A
  self-hosted runners are "no secrets" — see the `# Class B` comments). The self-hosted runners are
  **ARC pods inside the prod DOKS cluster**, so switching would (a) save $0, (b) consume the already
  memory-tight `s-2vcpu-4gb` node (the loader Job + a runner pod likely won't both fit — recall the
  768Mi Unschedulable), and (c) weaken the Class-B isolation by running a prod-credential workflow
  inside prod. Net: strictly worse. The runner idle-polls during hours-long fractal loads, but that's
  wasted wall-clock, not money — the real fix is the §7.1 city-parenting optimization.

## 7. Tracked follow-ups (NOT blocking the fan-out)

1. **City-parenting is slow for fractal-coastline countries** (memory
   `fountainrank-city-parenting-slow-fractal-geometry`). `_CITY_PARENT_COUNTRY_SQL` in
   `backend/app/membership.py` (`ST_PointOnSurface` + PIP over `place_boundary_cells`) took >56 min for
   Chile's 72k cells. Deadline raised to 5h as the stop-gap (owner decision: raise-now-optimize-later).
   The real fix would make the fractal giants fast (candidates: better cell GiST plan/stats, coarser
   PIP prefilter; relates to #228). This is the meaningful perf follow-up.
2. **Expo SDK patch drift breaks `mobile-doctor` repo-wide.** `expo 56.0.16` published 2026-07-15
   10:38 UTC; lockfile has `56.0.15`. Every PR's `mobile-doctor` is red until the lockfile is bumped,
   which the `minimumReleaseAge` (24h) gate blocks until **~2026-07-16 10:38 UTC**. Then bump via
   `expo install --fix` (coordinated set — delegate the JS toolchain run to **Codex/WSL**, see
   `claude_help/local-dev.md`) in its own PR. (#238 was merged with this red check by explicit owner
   approval — it's unrelated + non-required; don't treat it as precedent.)

## 8. Key files / mechanisms

- **Action:** `.github/actions/run-loader-job/action.yml` — discovers the deployed backend image,
  pre-flight-deletes stale Job, renders + creates, waits for exactly-one-pod → Running (fail-fast on
  ImagePullBackOff/Unschedulable), streams files via `kubectl exec` + `/work/.ready`, background
  log-tail + terminal poll (distinct OOMKilled/DeadlineExceeded), trap cleanup. Caller adds an
  `if: always()` `kubectl delete job` step (composite actions have no `post:`).
- **Renderer:** `backend/app/imports/loader_job_render.py` (+ `backend/tests/test_loader_job_render.py`).
- **Lock logging:** `backend/app/locks.py::acquire_add_fountain_lock` used at the 4 loader sites
  (`membership.py` refresh_country/all, `merge.py` merge/rollback).
- **Workflows:** `.github/workflows/osm-boundary-load.yml` (`active_deadline_seconds: 18000`),
  `osm-import-pbf.yml` (`21600`), `osm-import.yml` (`10800`) — all share
  `concurrency: { group: db-membership-write-production, cancel-in-progress: false, queue: max }`.
- **actionlint:** `queue: max` needs the narrow `-ignore` in `.pre-commit-config.yaml` (actionlint
  ≤v1.7.12, the latest, doesn't know the `queue` key; pre-commit-only, not a CI gate). Local runs:
  `wsl.exe -e ./temp/actionlint/actionlint -ignore 'unexpected key "queue" for "concurrency" section' <workflow>`.

## 9. Process reminders for this repo

- Branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** → squash-merge.
  Codex via the MCP server in bypass mode, cwd `/mnt/d/repos/fountainrank`
  (`claude_help/codex-review-process.md`).
- Backend verifies locally via isolated `UV_PROJECT_ENVIRONMENT` + `./run.ps1 up` (PostGIS on :5436,
  password `fountainrank_dev`); full suite is 910 tests. `test_ratings_api.py::test_validation_error_logs_sanitized_fields_only`
  is **flaky** (caplog contamination) — re-run the backend job if it fails alone. `mobile-doctor` /
  web render suites are CI-only on this Windows/WSL host (`claude_help/local-dev.md`).
- No AI attribution in commits/PRs; no time estimates.
- A read-only background fan-out monitor was launched this session (`scratchpad/fanout_monitor.sh`);
  the scratchpad is session-specific, so in a fresh conversation just poll manually (§6.A).
