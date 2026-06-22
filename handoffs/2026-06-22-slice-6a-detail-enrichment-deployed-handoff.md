# Handoff — Web UI Slice 6a (detail enrichment) DEPLOYED; capture/gamification UI remains (2026-06-22)

## TL;DR

The **first contribution-data UI slice (6a — read-only detail enrichment)** is **designed, Codex-approved (spec + plan + PR), implemented (TDD), merged, deployed to production, and live-verified.** `main` HEAD = **`6e43f26`** (`feat(web): detail enrichment … (#60)`). The web fountain-detail panel now surfaces the operational status, attribute consensus, placement note, and community notes that the backend has exposed since Slices 1–7. **No backend/API change** — this was pure web display.

**What remains: the rest of the web UI track** — **6b capture/write flow**, **6c discovery-filter UI**, **6d gamification surfacing**, **6e mobile**. Each is its own spec → Codex → plan → Codex → branch → CI + Codex PR + comments → squash-merge → deploy → verify loop, exactly like 6a. **Start the next session by brainstorming 6b's design with the owner** (it is a much larger surface than 6a — write forms, auth-gated UI, map-pin placement, the 409-duplicate flow).

> This handoff supersedes the **UI-remaining** portions of `handoffs/2026-06-22-contribution-and-gamification-backend-complete-handoff.md`. That earlier handoff is still the authoritative reference for the **backend + full API contract quick reference + point/badge mechanics** — read it for the write-API bodies and gamification read APIs (this handoff summarizes the parts 6b–6d need but does not fully duplicate it).

---

## What shipped this session — Slice 6a (read-only detail enrichment)

The read-only `FountainDetail` panel (web, Next.js App Router, server-rendered) now renders, in document order:

