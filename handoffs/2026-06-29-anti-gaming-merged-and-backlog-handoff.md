# #119 anti-gaming merged + open-issue backlog — handoff (2026-06-29)

**Source:** a follow-on session after the UI-refresh release (see
`handoffs/2026-06-29-ui-refresh-released-handoff.md`). This session shipped the #119 anti-gaming
backend fix, filed a new web bug (#121), and closed #97 after owner on-device verification.

**Purpose:** a self-contained state + prioritized worklist so the next session can start cold
without the originating conversation. Everything below is grounded in merged code / real issue
numbers / real run state.

---

## 🟢 RESUME HERE — current state

- **Branch:** `main`, clean, synced with `origin`.
- **✅ #119 (backend anti-gaming) MERGED.** PR **[#122](https://github.com/redducklabs/fountainrank/pull/122)**
  squash-merged → `main` commit **`71098f2`** `fix(backend): reverse contribution points on admin
  hard-delete (#122)`. Issue #119 auto-closed.
  - **⚠️ NOT DEPLOYED YET.** Merge to `main` does **not** deploy (deploys are manual dispatch — see
    *Environment notes*). This backend change reaches prod only on the next deploy:
    `gh workflow run deploy.yml --ref main` (web + backend → DOKS). Decide whether to deploy now or
    batch it with the next change.
  - **Gates that passed:** local backend mirror green (ruff + format + `alembic check` no-drift +
    **345 pytest**), full CI green, **Codex `VERDICT: APPROVED`** (review-2, two `[MAJOR]` findings
    fixed in-loop), every PR comment resolved.
- **✅ #97 (iOS can't add a fountain) CLOSED** — owner device-verified iOS add works (place pin → Next
  → save succeeds). The placement-zoom gate is no longer blocking.
- **★ #121 FILED** (this session) — `bug`, web Points badge overlaps the map zoom/geolocate controls
  (top-right collision). Not yet fixed.

### What #119 actually changed (so you don't re-investigate)

- New **`reverse_contributions(session, fountain_id)`** in `backend/app/contributions.py` — the inverse
  of `record_contributions`, driven by the same `_STAT_COUNTER` map. Flips the fountain's
  `status='awarded'` `contribution_events` to `'reversed'` (UPDATE … RETURNING) and decrements each
  affected user's `user_contribution_stats` (`total_points` + per-type counter) with
  `GREATEST(col - delta, 0)`. Covers **all** contributors + every event type incl. the first-X bonuses
  (they carry `fountain_id`). Idempotent (only `awarded` rows touched → double-delete is a no-op).
- Wired into **`admin_delete_fountain`** (`backend/app/routers/admin.py`) **before**
  `session.delete(fountain)` — required because `contribution_events.fountain_id` is `ON DELETE SET
  NULL`. The delete log now records `reversed_contribution_events`.
- **Read-path consistency (Codex round-1 fixes):** `GET /me/contributions` recent feed now filters
  `status='awarded'`; the **global leaderboard** now excludes zero-point users (`total_points > 0`) so a
  fully-reversed contributor **drops off** (not a 0-point ghost row).
- **No schema migration** (the `reversed` status + counters already existed).
- Spec `docs/specs/2026-06-29-admin-moderation-design.md` §4.3/§4.7 updated.
- **Possible follow-up (not done):** other content removals (e.g. a future note *hard*-delete) could
  reverse their own events too — `reverse_contributions` is per-fountain only. Note hard-delete is not
  a feature today (admin only *hides* notes).

---

## ⚙️ What this environment CAN and CANNOT finish (read before picking a task)

This is the Windows host with Codex's WSL-built artifacts. Hard constraints (memory
`fountainrank-windows-wsl-local-check-workarounds`):

- **Backend → fully verifiable here.** Isolated uv env makes the whole backend CI mirror run green
  locally. Pick backend work freely.
- **Web → code yes, visual no.** You can write web changes and lean on CI (`workspace-js`) for
  lint/typecheck/unit + `next build`, but there is **no working local browser** (Playwright = Firefox,
  won't launch / no WebGL2). CSS/layout changes need **owner visual confirmation** or CI only.
- **Mobile → code yes, on-device no.** You can edit + `tsc`/`eslint`/vitest (pure helpers) but the
  **local emulator/Metro is broken headless** — no JS bundle serves. **Mobile visual/behavior
  verification = owner's device.** Many open mobile issues are likely already coded and kept open only
  for hardware confirmation (memory `fountainrank-verify-code-before-implementing-open-issue`) — check
  the current code + this/prior handoff before implementing.

**Takeaway:** from here, **backend and web-code** tasks reach "done" cleanly; **mobile** tasks end at
"code-complete, owner must device-verify."

---

## 📋 Prioritized open-issue backlog (28 open, as of 2026-06-29)

Order: abuse/blockers → mobile add-flow polish → verify-and-close → features → infra. Re-order to
taste. Pull any issue body for the full root-cause + acceptance: `gh issue view <N> --repo
redducklabs/fountainrank`.

**P1 — correctness / blockers (all mobile, device-gated)**

- **#102** `bug` — Android: freshly-added pin **can't be tapped** (inert draft pin left on top after a
  successful add). Confirmed tiny fix per its issue body: clear the draft on add-success / only render
  the draft layer in add mode.
