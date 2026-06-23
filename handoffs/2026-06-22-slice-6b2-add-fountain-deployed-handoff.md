# Handoff — Web UI Slice 6b-2 (add-fountain) DEPLOYED (2026-06-22)

## TL;DR

**Slice 6b-2** — the authenticated **add-a-fountain** flow on the web — is **designed, Codex-approved (spec + plan), implemented (subagent-driven TDD), Codex-approved on both PRs, merged, deployed to production, and unauthenticated-verified.** It shipped as **two PRs**:

- **PR #63** (`8efd81f`) — minimal add: FAB entry + map-pin placement (tap-to-drop + draggable + keyboard) + working status + **409-duplicate** handling.
- **PR #64** (`f1d309d`) — optional fields: rating + attribute observations (built from `GET /attribute-types`) + comment + placement note.

`main` HEAD = **`f1d309d`**. Both deploys succeeded (workflow_dispatch runs `28001349139` for PR2, `27999548317` for PR1). No backend / DB / OpenAPI / client change — the contract was already live.

**▶ NEXT (fresh session): pick the next web/UI slice** — **6c discovery-filter UI**, **6d gamification surfacing** (now meaningfully populated: adds + ratings + first-in-area events are flowing), **6e mobile** (reuses this authenticated-write + add pattern), or **6g fountain moderation** (the real `require_admin` endpoints + admin pages). Each is its own spec → Codex → plan → Codex → branch → CI + Codex PR + comments → squash-merge → deploy → verify loop.

> Supersedes the "NEXT" pointer in `handoffs/2026-06-22-slice-6b1-auth-and-write-deployed-handoff.md` (still the reference for the auth shell + write-on-existing patterns this builds on).

---

## What shipped (6b-2)

**Spec:** `docs/specs/2026-06-22-web-add-fountain-design.md` (Codex APPROVED). **Plan:** `docs/plans/2026-06-22-web-add-fountain.md` (Codex APPROVED). Codex reviews in gitignored `temp/codex-reviews/` (spec-review-{1,2}, plan-review-{1,2,3}, pr-63-review-{1,2}, pr-64-review-{1,2}).

**Architecture (testability):** all logic is in pure, unit-tested modules — geo helpers `web/lib/map/placement.ts` (`boundFromFix`, `clampToBound`, `inBound`, `canPlace`, `ringFeatureCollection`, `haversineMeters`) and a pure reducer `web/lib/add-fountain-machine.ts`. The imperative MapLibre work sits behind a narrow **`PlacementMap` adapter** (`web/components/map/placement-map.ts`) so the orchestration hook **`web/components/map/useAddFountainMode.tsx`** is unit-tested against a **fake map** (jsdom has no WebGL — only the thin adapter relies on build + manual verify, like `MapBrowser`).