1. **Status block** (`web/components/fountain/StatusBlock.tsx`) — a chip + optional advisory line + trust line, replacing the old standalone `is_working` chip. Semantics (faithful to `backend/app/conditions.py::derive_status`):
   - Chip driven by `current_status` for the **corroborated** categories: `ok`→"Verified working" (emerald), `degraded`→"Working — issues reported" (amber), `not_working`→"Not working" (red).
   - `reported_issue` is a **non-flipping advisory** — chip keeps the `is_working` baseline ("Working"/"Out of order") and a separate amber advisory line "Issue reported recently — not yet confirmed" is shown.
   - `null`/unexpected → baseline chip (today's behavior), no advisory.
   - Trust line: "Last verified {relative}" (relative time, with a precise day-resolution date in the `title`) when `last_verified_at` set, else "Not yet verified by anyone".
2. **Placement note** — `📍` hint, only when `placement_note` present.
3. **Attribute consensus** (`web/components/fountain/AttributeList.tsx`) — observed attributes grouped by `category` (physical→"Features", accessibility→"Accessibility", access→"Access"; unknown categories title-cased). Value emphasis by confidence; `mixed` ties show "Mixed · latest: …" (surfaces `latest_observation_value`, which the backend preserves for UI); `none`→"Unknown". No raw vote tallies.
4. **Creator comment** — kept distinct from community notes, with a "From the person who added this fountain" caption.
5. **Community notes** (`web/components/fountain/NotesList.tsx`) — from `GET /fountains/{id}/notes`, fetched **server-side in parallel** with the detail and **non-fatal** (a notes outage omits the section and logs only `requestId`/`id`/`status` — never blanks the detail). Author rendered ONLY from `author_display_name`. "· edited" when `updated_at > created_at`.

All user-generated free text (note body, placement note, creator comment) carries `break-words` so long unbroken strings can't overflow the narrow panel.

**Files (all in PR #60 / commit `6e43f26`):**
- Pure helpers + tests: `web/lib/map/format.ts` (`statusDisplay`, `formatRelativeTime`, `formatDateFull`, `attributeValueLabel`, `attributeDisplay`, `formatCategory`) + `web/lib/map/format.test.ts`.
- Notes fetch + type: `web/lib/fountains.ts` (`getFountainNotesServer`, `NoteOut`) + `web/lib/fountains.test.ts`.
- Components + tests: `StatusBlock`, `AttributeList`, `NotesList`, and the rewritten `FountainDetail` (now `{ detail, notes, now? }`, with `now?` as a test seam for deterministic relative time).
- Route wiring + **first route-level tests in the repo**: `web/app/fountains/[id]/page.tsx` (+ `.test.tsx`) and `web/app/@modal/(.)fountains/[id]/page.tsx` (+ `.test.tsx`) — both fetch detail+notes in parallel; route tests mock the fetchers/`log`/`notFound`/`DetailOverlay`/`FountainDetail` and prove the non-fatal notes behavior + that the 404/!data branches stay intact.
- `docs/style-guide.md` — new entries for the three components.

**Tests:** 132 web tests passing (18 files). Full `./run.ps1 check` (backend + workspace-js + web build + mobile) green locally; CI green on PR #60.

**Deploy:** `Deploy` workflow run `27969199203` → **success** (build+push backend+web images, Trivy scans, DB migration step a no-op — alembic still at `0010`, rollout complete).

**Live-verified (2026-06-22):** `https://www.fountainrank.com/fountains/{id}` (and apex) render the StatusBlock trust line ("Not yet verified by anyone"), the status chip ("Working"), and the old "Rate this fountain arrives in Phase 3b" placeholder is **gone**. (Attribute/notes/placement sections only render when that data exists — no prod fountain has community-submitted attributes/notes/conditions yet because the write UI is 6b; that rendering is covered by the passing component tests + `next build`.)

**Codex artifacts (gitignored `temp/codex-reviews/`):** `2026-06-22-web-detail-enrichment-design-spec-review-{1,2}.md` (round 2 APPROVED), `…-plan-review-{1,2}.md` (round 2 APPROVED), `pr-60-review-{1,2}.md` (round 1 APPROVED with 1 MINOR fixed, round 2 re-APPROVED).

---

## Current production state

- `main` HEAD `6e43f26`; backend unchanged (alembic `0010_contrib_location_gist`), all of Slices 1–7 live.
- Web: `https://fountainrank.com` + `https://www.fountainrank.com` (apex + www both 200). API: `https://api.fountainrank.com`.
- The web app is **browse + enriched read-only detail**. **No write UI yet.** Mobile (`mobile/`) is still a bare skeleton (`App.tsx` only).
- CI green on `main`. Local env healthy (clean pnpm reinstall done this session — see Gotchas).

---

## The remaining UI track (slice map)

Each slice = its own spec → Codex → plan → Codex → branch → CI green + Codex PR `VERDICT: APPROVED` + every PR comment addressed → squash-merge → `gh workflow run deploy.yml --ref main` → verify live. **Brainstorm each slice's design with the owner first** (house rule: UI is a collaborative track; spec §14).

- **6a — detail enrichment (read-only)** — ✅ DONE & DEPLOYED (this session).
- **6b — web capture / write flow** [#39, #38] — **NEXT.** Auth-gated: add-fountain (map-pin placement) + rate + progressive-disclosure attribute toggles (yes/no/unknown, built dynamically from `GET /attribute-types`) + verify/report condition + add-note, including the **409-duplicate→confirm** hook. Largest surface in the track. See the 6b resume guide below.
- **6c — discovery-filter UI** [#43] — map/list filter controls for the live filter params (`working_now`, `verified_within_days`, `bottle_filler`, `wheelchair_reachable`, `dual_height`, `indoor`, `public_access`, `min_rating`, `min_rating_count`, `include_unknown`). Backend already supports them on `GET /fountains` + `/fountains/bbox`.
- **6d — gamification surfacing** [Slice 7 UI] — profile/contribution summary (`GET /me/contributions`), badge shelf (`GET /me/badges`), contributor leaderboard (`GET /leaderboard/contributors`, global + local), local-progress prompts. Honor the committed UX intent in `docs/design/gamification/{gamification-concept,design-plan-and-approach,app-store-descriptions}.md` ("Water Scouts", restrained-civic tone). Note the **open product decisions** there (points visible as a number vs. levels/badges; "Water Scouts" as the public contributor name; badge scoping) — surface these to the owner during 6d brainstorming.
- **6e — mobile** [#39] — only after a base mobile app (map/detail/add) exists; `mobile/` is currently a skeleton, an earlier phase.

**Two deferred backend bits** (unchanged; do when the moderation cluster #10–#13 lands): confirmation bonuses + moderation reversal. Schema hooks (`is_confirmed`, `parent_event_id`, `status`, `target_type/target_id`, hidden flags, recompute entry points) already exist.

---

## Resume guide — Slice 6b (web capture / write flow)

**Brainstorm the design with the owner before any code** (use the `superpowers:brainstorming` skill). 6b is broad; likely sub-slices to propose (each its own spec/plan/PR/deploy, smallest-risk first):
1. **Write actions on an existing fountain** (in the detail panel): rate, verify-it-works/report-condition, add/edit note. Lower risk than add-fountain (no map placement). This pairs naturally with the 6a detail panel.
2. **Add-fountain flow**: map-pin placement → working status → optional rating/attributes/comment/placement-note → submit, with nearby-duplicate (409) handling.

### Key design/implementation facts for 6b

- **Auth token for writes is the central new mechanic.** Reads in web are unauthenticated (`web/lib/api.ts` `getApiClient()` → `makeClient(baseUrl)`). Writes need a **Logto Bearer JWT** for the API resource. The plumbing is mostly in place:
  - `web/lib/logto.ts` already declares `API_RESOURCE = "https://api.fountainrank.com"` and `resources: [API_RESOURCE]` in the Logto config, so the session can mint an API access token.
  - Auth is wired via `@logto/next` server actions (`web/app/actions/auth.ts` — `signInAction`/`signOutAction`). Get an access token in a **server action** via `getAccessToken(config, API_RESOURCE)` (or `getLogtoContext`) from `@logto/next/server-actions`, then attach it: `makeClient(resolveApiBaseUrl(), { headers: { Authorization: \`Bearer ${token}\` } })` — `makeClient` already accepts a `headers` option (used today for `X-Request-ID`). **Recommended pattern: write forms POST to Next server actions** that fetch the token and call the API; never expose the token to the client. Confirm the exact `@logto/next` API surface (version pinned in `web/package.json`) — use Context7/the @logto/next docs.
  - The dev-auth header seam is OFF in prod (do not rely on it).
- **Write API contracts** (auth; full bodies in the backend-complete handoff's "API contract quick reference"):
  - `POST /fountains` → `201 FountainDetail` | `409 {detail:"duplicate_fountain", fountain_id}` (within 10 m). Body `{ location:{latitude,longitude}, is_working?=true, comments?, placement_note?(≤200), ratings?:[{rating_type_id,stars 1–5}], observations?:[{attribute_type_id,value}] }`.
  - `POST /fountains/{id}/ratings` → `FountainDetail`. Body `{ ratings:[{rating_type_id,stars}] }` (≥1).
  - `POST /fountains/{id}/attributes` → `FountainDetail`. Body `{ observations:[{attribute_type_id,value}] }` (≥1). `value` ∈ `yes|no|unknown` (boolean) or an `allowed_values`/`unknown` (enum). **Build the attribute UI dynamically from `GET /attribute-types`** (`AttributeTypeOut{id,key,place_type,category,name,description,value_kind(boolean|enum),allowed_values,sort_order}`) — do NOT hardcode the attribute set (13 types today across physical/accessibility/access).
  - `POST /fountains/{id}/conditions` → `FountainDetail`. Body `{ status:<ConditionStatus>, is_proximate?=false }`. **ConditionStatus enum is NOT exposed by any GET — hardcode it:** `working | broken | low_pressure | dirty | bad_taste | blocked | seasonal_unavailable | hours_limited` (`working` = the "verify it works" action).
  - `POST /fountains/{id}/notes` → `NoteOut`. Body `{ body:str(1–1000, trimmed) }`. One note per user/fountain (editing replaces). The read side (`GET …/notes`) is already wired in 6a (`getFountainNotesServer`).
- **Regenerate the typed client only if the API changed** (it hasn't for the UI): `./run.ps1 generate` → gitignored `packages/api-client/{openapi.json,src/schema.d.ts}`. The current client already exposes every read/write path + schema 6b needs (`AddFountainRequest`, `RateRequest`, `ObserveAttributesRequest`, `ConditionReportRequest`, `AddNoteRequest`, `DuplicateFountainConflict`).
- **Map-pin placement** uses MapLibre GL JS (`web/components/map/MapBrowser.tsx`, `web/lib/map/*`). Add-fountain needs a pin-placement interaction + reverse-geo-free lat/lng capture.
- **Style guide**: read `docs/style-guide.md` and add entries for every new write UI element (forms, toggles, buttons, the duplicate-confirm dialog) as they are designed.
- **Follow 6a's established patterns**: pure tested helpers in `lib/`, focused components in `components/fountain/`, vitest mirrors (component + the new route-test pattern), server components/actions, no new deps unless justified.

---

## Mandatory process loop (followed every slice — do not skip)

1. **Brainstorm design with owner** (`superpowers:brainstorming`) → approval. UI is a collaborative track.
2. **Spec** → `docs/specs/YYYY-MM-DD-<topic>-design.md`; self-review; **Codex Loop A** until `VERDICT: APPROVED` (`temp/codex-reviews/<slug>-spec-review-N.md`).
3. **Plan** → `docs/plans/YYYY-MM-DD-<topic>.md` (`superpowers:writing-plans`); **Codex Loop A** until APPROVED.
4. **Branch** `feat/…` off `main`; implement task-by-task (TDD; per-file `pnpm --filter web exec vitest run <path>`); Conventional Commits; **no AI attribution, no time estimates**.
5. **Full local mirror** `./run.ps1 check` green before PR (scoped `-Web` is a fast mid-loop check only).
6. **PR** → CI green **AND** **Codex Loop B** PR review until `VERDICT: APPROVED` **AND** every PR comment (Codex/Copilot/Dependabot/human) addressed. We do NOT run Copilot reviews, but check `gh pr view <N> --comments` + `gh api repos/redducklabs/fountainrank/pulls/<N>/comments` for any.
7. **Squash-merge** (`gh pr merge <N> --squash --delete-branch`).
8. **Deploy** `gh workflow run deploy.yml --ref main`; watch `gh run watch <id> --exit-status`; **verify live**.

**Codex invocation:** `mcp__codex__codex` / `codex-reply`, **bypass mode** (`sandbox:"danger-full-access"`, `approval-policy:"never"`), `cwd` = WSL path DERIVED from the repo root (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`), all prompt paths repo-relative. Give Codex full context (point it at `CLAUDE.md`, `claude_help/`, the spec/plan, and the backend source it renders). Fresh `codex` session per artifact; `codex-reply` on the same `threadId` for re-reviews. Full details: `claude_help/codex-review-process.md`.

---

## Gotchas learned this session (read before continuing)

- **Local pnpm store goes dirty after a Codex review.** Codex runs `pnpm` in WSL (`/mnt/d/...`), which rewrites `node_modules/.modules.yaml` to WSL state. The next **Windows** `./run.ps1 check -Web` then sees a mismatch and pnpm tries to PURGE node_modules but can't prompt → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Letting it auto-purge with `CI=true pnpm install` can **EACCES mid-purge** (transient Windows/Defender lock on `node_modules/turbo`) and **gut node_modules**. **Recovery (the documented fix):** `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install` (store on `D:\.pnpm-store\v11`, same drive → ~8–11s). Do **NOT** kill any process — none is the cause. **Tip:** finish all local web checks/builds BEFORE kicking off the Codex PR review when you still need the Windows env, or just expect to reinstall afterward. The Codex review itself still passes (it runs its own direct web lint/tsc/vitest/build in WSL). This is recorded in agent memory (`fountainrank-web-eperm-is-dirty-pnpm-store`).
- **Run `run.ps1` from Git Bash via** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web` (or `check` for the full mirror). `pwsh` is not installed; the CRLF shebang breaks a direct `./run.ps1` under WSL.
- **Docs/handoff commits go directly to `main`** (e.g. `bc78266`, `2735bc4`) — the account has admin bypass on the "PR required" rule (`git push origin main` prints "Bypassed rule violations" and succeeds). Feature work still goes via branch→PR→squash-merge. Pushing docs to `main` triggers CI + security scans but **not** deploy (deploy is the manual `deploy.yml` dispatch or a `vX.Y.Z` tag).
- **eslint forbids duplicate imports** — merge new named imports into the existing `import … from "./module"` line rather than adding a second import from the same path.
- **Prettier (Tailwind plugin) reorders className utilities** on `--write`; write code then `pnpm exec prettier --write <files>` before commit so `prettier --check` (in `./run.ps1 check -Web`) passes.
- **Web tests:** vitest `include: ["**/*.test.ts","**/*.test.tsx"]`, default env `node` with per-file `// @vitest-environment jsdom`; route tests live next to the route and import the default export (`await Page({ params: Promise.resolve({ id }) })`). Type test fixtures against the generated client (`components["schemas"][...]`) so a contract drift fails at `tsc`.

---

## Resume commands (copy-paste)

```bash
# state
git -C . log --oneline -5 origin/main        # HEAD = 6e43f26 detail enrichment (#60)
gh issue list --state open -L 30
cd backend && uv run alembic current          # expect 0010_contrib_location_gist

# prod health + 6a live verification
curl -s -o /dev/null -w "readyz %{http_code}\n" https://api.fountainrank.com/readyz
fid=$(curl -s "https://api.fountainrank.com/api/v1/fountains/bbox?min_lat=24&min_lng=-125&max_lat=49&max_lng=-66" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s "https://www.fountainrank.com/fountains/$fid" | grep -oE "Not yet verified by anyone|Last verified [^<\"]{0,20}|Working|Out of order" | head   # StatusBlock is live

# local checks (Windows, from Git Bash)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Backend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web
# if pnpm purge/EACCES dirties the store after a Codex run (see Gotchas):
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install

# deploy (always from CI; builds main HEAD)
gh workflow run deploy.yml --ref main && gh run list --workflow=deploy.yml -L 1
```

**Key artifacts:** spec `docs/specs/2026-06-22-web-detail-enrichment-design.md`; plan `docs/plans/2026-06-22-web-detail-enrichment.md`; the 6a components/helpers/routes listed above; the umbrella spec `docs/specs/2026-06-22-contribution-data-and-gamification-design.md`; gamification UX intent `docs/design/gamification/*.md`; backend-complete handoff `handoffs/2026-06-22-contribution-and-gamification-backend-complete-handoff.md` (full API contract quick reference + point/badge mechanics). Codex reviews in gitignored `temp/codex-reviews/` (not needed to continue).