- **#103** `bug` — Apple/SSO account shows an **opaque id instead of the user's name** (mobile never
  calls `POST /me/sync`, requests no `profile`/`email` scopes). User-facing identity; also feeds
  leaderboard display names. **Backend `/me/sync` already exists** (web uses it) — the work is the
  mobile call + Logto native scopes.

**P2 — mobile add-fountain + map-chrome polish (share `index.tsx` + `FountainMap.tsx`; batch to avoid conflicts)**

- **#100** `bug` — "Use current location" must recenter; placement target must stay above the bottom sheet.
- **#101** `bug` — hide the "No fountains in this area" badge while adding.
- **#104** `bug` — iOS: the "+" add button overlaps the MapLibre attribution control.
- **#105** `bug` — map compass hidden under the top filter chips.
- **#99** `enh` — draft/placement pin must be visually distinct (the `pin-unrated` asset from #118 is a
  candidate base for a greyed draft variant).
- **#98** `enh` — drop a starter draft pin at the user's location on entering add mode.
- **#120** `bug` — iOS app icon shows the pin on **black** (`icon.png` transparent → iOS flattens
  alpha). Asset-only; reuse `scripts/assets/gen_splash_icon.py` (pin on opaque white).

**Web (doable here — code; owner confirms visual)**

- **★ #121** `bug` — Points badge overlaps the map zoom/geolocate controls. Root cause: `PointsBadge`
  (`web/components/map/MapStates.tsx:75`, `absolute right-3 top-3`) and the MapLibre
  `NavigationControl`+`GeolocateControl` (`web/components/map/MapBrowser.tsx:183-190`, both
  `"top-right"`) share the top-right corner. Fix = move one to a different corner. Update
  `docs/style-guide.md` if the badge spec changes.

**P3 — verify-and-close (released; pending on-device confirmation)**

- **#65** `enh` — show a user's existing rating (released v0.10.0). Owner confirm → close.
- **#85** `bug` — map pins flicker / clustering (resolved on emulator per memory
  `fountainrank-mobile-85-newarch-mandatory`). Owner confirm on device → close.

**P4 — features**

- **#117** `enh` — leaderboard (tap the on-map points display → rankings). Backend `GET
  /api/v1/leaderboard/contributors` already exists (global + local; global now excludes zero-point
  users after #119); needs the UI (web + mobile) + an optional category-sort backend extension. **Web
  half + backend extension are doable here; mobile half is device-gated.**
- **#43** filters (map/list) · **#19** place search/geocoding · **#18** dark mode.
- **#10–#13** `moderation` — moderation roadmap (user blocking, report-to-queue, moderation queue,
  bans). Admin-moderation MVP + #119 reversal already shipped; these are the next phases.

**P5 — infra / triage**

- **#48** OSM PBF large-scale import (Geofabrik + osmium) · **#95** pnpm 11 audit hang workaround.
- **#38–#42, #44** — older rating/attribute/access-context/bathrooms umbrella issues; much is already
  implemented — **triage and close or re-scope** rather than build blind.

---

## 🔁 Process gate (do not skip — per `CLAUDE.md`)

- branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
  **squash-merge** (`gh pr merge <N> --squash`). One task at a time, Conventional Commits.
- **Codex review is mandatory and gating** (bypass mode, WSL `cwd` derived from repo root →
  `/mnt/d/repos/fountainrank`, repo-relative paths in the prompt). Loop until APPROVED. Full recipe:
  `claude_help/codex-review-process.md`.
- **No AI attribution** in commits/PRs. **No time estimates.** New UI elements → `docs/style-guide.md`.
- Handoff/docs commits go **direct to `main`** (precedent: this file, `a702bb7`, `ddc446c`).

## 🧰 Environment notes (cost real time — see memory)

- **Backend local checks (fully green here):** isolated uv env, e.g.
  `export UV_PROJECT_ENVIRONMENT=<scratchpad>/fr-venv` then from `backend/`:
  `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic
  check && uv run pytest`. PostGIS on `localhost:5436` (start with `docker compose -f
  docker/docker-compose.yml up -d db`). Do **not** touch Codex's `backend/.venv` (WSL artifact).
- **Deploys are manual `workflow_dispatch`:** `gh workflow run deploy.yml --ref main` (web+backend) and
  `gh workflow run mobile-store-release.yml --ref main -f platform=all` (mobile). Both also fire on a
  `v*.*.*` tag. Memory: `fountainrank-deploy-is-manual-dispatch`.
- **Mobile/web visual verification is owner-only here** (broken headless emulator + no WebGL2 browser).
  Don't reinstall node_modules / delete `.venv` (shared WSL store) — wastes time, can break Codex.

## Where the evidence lives

- #119 implementation: commit `71098f2`; spec `docs/specs/2026-06-29-admin-moderation-design.md`
  §4.3/§4.7; Codex reviews `temp/codex-reviews/pr-122-review-{1,2}.md` (gitignored).
- Prior handoff (UI refresh + the original backlog): `handoffs/2026-06-29-ui-refresh-released-handoff.md`.
- Each issue body has the full root-cause + file:line + acceptance: `gh issue view <N> --repo
  redducklabs/fountainrank`.
