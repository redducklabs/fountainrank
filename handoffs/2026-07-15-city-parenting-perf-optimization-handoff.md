# Handoff — City-parenting perf optimization (root cause CONFIRMED) + fan-out still draining (2026-07-15)

Pick-up doc for a fresh conversation. We diagnosed **why the worldwide boundary fan-out is slow**,
confirmed the root cause with production evidence, and are about to build the fix. **No code has been
written yet** — we are mid-**brainstorming** (spec → plan → implement flow not yet started). Everything
needed to resume is below.

Supersedes the "watch the fan-out finish" part of
`handoffs/2026-07-15-job-isolated-loader-and-fanout-handoff.md` (read that first for the shipped
Job-isolation fix background). The Job-isolation fix is **done, deployed, verified** — this handoff is
about the **next** problem: the fan-out works but is painfully slow, and we found out exactly why.

---

## 1. TL;DR — where we are

- The boundary fan-out **runs correctly** (the Job-isolation fix from the prior handoff works: no orphan
  locks, no OOM) but is **crawling** because the per-country membership refresh has a **slow
  city-parenting step**. At the serial `queue: max` rate, the full 44-country fan-out is a multi-day
  crawl, and the fractal giants risk hitting the 5h deadline and **rolling back (never loading)**.
- The owner chose (this session, via two AskUserQuestion prompts):
  1. **"Optimize city-parenting now"** — build the perf fix while the current fan-out keeps draining in
     the background; deploy so the remaining/giant countries load fast.
  2. **"Confirm bottleneck, then set the bar"** — evidence-driven: measure the dominant cost before
     committing to a fix and a success target.
- **We confirmed the bottleneck with production `EXPLAIN (ANALYZE, BUFFERS)` evidence (§4).** It is
  **NOT** the geodesic `ST_Area` (my first hypothesis — the A/B refuted it, only ~30% gain). It is a
  **missing btree index on `place_boundaries (country_code, place_kind)`**, which forces two near-full
  scans of the 95k-row `place_boundaries` table on **every** per-country refresh — and the cost **grows
  as the table grows**, so each later country in the fan-out is slower than the last.
- **Next step:** finish brainstorming → write spec → plan → implement (an Alembic migration adding the
  index, plus optional query cleanups) → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge →
  **deploy backend** (the loader Job runs the *deployed* image) → the remaining fan-out countries load
  fast → reconcile stragglers.

---

## 2. Current fan-out state (as of 2026-07-15 ~23:10 UTC)

- **Indexed (source of truth):** 15 — `ad al at au ba be bz ch cy cz de dk lu mc us`
  (`curl -s "https://api.fountainrank.com/api/v1/places?limit=300" | python -c "import json,sys;print(sorted(set(p['country_code'] for p in json.load(sys.stdin))))"`).
  **Unchanged since the prior handoff** — nothing new has finished because Estonia has been stuck on the
  slow step for hours.
- **Queue:** `completed: 45` (all *cancelled* from earlier re-dispatches — not real loads), **`in_progress: 1`**, **`pending: 44`**.
  Check: `gh run list --workflow "Boundary Load (Overture division_area)" --limit 90 --json status --jq 'group_by(.status)[]|"\(.[0].status): \(length)"'`
- **The running load = Estonia (`ee`)**, pod `boundary-load-6rt7f` in ns `fountainrank`, Job `boundary-load`.
  Run `29440790384`, job started 20:22:38Z, **on the city-parent step (silent) since 20:41 UTC — ~2h30m**,
  deadline (`active_deadline_seconds=18000`, 5h) ≈ **01:22 UTC** (~2h headroom left as of 23:10). It is
  **actively computing, not stuck** (verified in `pg_stat_activity`: `wait_event=DataFileRead`, I/O-bound).
  It may or may not finish before the deadline; if it doesn't, the transaction rolls back and the next
  country starts. **Either outcome is fine** — the point is to ship the fix so re-loads are fast.
