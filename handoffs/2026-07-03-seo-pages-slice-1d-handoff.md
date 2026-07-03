# Crawlable SEO pages (#127) — Slice 1d merged — handoff (2026-07-03)

**Source:** the session that executed **Slice 1d** of the Codex-approved plan
`docs/plans/2026-07-02-crawlable-seo-pages.md` — **mandatory precomputed membership** (fountain →
canonical city + country place). Next task is **Slice 1e — coverage report/gate**. Supersedes
`2026-07-02-seo-pages-slice-1c-handoff.md` for the #127 items; the carried-forward owner checklist
(reproduced below) still holds.

---

## ✅ Shipped this session (on `main`)

| Change | Commit / PR | What |
|---|---|---|
| **#127 Slice 1d** — precomputed membership | **PR #161** → squash `bb7885f` | fountain→place assignment + counts + canonical + parent. CI green (all backend/JS/security), **Codex APPROVED** (round 2). Merged over the known-red `mobile-doctor` (owner-authorized). |

**Slice 1d — what landed (backend-only; spec §5/§11.5):**
- **Schema (migration `0015_fountain_membership`, reversible, `alembic check` clean):**
  - `fountains.country_place_id` / `city_place_id` — nullable FK → `place_boundaries` (ON DELETE
    SET NULL), each btree-indexed (the public city read path is `WHERE city_place_id = <canonical>`).
    **Decision: columns on `fountains`, not a `fountain_places` table** (owner-picked; the 1:1 read
    path favors columns).
  - `place_boundaries.fountain_count` — denormalized **non-hidden** count (the public "N fountains"
    number + the ≥ K indexability gate).
  - **`place_scope_config`** (new table, `country_code` PK, `eligible_city_subtypes TEXT[]`) — the
    per-country eligible city subtypes for the ladder. Seeded `us={locality,localadmin}`,
    `lu={locality,localadmin,county}`; **code default `{locality,localadmin}`** for any unseeded
    country. **Decision: a DB table (not a code constant)** so the Slice-1e owner-signoff gate can
    edit a country's eligible set without a deploy.
- **`app/membership.py`** (the `recompute_*` sibling of `ranking.py`/`consensus.py`):
  - `recompute_fountain_membership(session, fountain_id)` — single fountain: `ST_Covers` ladder
    (country = `subtype='country'` cover; city = highest-priority eligible subtype
    `locality`>`localadmin`>`county`, smallest-area tie; unmatched → country-only), then a targeted
    `fountain_count` recompute **and** scoped `is_canonical` re-selection for the touched
    `(country_code, slug)` group(s).
  - `recompute_place_counts(session, place_ids)` — count-only + scoped canonical (the admin **delete**
    path, where the fountain row is already gone).
  - `refresh_all_memberships(session)` — whole-DB set-based: assign all → recount all →
    `is_canonical` per `(country_code, slug)` → `parent_id` by containment. **Takes the
    `ADD_FOUNTAIN_LOCK` advisory lock** so a refresh can't overwrite a stale count vs a concurrent
    add/import.
- **Refresh triggers wired:** user add (`fountains.add_fountain`), OSM import
  (`merge.merge_candidates` + `rollback_run`), boundary load (`boundary_cli` refreshes after a
  non-dry load; `--skip-membership-refresh` opt-out), **and admin** (`admin_patch_fountain`
  move/hide/unhide, `admin_delete_fountain`) — all advisory-locked.
- **Backfill CLI** `app/imports/membership_cli.py` — refresh-only, `kubectl exec` entry (the one-time
  catch-up for the LU+US boundaries loaded by Slice 1c **before** membership existed).
- **Tests** `tests/test_membership.py` (19): overlapping tiers, slug collisions across subtypes,
  LU county opt-in + partial-locality → country-only, unmatched/no-country, default eligible set,
  counts + hidden exclusion, `is_canonical` (subtype then count) + **re-selection on count change**,
  `parent_id`, idempotency, and every trigger (user add, OSM import, rollback, backfill CLI, admin
  hide/unhide/move/delete).

**Codex loop:** review-1 raised **3 `[MAJOR]`** (admin mutations left counts stale; `is_canonical`
drift after count changes; full refresh not serialized with adds) — all fixed in the 2nd commit;
review-2 = **APPROVED**. Artifacts in `temp/codex-reviews/pr-161-review-{1,2}.md` (gitignored).

## ⚠️ OWNER ACTION — deploy, then backfill prod membership (do this before Slice 2 relies on it)
The LU+US boundaries are already in prod `place_boundaries`, but the **existing prod fountains have
no membership yet** (Slice 1c loaded boundaries before Slice 1d existed). After **deploying** the new
backend (`gh workflow run deploy.yml --ref main` — migration `0015` runs on deploy), run the one-time
backfill. Two equivalent CI-only paths:
- **Simplest:** re-dispatch the boundary load for LU (idempotent upsert + it now refreshes membership
  **globally**): `gh workflow run osm-boundary-load.yml -f scope_id=overture:lu -f overture_release_id=2026-06-17.0 -f dry_run=false` (LU = 114 features, cheap).