**PR #63 — minimal add:**
- **Entry:** a floating **"+ Add a fountain"** FAB (`web/components/map/AddFountainFab.tsx`) on the home map — hidden when WebGL2 is unavailable. Signed-out → `signInWithReturn("/?add=1")` (returns into the flow); signed-in → enters placement mode. `web/app/page.tsx` (server) threads `isAuthenticated` + `autoEnterAdd` + `hadAddParam`; the client strips `?add=1` after handling it (deferred until the map adapter exists, so the auto-enter signal isn't lost; anonymous strips immediately).
- **Placement:** tap-to-drop + draggable pin + a **keyboard path** ("Place at map center" + N/S/E/W nudge + the map's built-in keyboard pan/zoom). A **client-side GPS bound** (spec §6): a tight proximity circle (`max(150 m, accuracy)`) around a usable fix; otherwise a precision-gated viewport fallback. `PLACE_MIN_ZOOM = 16` + `FALLBACK_MAX_SPAN_M = 4000` gate forces deliberate, street-level placement. Poor-accuracy fixes (`> ACCURACY_MAX_M = 1000`) are treated as no fix. **A placed pin is frozen** — panning/zooming never silently rewrites it.
- **Submit:** Server Action `web/app/actions/add-fountain.ts` (`addFountain`) — token stays server-side, input validated as hostile (`web/lib/add-fountain.ts`), `POST /api/v1/fountains` → **201** navigates to the new fountain (and **resets add-mode** so the home map under the intercepted detail modal isn't stranded); **409** surfaces the existing fountain ("View it", also resets add-mode); **401** routes back through sign-in (not a retry). The 409 typed body is read from the `openapi-fetch` **`error`** side; a malformed 409 → `server`.
- `AddFountainPanel.tsx` (presentational, Escape/focus, role=status outcomes) + the panel/FAB mounted into `MapBrowser.tsx` via a thin seam (browse pin/cluster nav suppressed while active via `addActiveRef`; the in-view list hidden while active).

**PR #64 — optional fields:**
- `web/lib/catalog.ts` — `buildAttributeGroups` (group by category, order by sort_order, boolean→Yes/No/Unknown, enum→allowed_values+Unknown) + **module-cached** `fetchRatingTypes`/`fetchAttributeTypes` (public; success cached for the session, **failures not cached** so they retry on the next details entry).
- `StarGroup` extracted from `RatingForm` (preserving the exact per-radio accessible names) and reused by `RatingFields` (maps **`RatingTypeOut.id → rating_type_id`**); `AttributeObservationFields` (Yes/No/Unknown + enum; only non-`unknown` values submitted).
- Comment textarea + placement-note input (live counters; `COMMENTS_MAX=1000` / `PLACEMENT_NOTE_MAX=200`). Optional fields are **reset between adds** (no stale carryover). All new panel props are optional, so PR-1 behavior is unchanged.

**Constants (`web/lib/map/constants.ts`):** `BOUND_RADIUS_MIN_M=150`, `ACCURACY_MAX_M=1000`, `PLACE_MIN_ZOOM=16`, `FALLBACK_MAX_SPAN_M=4000`; `NUDGE_STEP_M=5` (in the machine).

---

## Current production state

- `main` HEAD `f1d309d` (PR #64) on top of `8efd81f` (PR #63). Deploys: `27999548317` (PR1) + `28001349139` (PR2), both **success** (DOKS rollout + DB migrations green; backend alembic unchanged — `0010_contrib_location_gist`).
- **Unauthenticated post-deploy verify (automated, green):** `api.fountainrank.com/readyz` 200; `www.fountainrank.com/` 200; `/?add=1` 200; public `GET /api/v1/rating-types` + `/attribute-types` 200.
- CI green on `main`.

### Owner-driven signed-in verify (Claude can't authenticate; **use a Chromium browser — your Firefox lacks WebGL2**)
Sign in on `https://www.fountainrank.com`, then:
1. **"+ Add a fountain"** FAB appears (signed-in). Tap → placement mode. Drop a pin (tap/drag) **or** use "Place at map center" + nudge (keyboard path). The pin is bounded near your GPS (or, with no GPS, gated to a zoomed-in view). Zoom out far → "Zoom in to place the fountain".
2. **Next: details** → "Is it working?" Yes/No → optionally **rate**, set **attributes**, add a **comment** + **placement note** → **Add fountain** → lands on the new fountain's detail; the rating/attributes/comment/note appear.
3. **Duplicate:** add again within ~10 m of an existing fountain → "A fountain already exists here" → **View it** opens the existing fountain (no duplicate created).
4. Gamification points/badges fire server-side on add (`add_fountain`, `first_fountain_bonus`, first-in-area) but **surfacing is 6d** — not visible yet.

---

## Deferred follow-ups (Minor; none blocking)

- **`/account` + `app/page.tsx` both call `getViewer()`** (the deferred 6b-1 dedupe still stands) — pass the viewer down.
- The fallback viewport bound is a **precision gate, not a proximity bound** (no GPS = can't bound to the user, by construction; documented in spec §6/§11). Real server-side add-proximity / abuse flagging is a **6g** concern.
- The in-flight catalog fetch is **not** deduped at the module level (only completed successes are cached) — a rapid details re-entry before the first fetch resolves could double-fetch (harmless). Promise-caching `web/lib/catalog.ts` would close this.

---

## Gotchas learned this slice (read before continuing)

- **pnpm store goes dirty after EVERY Codex (WSL) run** → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` / EACCES on the next Windows `pnpm`/`vitest`. Recover: `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install` (~10s). Hit this after the spec/plan reviews AND each PR review — **recover before any local web check that follows a Codex run.** Also prefix one-off web commands with `CI=true` to skip the interactive deps-purge prompt.
- **Deploy is NOT automatic on push to `main`.** `.github/workflows/deploy.yml` triggers only on a `v*.*.*` tag or **`workflow_dispatch`**. Deploy via `gh workflow run deploy.yml --ref main` (runs in CI, not locally), then `gh run watch <id>`.
- **`openapi-fetch` surfaces non-2xx typed bodies on `error`, not `data`** — read `error.fountain_id` for the 409; guard a malformed body → `server`.
- **The home map stays mounted under the intercepted `@modal` detail route** — any add-mode flow that navigates (success, duplicate "View it") MUST reset add-mode (`CANCEL`) or it strands the map (suppressed browse, hidden FAB, lingering pin). (Codex pr-63 MAJOR.)
- **A placed pin must be frozen against pan** — recompute the bound only while no pin exists, and `SET_BOUND` must not re-clamp an existing pin. (Codex pr-63 MAJOR.)
- **Hook-level "fetched" guards can cache failures** — track only successful loads / let the module cache decide, so a failed catalog fetch retries. (Codex pr-64 MAJOR.)
- **`StarGroup` extraction must preserve the exact per-radio `aria-label` `"{name}: {n} star(s)"`** or the existing `RatingForm` tests (which select by that name) break. (Codex plan MAJOR.)
- **ESLint `react-hooks/refs` + `react-hooks/set-state-in-effect`** flag the intentional latest-value-ref and derived-bound patterns — targeted `eslint-disable-next-line` is the accepted handling here.

---

## Resume commands (copy-paste)

```bash
git -C . log --oneline -3 origin/main        # HEAD = f1d309d (#64); PR1 = 8efd81f (#63)
gh issue list --state open -L 30
curl -s -o /dev/null -w "readyz %{http_code}\n" https://api.fountainrank.com/readyz
# local checks (Windows, from Git Bash) — recover the pnpm store FIRST if a Codex run just ran:
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check
# deploy (from CI, never local):
gh workflow run deploy.yml --ref main && gh run list --workflow=deploy.yml --limit 1
```

**Key artifacts:** spec `docs/specs/2026-06-22-web-add-fountain-design.md`; plan `docs/plans/2026-06-22-web-add-fountain.md`; the authenticated-write + auth-shell patterns this builds on are in `handoffs/2026-06-22-slice-6b1-auth-and-write-deployed-handoff.md`; gamification UX intent in `docs/design/gamification/*.md`; the contribution backend handoff is the API-contract + point/badge reference.