- Remaining dispatch order (fractal giants LAST): `ee es fr ge hu ie it ke kr li lt lv md me mk mt mu my
  nl pl pt ro rs sg si sk tr ua uy za fo gg im je nc xk cl fi gb gr hr is no se`.
- **Do NOT cancel/disturb the fan-out unnecessarily.** Cancelling is now *safe* (Job torn down, lock
  released — verified prior session), but every country that rolls back has to be re-run.

---

## 3. The task & decisions locked in

**Goal:** make the per-country `refresh_country_memberships` city-parenting step fast enough that the
whole fan-out (including fractal giants ee/gb/no/se/fi/is/gr/hr/cl) completes quickly and no country
times out at the 5h deadline.

**Locked decisions (owner, this session):**
- Optimize now; keep the current fan-out draining in the background (don't pause it).
- Evidence-driven: bottleneck must be **confirmed** before choosing the fix / setting the bar. **(Done — §4.)**
- Follow the repo flow: **brainstorming → spec (`docs/specs/`) → writing-plans → implement on a branch →
  PR → CI green + Codex `VERDICT: APPROVED` + all PR comments addressed → squash-merge → deploy.**

**Brainstorming checklist status** (superpowers:brainstorming was invoked):
- [x] Explore project context
- [x] Clarifying questions (the two AskUserQuestion decisions above)
- [~] Propose 2-3 approaches with tradeoffs ← **resume here** (evidence now in hand makes this easy — §5)
- [ ] Present design sections, get approval each
- [ ] Write spec + self-review + user review
- [ ] Invoke writing-plans skill

---

## 4. ROOT CAUSE — confirmed with prod evidence

The slow statement is **`_CITY_PARENT_COUNTRY_SQL`** in `backend/app/membership.py` (~line 572), run at
`refresh_country_memberships` line ~1195 (between the `region_canonical_selected` and `city_parented`
log lines — which is exactly where Estonia is stuck). It parents each city to its covering canonical
region via a representative point.

**How we measured (all against prod, read-only, rolled back, capped with `statement_timeout`):**
- `pg_stat_activity`: Estonia's city-parent query is `wait_event=DataFileRead` → **I/O-bound**.
- **A/B** (current vs. a variant that precomputes region `ST_Area` once in a CTE), same country
  back-to-back under identical load so contention cancels out:
  - `al` (400 cities): CURRENT 55.7s vs OPT(precompute area) 39.6s → **only ~30%**.
  - `cz` (6,536 cities): CURRENT timeout >100s vs OPT 95.9s.
  - Conclusion: **`ST_Area` recompute is NOT the bottleneck** (my first hypothesis — refuted).
- **`EXPLAIN (ANALYZE, BUFFERS)` full plan tree** for `al` (buffer *page counts* are deterministic /
  contention-independent, even though wall-clock is inflated ~50-100x by the concurrent Estonia load):
  - **`city_pt` CTE = Seq Scan on `place_boundaries`** to find 400 cities: `Rows Removed by Filter:
    95023`, **Buffers read=56593 hit=25972 (~82k pages)**.
  - **country lookup lateral** = Index Scan on `uq_place_boundaries_overture_id` filtering
    `place_kind='country' AND country_code=…`: `Rows Removed by Filter: 61731`, **Buffers hit=40568
    read=24424 (~65k pages)** (Memoized → done once, but that one miss cost ~65k pages).
  - region lateral (the `ST_Covers` PIP + `ST_Area` sort): ~46k pages but **mostly cache hits**
    (read=327) → cheap I/O, not the problem.
  - **~148k pages go to the two full scans vs ~46k (cached) to the region probe.**

**Verified index inventory on `place_boundaries` (95,423 rows):**
```
pk_place_boundaries                   btree (id)
uq_place_boundaries_overture_id       btree (overture_id) UNIQUE
uq_place_boundaries_region_canonical  btree (country_code, slug)  WHERE is_canonical AND place_kind='region'
uq_place_boundaries_city_canonical    btree (country_code, parent_id, slug) WHERE is_canonical AND place_kind='city'
idx_place_boundaries_boundary         gist (boundary)
```
There is **no** plain btree on `(country_code, place_kind)` / `(place_kind, country_code)`. The two
`country_code`-leading indexes are **partial (`WHERE is_canonical AND place_kind=…`)**, so they cannot
serve the `city_pt` scan (wants ALL cities) or the country lookup (`place_kind='country'`).

**Why this compounds the fan-out:** `place_boundaries` grows with every loaded country, so the two
full-table/full-index scans get more expensive for each *subsequent* country — later fan-out countries
are slower than earlier ones for a reason unrelated to their own geometry.

---

## 5. The fix (recommended — evidence-based)

**Primary:** add a btree index on **`place_boundaries (country_code, place_kind)`**.
- Serves `city_pt` filter (`place_kind='city' AND country_code=:cc`), the country lateral
  (`place_kind='country' AND country_code=:cc`), and the region lateral — all equality-on-both, so
  column order is flexible; `(country_code, place_kind)` is the natural choice (matches other
  `country_code`-leading access). Turns two ~65-82k-page scans into small index probes and removes the
  grow-with-table floor.
- Implementation: **Alembic migration** (check `backend/alembic/versions/` for the latest head + the
  project's migration conventions; add the matching `Index(...)` to the `PlaceBoundary` model
  `__table_args__` in `backend/app/models.py` ~line 875 so the ORM and migration agree). Consider
  `CREATE INDEX CONCURRENTLY` to avoid locking writes on the live table — BUT concurrent index builds
  **cannot run inside a transaction**, and Alembic wraps migrations in one; check how this repo runs
  migrations (does `deploy.yml` run `alembic upgrade`? is there a migration Job?) before deciding
  concurrent vs plain. On a 95k-row table a plain `CREATE INDEX` is fast (sub-second to seconds) and the
  write lock is brief; plain is likely fine given loads are serialized and infrequent.

**Optional secondary (only if profiling after the index shows residual cost worth it — set the bar by
measurement, per the owner's directive):**
- Precompute region `ST_Area` once per refresh (the A/B's ~30% — small, and its benefit may shrink once
  the index removes the dominant scans; re-measure before bothering).
- The query triggers **JIT** (plan cost >100k) every run; the al plan showed absurd JIT emission time
  (contention-inflated, but JIT for a repeatedly-run query is overhead). Fixing the index drops the plan
  cost, which may stop JIT from triggering — a free side benefit; verify, don't assume.
- `ST_PointOnSurface(city.boundary)` per city is computed once (materialized) — fine; only revisit if
  post-index profiling fingers it for fractal-city geometry.

**Success bar (proposed, to confirm with owner):** with the index, the two table-scans vanish, so
*every* country's fixed overhead collapses; the residual is the genuine per-city PIP work (~tens of ms ×
city count), which for fractal giants is **minutes, not hours**. Bar = "no country hits the 5h deadline;
typical country city-parents in single-digit minutes," validated by a clean measurement (§6).

**⚠️ Correctness is paramount** — this is central membership SQL (spec §5/§11.5). An index is
behavior-preserving (planner-only), so risk is low, but any query rewrite must produce identical
`parent_id` assignments. The backend suite is 910 tests; there are membership tests
(`backend/tests/test_membership*.py`) — run them. Codex review is a hard gate.

---

## 6. How to get CLEAN profiling (the contention problem)

All the numbers in §4 are **contention-distorted** because the Estonia load saturates DB I/O — 400
cities "taking 55s" is pure I/O starvation. **Buffer page counts are still clean** (that's how we found
the root cause), but you cannot get trustworthy *wall-clock before/after* while a load runs. Options to
validate the fix's real speedup:
1. **Deploy the index and let a real fractal country load in prod prove it** (ground truth per repo
   ethos — CI/prod is the source of truth). Cleanest end-to-end; the index is low-risk enough to ship
   on the buffer-count evidence.
2. **Brief uncontended prod window:** cancelling the running load is *safe* (Job torn down, lock
   released — verified). Cancel → `EXPLAIN (ANALYZE, BUFFERS)` current vs. with-index on `us`/`de` (real
   fractal, many cities) → confirm the operator-level win → re-dispatch. Costs one country restart.
3. **Local isolated benchmark:** heavy (the loader reads an Overture `division_area` GeoJSON extract; a
   full local load itself hits the slow step). Not worth it vs. options 1/2.

Recommended: build the index migration, get it reviewed/merged, **deploy**, then use option 1 (watch a
real fractal country) and/or a quick option-2 spot check to record the real speedup and set the final bar.

**Repro commands used this session** (adapt the country code; run from a shell with kube context
`do-sfo3-fountainrank-production-cluster`, backend pod `fountainrank-backend-9c6ddbbc-8xjlt` — re-resolve
the pod name, it rolls):
- Pipe a script to the pod (kubectl cp is broken on this Windows host — colon-path quirk):
  `kubectl exec -i -n fountainrank <backend-pod> -- python - <<'PYEOF' … PYEOF`
- Inside: `from app.db import get_engine` (NOT `engine` — it's `get_engine()`); wrap EXPLAINs in
  `SET statement_timeout=…`, run against a *committed* country, and `await c.rollback()` (the UPDATE is
  idempotent — `WHERE parent_id IS DISTINCT FROM …` — but roll back anyway).
- The exact CURRENT / OPT / full-tree scripts are reproducible from §4; the city-parent SQL is
  `_CITY_PARENT_COUNTRY_SQL` in `backend/app/membership.py`.

---

## 7. After the fix lands — finish the fan-out (from the prior handoff §6)

1. **Deploy backend:** `gh workflow run deploy.yml --ref main` (merging does NOT deploy). The loader Job
   runs the image discovered at Job-creation, so new dispatches after the deploy get the fast path;
   workflow/renderer changes need no deploy but **a backend/SQL change does**.
2. **Let the queue drain** (or cancel + re-dispatch the remaining set to pick up the fast image sooner).
   Poll indexed count + queue depth (§2 commands).
3. **Reconcile:** dispatch any target country still not loaded. Loaded set:
   `SELECT DISTINCT lower(country_code) FROM place_boundary_cells c JOIN place_boundaries pb ON pb.id=c.place_id`
   (backend pod). Dispatch each missing:
   `gh workflow run osm-boundary-load.yml --ref main -f scope_id=overture:<cc> -f overture_release_id=2026-06-17.0 -f dry_run=false`
4. **Expected failures:** `fo gg im je nc xk` may fail-closed on 0 features (no Overture `country`
   division) → retire the row in `.github/boundary-source-regions.yml` (`status: retired`), one-line PR.
5. **0-fountain countries** load but never index (`bg bn by`) — correct, leave them.

---

## 8. Key files / mechanisms

- **Slow SQL:** `backend/app/membership.py` — `_CITY_PARENT_COUNTRY_SQL` (~572), called in
  `refresh_country_memberships` (~1162; city-parent at ~1195). Full-DB twin `_CITY_PARENT_SQL` (~529)
  + `refresh_all_memberships` (~1263) have the **same** pattern — the index helps both; a query rewrite
  (if any) must be applied to both.
- **Model:** `backend/app/models.py` — `PlaceBoundary` (~864, `__table_args__` ~875), `PlaceBoundaryCell`
  (~949). `boundary` is `Geography(MULTIPOLYGON, 4326)` with GiST; cells are `ST_Subdivide(boundary,128)`
  pieces (fast PIP). No stored area / representative-point column.
- **Membership pipeline** (per country): rebuild cells → derive `place_kind` → region-parent →
  fountain-assign → region-canonical → **city-parent (slow)** → city-canonical → counts. Estonia's
  timeline showed everything else ≤~5min each; city-parent alone is hours.
- **Migrations:** `backend/alembic/` (find the head; follow existing migration style). Confirm how prod
  runs `alembic upgrade` (deploy Job vs. app startup) before choosing plain vs `CONCURRENTLY`.
- **Loader Job:** `.github/actions/run-loader-job/action.yml`; workflow `.github/workflows/osm-boundary-load.yml`
  (`active_deadline_seconds: 18000`, shared concurrency `db-membership-write-production`, `queue: max`).
  Deploy: `.github/workflows/deploy.yml` (`v*.*.*` tag or `workflow_dispatch`).

---

## 9. Process reminders for this repo

- **kube context:** `kubectl config use-context do-sfo3-fountainrank-production-cluster` (verify first;
  it was already current). Backend pod name rolls — re-resolve:
  `kubectl get pods -n fountainrank | grep fountainrank-backend`.
- Branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** → **squash-merge**.
  Codex via the MCP server in **bypass mode** (`sandbox: danger-full-access`, `approval-policy: never`),
  cwd `/mnt/d/repos/fountainrank` (see `claude_help/codex-review-process.md`). Point Codex at
  `CLAUDE.md`, `claude_help/`, `docs/design/`.
- Backend verifies locally via **isolated `UV_PROJECT_ENVIRONMENT`** + `./run.ps1 up` (PostGIS on :5436,
  password `fountainrank_dev`); full suite 910 tests;
  `test_ratings_api.py::test_validation_error_logs_sanitized_fields_only` is flaky (caplog) — re-run if
  it fails alone. Never delete Codex's WSL `.venv`/`node_modules`. `mobile-doctor` / web-render suites
  are CI-only on this Windows/WSL host (`claude_help/local-dev.md`).
- **No AI attribution** in commits/PRs; **no time estimates** anywhere.
- Loaders stay on **`ubuntu-latest`** (public repo = free; Class B by design — do NOT move to
  `redducklabs-runners`; see prior handoff §6.B / memory `fountainrank-runner-class-a-b-public-free`).
- **Never** run state-mutating Terraform / `kubectl apply` / `helm` by hand. The read-only prod queries
  above (EXPLAIN, pg_stat_activity, rolled-back idempotent UPDATE) are fine.

---

## 10. Prior tracked follow-ups (still open, from the previous handoff §7)

1. **City-parenting slowness** — THIS work now addresses it (the previous handoff filed it as
   "the meaningful perf follow-up"; we've now root-caused it to the missing index, a much simpler fix
   than the "rewrite the PIP" it anticipated). Memory: `fountainrank-city-parenting-slow-fractal-geometry`
   (update it once the fix ships).
2. **Expo SDK patch drift breaks `mobile-doctor` repo-wide** — `expo 56.0.16` vs lockfile `56.0.15`;
   `minimumReleaseAge` (24h) gate blocks the bump until **~2026-07-16 10:38 UTC**, then
   `expo install --fix` (coordinated set — delegate the JS toolchain run to Codex/WSL) in its own PR.
   Unrelated to this work.

---

## 11. Open task list (TaskCreate IDs this session)

- #34 ✅ Gather city-parenting perf data — done (§4).
- #35 ✅ Brainstorm clarifying questions — done (two AskUserQuestion decisions).
- #36 ⏳ Propose 2-3 approaches with tradeoffs — **resume here** (evidence in §4/§5 makes this
  straightforward: primary = the index; secondaries = measure-then-maybe).
- #37 Present design sections, get approval.
- #38 Write spec + self-review + user review, then writing-plans.
- #39 Monitor background fan-out; reconcile stragglers at end (§7).