- **Or** the dedicated backfill: `kubectl exec` the backend pod → `python -m app.imports.membership_cli`
  (no S3 fetch; refresh-only). *(No dedicated backfill workflow was added — a re-dispatch covers it;
  add one in Slice 1e if the owner wants a first-class button.)*
Confirm via the pod's `membership_refresh_complete` log (fountains_total / matched_city /
country_only / unmatched / canonical_places).

## ▶️ NEXT: #127 Slice 1e — coverage report/gate (start here)
Per plan → Slice 1 (1a–1d done; do **1e**, then Slice 2 country pages). Per scope emit boundary
count, matched/unmatched fountains, top unmatched clusters, invalid-ring skips, and **city-assignment
% by subtype**. A scope's city routes are "ready" only above a threshold or with explicit owner
signoff — **which also sets that scope's eligible-city subtype set** (i.e. 1e is the UI/gate that
writes `place_scope_config` rows that 1d already reads). Then **Slice 2** (country pages: API +
`/drinking-fountains/[country]` + sitemap + noindex + tests).

## 🧭 Slice-1d design notes the next session should not re-derive
- **`is_canonical` is only ever set on city-eligible places**, never on `subtype='country'` — so the
  partial unique index `uq_place_boundaries_country_slug_canonical (country_code, slug) WHERE
  is_canonical` is purely the city namespace. A country + a commune sharing a slug (e.g. `lu` +
  `luxembourg`) do **not** collide: the country page is found by `subtype='country' AND country_code`,
  not by the canonical index. **Slice 2 must resolve country pages by `(subtype='country',
  country_code)`, not by `is_canonical`.**
- A fountain's `city_place_id` points at the **specific** covering polygon (which may be
  non-canonical on a slug collision). Slice 3's city page for `(country, slug)` should read the
  **canonical** place's `fountain_count`/list; fountains in a non-canonical same-slug city are
  excluded from that public namespace by design (spec §4.3, accepted).
- **Known limitation (documented, intentionally out of 1d scope):** moderation of *notes*
  (`admin_patch_note`) does not touch fountains, so it needs no membership refresh. All *fountain*
  mutations (add, import, admin move/hide/unhide/delete, rollback, boundary load, backfill) **do**
  refresh. There is no remaining fountain path that leaves counts stale.

## 🛠️ Environment + tooling that WORKS here (unchanged — don't rediscover)
- **Backend local checks on Windows:** the repo `backend/.venv` is Codex's WSL venv and breaks
  `uv run` on Windows ([[fountainrank-windows-wsl-local-check-workarounds]]). Use an **isolated
  `UV_PROJECT_ENVIRONMENT`** (a Windows path outside the repo, e.g. under the session scratchpad):
  `export UV_PROJECT_ENVIRONMENT=<path>`, `uv sync` once, then from `backend/`:
  `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`
  (this session: **563 passed**, no drift). `run.ps1` itself uses the default `.venv`, so it fails here.
- **JS tooling can't run on this Windows host** — mobile lint/test/typecheck are covered by CI
  (`workspace-js` + `mobile-doctor`).
- **DB:** `./run.ps1 up` runs `postgis/postgis:17-3.5` on **:5436**; it was up this session.
- **`mobile-doctor` is a known-red Expo patch-drift** (unrelated): expo-doctor flags a patch mismatch
  (`expo ~56.0.14` required vs `56.0.13` installed) because the `minimumReleaseAge` supply-chain gate
  blocks the too-new patch. It **self-resolves as the patch ages** (~a day); merging a backend-only PR
  over it is an owner decision (done here, as with #159).

## 🔁 Process gate (unchanged — per `CLAUDE.md`)
branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex in **bypass mode** (`sandbox:"danger-full-access"`, `approval-policy:"never"`),
WSL `cwd` `/mnt/d/repos/fountainrank`, **repo-relative paths**, loop until APPROVED; artifacts in
`temp/codex-reviews/` (gitignored). **Doc-only changes (specs/handoffs) commit direct to `main`;
every code slice is a PR.** **No AI attribution, no time estimates.**

## 📋 Carried-forward owner actions (still open, owner-gated)
- [ ] **Deploy + backfill prod membership** (see "OWNER ACTION" above) — new this session.
- [ ] **Verify the "Add" FAB on-device (iOS)** — the `v0.12.0` TestFlight build includes the fix
  (PR #157); check once Apple finishes processing. Paste the run-summary "What to Test" notes into
  App Store Connect (EAS non-Enterprise plan doesn't set them automatically).
- [ ] **On-device verify** #149, #146, #147, #102–105, #120 — code-complete + shipped in `v0.12.0`
  ([[fountainrank-verify-code-before-implementing-open-issue]]). #98/#99 done.
- [ ] **Submit the sitemap to GSC + Bing** (#125) — robots.txt + sitemap.xml + www→apex are **live**;
  `curl` confirmed. *(No #127 public routes exist yet — Slice 2+.)*
- [ ] **#128 GA4:** add the GA4 property id to the SEO agent's **local** registry (no secrets
  committed); `seo_health_check` → GA4 `ok`. Repo scope is nil.
- [ ] Unrelated pending: set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` on web deploy
  once store URLs exist (#135).
