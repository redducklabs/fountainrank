# Handoff — Web UI Slice 6b-1 (auth header + admin-aware menu + write actions) DEPLOYED (2026-06-22)

## TL;DR

**Slice 6b-1** — the authenticated app shell **and** the first contribution **writes** — is **designed, Codex-approved (spec + plan + PR), implemented (subagent-driven TDD, 13 tasks), merged, deployed to production, and unauthenticated-verified.** Two follow-up rounds of **owner-reported fixes (#62)** are also merged + deployed. `main` HEAD = **`d9626f2`** (`fix(web): auth menu z-index + Apple Sign-in profile (name capture, hide relay email) (post-6b-1) (#62)`); the slice itself is `f8f38d7` (#61).

What shipped: a **slim auth-aware site header** (one-click sign-in that returns you where you were; avatar **user menu** with Your account / Admin / Sign out), **request-time subject-based admin authority**, a **fail-closed `/admin` placeholder**, and a **Contribute section** on the fountain detail (rate / verify-report condition / add-note) via Next.js **Server Actions**. Post-deploy fixes (#62): user menu z-index (was painting under the map), **Apple Sign-in profile** (sync-on-login captures the name; private-relay email hidden).

**▶ NEXT (fresh session): brainstorm + build Slice 6b-2 — add-fountain.** See the "Slice 6b-2 resume guide" section below. Start with `superpowers:brainstorming` with the owner (UI is a collaborative track), then the spec→Codex→plan→Codex→branch→CI+Codex PR→squash-merge→deploy loop.

**What remains in the web/UI track:** **6b-2 add-fountain** (map-pin placement + 409-duplicate + attribute observations), **6c discovery-filter UI**, **6d gamification surfacing** (now meaningfully populated once 6b-1/6b-2 produce contributions), **6e mobile**, and **6g fountain moderation** (the real `require_admin` endpoints + admin pages the `/admin` menu will eventually link to). Each is its own spec → Codex → plan → Codex → branch → CI + Codex PR + comments → squash-merge → deploy → verify loop.

> This supersedes the UI-remaining portion of `handoffs/2026-06-22-slice-6a-detail-enrichment-deployed-handoff.md` (still the reference for the 6a read-only panel) and the contribution/gamification backend handoff (still the authoritative API-contract + point/badge reference).

---

## What shipped this slice (6b-1)

**Backend (only code change = admin authority):**
- `Settings.admin_subjects` (`backend/app/config.py`) — `ADMIN_SUBJECTS` env, comma/JSON, **case-sensitive, trim-only** (Logto `sub` ids, NOT emails).
- `_reconcile_admin` in `backend/app/auth.py` — on **every authenticated request**, `User.is_admin = (sub in admin_subjects)` write-if-changed (both real-JWT + dev-auth paths). Authoritative at the decision point: **immediate grant AND demotion**, no stale window. Safe on the shared `AsyncSession` because of `expire_on_commit=False` (`db.py`). Logs the transition (sub/old/new, no PII). `MeResponse.is_admin` already existed and now reflects this.
- **Why subject-based, not email:** the JWT `email` claim isn't verified at request time; `sub` is. (Codex spec-review MAJOR.)

**Web — auth shell:**
- `web/components/SiteHeader.tsx` (server, hero/bar variants) + `web/components/AuthControl.tsx` (client) — sign-in button or avatar **user menu** (name · Your account · **Admin** iff `isAdmin` · Sign out), full keyboard/focus/Escape/outside-click a11y. The map page hero is slimmed (one-line tagline) so the map dominates; `app/page.tsx` is now `force-dynamic`; the footer "Sign in" was removed.
- `web/lib/server/viewer.ts` `getViewer()` — server auth state, **fails closed**: `anonymous` | `authed{displayName,avatarUrl,isAdmin}` | `error`. Token-acquisition throw → `anonymous`; `/me` 401 → `anonymous`; 5xx/network/throw → `error` (never silently "non-admin").
- One-click sign-in return path: `web/lib/return-path.ts` `safeReturnPath` (open-redirect-safe — rejects protocol-relative/scheme/backslash/control/**bidi**/`U+2028-9`/malformed-`%`/`>512`, raw + decoded) + `RETURN_COOKIE` (lives here, NOT in the "use server" actions module) + `signInWithReturn` in `web/app/actions/auth.ts` (httpOnly/Lax/Secure-prod/path:/ cookie; **deletes** the cookie on unsafe input) + `web/app/callback/route.ts` re-validates on read.

**Web — `/admin` placeholder:** `web/app/admin/page.tsx` (server, `force-dynamic`) — fail-closed: anonymous → sign-in prompt form; `error` → retry state; authed-non-admin → `notFound()` (404); admin → "moderation coming soon" stub. Real moderation = **6g**.

**Web — write actions (Contribute section):**
- `web/app/actions/contribute.ts` (`"use server"`) — `submitRating`/`submitCondition`/`submitNote` → typed `ActionResult`. Token stays server-side (`getAuthedApiClientForAction` in `web/lib/server/api.ts` via `getAccessToken`). Inputs validated **as hostile** before any API call; error split **token→`unauthenticated` vs network→`server`**; `is_proximate:false` always; on success `revalidatePath` + the forms call `router.refresh()`.
- `web/components/fountain/{ContributeSection,RatingForm,ConditionForm,NoteForm,contributeError}.tsx` — `RatingForm` = native per-dimension radio groups (real keyboard a11y); `ConditionForm` = "I checked — it's working" + a "Report a problem" disclosure (7 statuses); `NoteForm` = upsert textarea (1–1000, counter, neutral "Your note was saved." — note may stay hidden if previously moderation-hidden). `FountainDetail` gained `isAuthenticated`; both detail routes (standalone + intercepted modal) thread it from `getViewer`. `conditionStatusLabel` in `web/lib/map/format.ts`.
- `web/next.config.ts` — `experimental.serverActions.allowedOrigins = ["fountainrank.com","www.fountainrank.com"]` (CSRF/origin).

**Deploy:** `ADMIN_SUBJECTS` wired in `.github/workflows/deploy.yml` (env map + export line) + `infra/k8s/backend.yaml` env. `docs/setup/README.md` has the variable-setup + post-deploy write-smoke runbook.

**No DB migration; no openapi/client change.** All contracts were already live.

---

## Post-6b-1 fixes (#62, deployed — owner feedback on the live header)

1. **User menu rendered under the map** → `web/components/SiteHeader.tsx` `<header>` gets `relative z-50` + the `AuthControl` dropdown gets `z-50` (the map is a positioned `<main>` and painted over the static header's dropdown).
2. **Apple users showed the raw Logto subject instead of their name** → the name only arrives via Logto userinfo (`/me/sync`), which previously ran only on `/account`. Now `web/app/callback/route.ts` calls **`syncProfileForRoute(requestId)`** right after sign-in (best-effort, never breaks login; uses `getAccessToken` not the RSC variant; `postProfileSync` is timeout-bounded 3s). So the menu shows the name on next login. `web/lib/server/sync.ts` factored a shared `postProfileSync`.
3. **Apple private-relay email** → backend `accept_email` (`backend/app/userinfo.py`) rejects `@privaterelay.appleid.com` (like the synthetic domain); web `web/lib/email.ts` `isDisplayableEmail()` (trim+lowercase; false for empty/synthetic/relay) gates the `/account` email row → **omitted** when there's no real shared email.

## Current production state

- `main` HEAD `d9626f2` (#62 fixes) on top of `f8f38d7` (#61 slice). Deploy runs `27989301777` (#61) and `27992517920` (#62) both **success**. Backend alembic unchanged (`0010_contrib_location_gist`).
- `ADMIN_SUBJECTS = u934oipb1ues` (owner's Logto subject) set in the GitHub **`production` environment**; baked into the backend pod at the #62 deploy. Admin authority reconciles on the owner's next authenticated request.
- **Unauthenticated post-deploy verify (automated, all green after both deploys):** `api.fountainrank.com/readyz` 200; `www.fountainrank.com/` 200 (slim header + Sign in); `/admin` 200 → signed-out "Sign in to access the admin tools" (fail-closed); `/fountains/{id}` 200 → "Contribute" + "Sign in to contribute" (forms hidden when signed out).
- CI green on `main`.

### Owner-driven signed-in re-verify (Claude can't authenticate as you)
**Sign OUT then sign IN again** (name capture runs at login — an existing session won't refresh until re-auth), then on `https://www.fountainrank.com`:
1. User menu now opens **above the map**; shows your **avatar** + name; items: Your account, **Admin** (admin only), Sign out. For the Apple account the menu shows the **name** (not the `sub`); `/account` shows **no email row** (relay hidden).
2. On a fountain: **rate**, **verify/report status**, **save a note** — each succeeds and the panel updates.
3. Admin account (`u934oipb1ues`): **Admin** item shows → `/admin` loads; a non-admin gets **404**. (If admin doesn't appear, confirm you signed in with the account whose Logto User ID is `u934oipb1ues` — admin is per-subject, not per-email.)

---

## Deferred follow-ups (Minor; from the reviews — none blocking)

Capture into a 6b-2/6c cleanup or address opportunistically:
- `/account` does a **redundant `/me` fetch** (renders `SiteHeader`→`getViewer` AND its own `getLogtoContext`+`/me`) — pass the viewer down.
- Wrap `AuthControl` in `<Suspense>` for `useSearchParams` (page is dynamic so it builds, but it's the canonical pattern); add `aria-labelledby` to the user menu.
- Test coverage nits: explicit `422→validation` test + `submitCondition`/`submitNote` throw-tests (shared `run()` so behavior is correct); `safeReturnPath("/foo//bar")` positive assertion; `/admin` error-state absence-of-admin-content assertion; cookie `secure` assertion; `getViewer` null-`avatarUrl` branch.
- Style-guide entries were written descriptively pre-build; reconcile any drift with the shipped components.

---

## Slice 6b-2 resume guide — add-fountain (NEXT)

**Goal:** an authenticated **add-a-fountain** flow on the web — place a pin on the map → set working status → optionally rate / set attributes / add a comment + placement note → submit, with **nearby-duplicate (409)** handling. This is the larger half of 6b (6b-1 did write-on-existing). **Brainstorm the design with the owner first** (`superpowers:brainstorming`; UI is a collaborative track), then spec→Codex→plan→Codex→branch→CI+Codex PR→squash-merge→deploy→verify.

**Backend is already live — no backend change expected.** Contract (auth required; full bodies in the contribution backend handoff):
- `POST /api/v1/fountains` → **201 `FountainDetail`** | **409 `{ detail:"duplicate_fountain", fountain_id }`** when one already exists within `duplicate_threshold_m` (10 m). Body `AddFountainRequest { location:{latitude,longitude}, is_working?=true, comments?, placement_note?(≤200), ratings?:[{rating_type_id,stars 1–5}], observations?:[{attribute_type_id,value}] }`. The generated client already exposes `AddFountainRequest` + `DuplicateFountainConflict`.
- **Attributes must be built dynamically from `GET /api/v1/attribute-types`** — `AttributeTypeOut{ id,key,place_type,category,name,description,value_kind('boolean'|'enum'),allowed_values,sort_order }` (~13 types across physical/accessibility/access). `value` ∈ `yes|no|unknown` (boolean) or an `allowed_values` member / `unknown` (enum). **Do NOT hardcode the attribute set.**
- `ConditionStatus` enum is still GET-less — hardcode it (see 6b-1's `conditionStatusLabel`).

**Reuse the 6b-1 authenticated-write pattern (don't reinvent):**
- A Next **Server Action** (extend `web/app/actions/contribute.ts` or a new `add-fountain` action) using `getAuthedApiClientForAction(requestId)` (token stays server-side), validate-before-API as hostile, and an error map that adds **409 → a `duplicate` result carrying `fountain_id`** (alongside `unauthenticated`/`validation`/`not_found`/`server`).
- Auth-gate with `getViewer` (`state==="authed"`); signed-out → reuse `signInWithReturn` to return to the add flow.
- Forms follow the 6b-1 components (`RatingForm` star pattern, the attribute toggles = yes/no/unknown built from `GET /attribute-types`).
- **Map-pin placement** uses MapLibre GL JS — `web/components/map/MapBrowser.tsx` + `web/lib/map/*`. Needs a pin-drop interaction capturing `{latitude,longitude}` (no reverse-geocode). The map is a client component; the submit goes through a server action.
- **409 flow:** on `duplicate`, surface the existing fountain (`fountain_id`) — "a fountain already exists here" with a link to view/contribute to it — instead of creating a second.

**Suggested sub-slicing (smallest-risk-first, each its own PR/deploy):** (1) the add-fountain entry point + map-pin placement + minimal submit (location + is_working) + 409 handling; (2) layer in optional rating/attributes/comment/placement-note. Confirm with the owner during brainstorming.

**Style guide:** add entries for the add-fountain affordance, the pin-placement UI, the attribute toggles, and the duplicate-confirm dialog as they're designed (`docs/style-guide.md`).

---

## Gotchas learned this slice (read before continuing)

- **A `"use server"` module may export ONLY async functions.** Exporting a `const` (e.g. `RETURN_COOKIE`) breaks `next build` but NOT `vitest` — it bit us mid-slice (a const in `actions/auth.ts`). **Web tasks touching server actions / routes / "use server" files MUST run the full `run.ps1 check -Web` (incl. `next build`), not just vitest.** `RETURN_COOKIE` now lives in `web/lib/return-path.ts` (a plain module).
- **Admin is SUBJECT-based, not email** (`ADMIN_SUBJECTS` = Logto `sub`). Setting it to an email silently never matches.
- **pnpm store goes dirty after a Codex (WSL) run** → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` on the next Windows check. Recovery: `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install` (~11s). Recover centrally before delegating web work after any Codex run.
- **vitest 4:** a `beforeEach`/`afterEach` arrow that RETURNS a value (e.g. `() => mock.mockImplementation(...)`, which returns the mock fn) is treated as a teardown callback. Use a block body `{ ... }`.
- **Local `main` vs squash-merge:** spec/plan docs were committed to local `main` but never pushed; the squash-merge put them (plus impl) into one commit on `origin/main`, so local `main` couldn't fast-forward. `git reset --hard origin/main` (the squash contains everything) — verify key files present after.
- **Codex "spec-review/plan-review" phrasing in commits is allowed** (it names the review gate, not generated authorship) — but keep it from drifting into credit lines. No AI attribution anywhere.

---

## Resume commands (copy-paste)

```bash
git -C . log --oneline -3 origin/main        # HEAD = d9626f2 post-6b-1 fixes (#62); slice = f8f38d7 (#61)
gh issue list --state open -L 30
curl -s -o /dev/null -w "readyz %{http_code}\n" https://api.fountainrank.com/readyz
# local checks (Windows, from Git Bash)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Backend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web
# if pnpm store dirties after a Codex/WSL run:
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install
```

**Key artifacts:** spec `docs/specs/2026-06-22-web-auth-ui-and-write-actions-design.md`; plan `docs/plans/2026-06-22-web-auth-ui-and-write-actions.md`; mandatory process loop + slice map in `handoffs/2026-06-22-slice-6a-detail-enrichment-deployed-handoff.md`; gamification UX intent `docs/design/gamification/*.md`. Codex reviews in gitignored `temp/codex-reviews/` (spec-review-{1,2}, plan-review-{1..4}, pr-61-review-{1,2}).
