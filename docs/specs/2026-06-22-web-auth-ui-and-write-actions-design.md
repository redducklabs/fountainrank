# Web auth UI (slim header + admin-aware user menu) + write actions on an existing fountain (slice 6b-1) — design (2026-06-22)

> **Slice 6b-1** of the contribution-data + gamification UI track — the first **write** slice,
> expanded (owner decision, 2026-06-22) to also deliver the **authenticated app shell**: a slim
> global header with a working one-click sign-in and an avatar **user menu** (account / admin /
> logout). The umbrella design is `docs/specs/2026-06-22-contribution-data-and-gamification-design.md`;
> the read-only panel this builds on is `docs/specs/2026-06-22-web-detail-enrichment-design.md`
> (slice 6a, deployed); the visual language is `docs/style-guide.md`.
>
> This slice spans **backend + web**. It establishes the **authenticated-write pattern** (server
> actions + Logto access token + revalidation) and the **auth-aware shell** that every later slice
> reuses (6b-2 add-fountain, 6c filters, 6d gamification surfacing, 6e mobile, and the 6g moderation
> cluster the admin menu will eventually link to).

## 1. Goal & scope

Slice 6a made the fountain detail panel a rich **read-only** view, but the web app has **no working
authenticated UI**: the header/footer "Sign in" is a `<Link href="/account">` that dead-ends on an
intermediate `/account` page with a *second* sign-in button, there is no signed-in affordance
(avatar/menu/logout) anywhere, and there is no write UI at all. This slice fixes all of that and adds
the first writes to an **existing** fountain.

**In scope:**

1. **Slim global header** (replaces the oversized map hero and the per-page sign-in links): small
   logo + a single-line tagline on the map page, the same slim bar (no tagline) on the other
   full-page routes, with the map as the visual focus.
2. **Working auth control, top-right:**
   - Signed out → a **"Sign in"** button that goes **directly** to Logto (no `/account` hop) and
     **returns the user to the page they were on**.
   - Signed in → the user's **avatar** opening a **user menu**: name, **Your account** (`/account`),
     **Admin** (only when `is_admin`, → `/admin`), and **Sign out**.
3. **Admin grant mechanism** — an **email allowlist** (`ADMIN_EMAILS` env) reconciled into the
   existing `User.is_admin` column, so the "two user levels" (admin / regular) are actually usable.
4. **`/admin` placeholder page** — admin-gated (server-side, authoritative via `GET /me`), a stub
   landing page ("moderation tools coming soon"); the real moderation tooling is **6g**.
5. **Write actions on an existing fountain**, in a grouped **Contribute** section of the detail
   panel: **rate** (1–5 stars per dimension), **verify "it's working" / report a problem**, and
   **add/update a note**. Signed-out visitors see an inline "Sign in to contribute" prompt that
   returns them to the fountain.

**Out of scope (explicit non-goals):**

- The **add-fountain** flow, map-pin placement, 409-duplicate, and attribute-observation editing →
  **6b-2**.
- **Functional fountain moderation** (hide/unhide endpoints, `require_admin`, admin moderation UI) →
  **6g** (the deferred #10–#13 cluster). This slice only makes the app **admin-aware** and links the
  menu to the `/admin` placeholder.
- Logto RBAC / roles in the JWT (the email-allowlist is the "for now" grant; RBAC is the long-term
  path), browser **geolocation / proximity** (`is_proximate` is always `false` on web), **optimistic
  UI**, note **prefill / delete**, gamification surfacing (6d), photos, and mobile (6e).

## 2. Existing building blocks (already shipped — reused, not rebuilt)

- **`User.is_admin: bool`** (default false) already exists (`backend/app/models.py`), and
  **`GET /api/v1/me` already returns `is_admin`** (`MeResponse`, surfaced in the generated web
  client type). The role concept exists at the data + API layer; only the **grant** and the **UI**
  are missing.
- Moderation **data hooks** (`is_hidden` on `Fountain`, `FountainNote`, `ConditionReport`,
  `AttributeObservation`) already exist — used by 6g, not this slice.
- **Auth plumbing:** `web/lib/logto.ts` (`getLogtoConfig`, `API_RESOURCE`, `resources:[API_RESOURCE]`);
  `web/app/actions/auth.ts` (`signInAction`, `signOutAction`); `web/app/callback/route.ts`;
  `web/lib/server/api.ts` (`getAuthedApiClient` via RSC token + `authedClientHeaders`);
  `web/lib/server/sync.ts` (`syncProfile`); `SignInButton`/`SignOutButton`; the `/account` page.
- `@logto/next` 4.2.10 exports both `getAccessToken(config, resource?)` (server-action token — can
  persist a refreshed token to the writable cookie store) and `getAccessTokenRSC(...)` (RSC,
  read-only cookies). Reads use the RSC variant; **writes use `getAccessToken`** (§9.2).

## 3. API contracts (all already live; no backend contract change for writes)

All write endpoints require a Logto **Bearer access token** for `https://api.fountainrank.com`
(`Depends(get_current_user)` → **401** without a valid token), and **404** for a hidden/missing
fountain. From the generated client (`@fountainrank/api-client`):

- **`POST /api/v1/fountains/{id}/ratings`** → **200** `FountainDetail`. Body
  `RateRequest { ratings: { rating_type_id:number; stars:number }[] }` (≥1; `stars` 1–5). Per-(user,
  fountain, rating_type) upsert; aggregates recomputed.
- **`POST /api/v1/fountains/{id}/conditions`** → **200** `FountainDetail`. Body
  `ConditionReportRequest { status: ConditionStatus; is_proximate?:boolean=false }`. `ConditionStatus`
  (no GET serves it — hardcode):
  `working | broken | low_pressure | dirty | bad_taste | blocked | seasonal_unavailable | hours_limited`.
  Per-user-per-day dedup is server-enforced.
- **`POST /api/v1/fountains/{id}/notes`** → **200** `NoteOut`. Body `AddNoteRequest { body:string }`
  (trimmed, 1–1000). One note per user/fountain — a second submit **replaces** the first.
- **`GET /api/v1/me`** → **200** `MeResponse { id, display_name, email, avatar_url, is_admin, created_at }`
  (auth). Drives the header avatar/name and the admin gate.

Rating dimensions come from the detail payload: `FountainDetail.dimensions` is built with an **outer
join from `RatingType`** (`backend/app/routers/fountains.py`), so it lists **every** fountain-scoped
rating type (zero-vote included), ordered by `sort_order` — the rating form renders from it with
**no extra `GET /rating-types`**. `NoteOut` carries **no user id / `is_mine`**, and the notes path is
GET (list) + POST (upsert) only — hence the note form is an unprefilled upsert (§7.3).

## 4. Backend — admin grant (email allowlist)

The only backend code change in this slice. Mirrors the existing `cors_allow_origins` pattern:

- **`Settings.admin_emails`** (`backend/app/config.py`): `Annotated[list[str], NoDecode] = []` with a
  `mode="before"` validator accepting a comma-separated **or** JSON list (empty → `[]`), normalized to
  **lowercase, trimmed**. Sourced from the `ADMIN_EMAILS` env (see §14).
- **Reconcile `is_admin` authoritatively in `sync_me`** (`backend/app/routers/users.py`): after the
  existing subject-match check + profile updates, set
  `current_user.is_admin = current_user.email.strip().lower() in settings.admin_emails`
  (add `settings: Depends(get_settings)`). The allowlist is **authoritative** — a user removed from
  it is demoted on their next sync. `sync_me` already commits + refreshes + returns `MeResponse`.
- **Creation-time correctness:** `get_current_user` (which has `settings` + the verified email
  claim) computes `is_admin = email.lower() in settings.admin_emails` and passes it to
  `get_or_create_user(..., is_admin=...)`, which sets it on the `ON CONFLICT DO NOTHING` INSERT so a
  brand-new admin is correct on first sight. (Existing users — e.g. the owner — reconcile on their
  next `sync_me`, i.e. next `/account` visit; documented in §10.) `get_current_user` itself stays
  **side-effect-free for existing users** (no write on the hot read path).

Rationale: email allowlist is declarative (no hand-editing the managed DB — respects the IaC rule),
self-contained, and adequate for the single-admin "for now". Subject-based allowlisting and Logto
RBAC are noted as the more robust future paths.

## 5. Web — slim header + auth control

### 5.1 Layout

A shared **`SiteHeader`** (server component) renders a slim brand bar: a small logo (left) and the
**`AuthControl`** (right). On the **map page** it also shows the single-line tagline "Find a drinking
fountain near you." beneath the bar (the longer subcopy is dropped); on other full-page routes it
renders the **bar only**. The map page's tall hero band is removed so the **map dominates the
viewport**. A `variant: "hero" | "bar"` prop selects the tagline. `SiteHeader` is used by the map
page (`app/page.tsx`, `hero`), the fountain standalone page, `/account`, and `/admin` (`bar`).

The map page footer's "Sign in" link is made auth-aware (a sign-in trigger when signed out; hidden
when signed in) so it is never a dead link to the old intermediate page.

### 5.2 Auth state — `getViewer()`

A new `web/lib/server/viewer.ts` (`server-only`) `getViewer()` returns a typed
`Viewer = { authenticated:false } | { authenticated:true; displayName:string; avatarUrl:string|null; isAdmin:boolean }`:
`getLogtoContext(getLogtoConfig(), { fetchUserInfo:false })` for `isAuthenticated`; when authenticated,
`GET /api/v1/me` via `getAuthedApiClient(requestId)` for name/avatar/`is_admin`. **Non-fatal:** if
`/me` fails while authenticated, return `{ authenticated:true, displayName:"", avatarUrl:null,
isAdmin:false }` (avatar falls back to a generic glyph; menu still offers Account + Sign out; the
header never blanks the page). Logged with `requestId`/`status` only — never the token. Reading the
session cookie makes the rendering **dynamic**; `app/page.tsx` (today static) becomes dynamic — an
acceptable change for an app shell.

### 5.3 `AuthControl` + user menu (client)

`AuthControl` receives the `Viewer`.

- **Signed out:** a "Sign in" button — `<form action={signInWithReturn.bind(null, returnTo)}>` where
  `returnTo` is the current path+query from `usePathname()`/`useSearchParams()` (§8).
- **Signed in:** an **avatar button** (the `avatarUrl` image, or initials/glyph fallback) with
  `aria-haspopup="menu"` + `aria-expanded`, toggling a **dropdown menu** (`role="menu"`):
  - the display name (non-interactive header),
  - **Your account** → `/account`,
  - **Admin** → `/admin` (**rendered only when `viewer.isAdmin`**),
  - a divider, then **Sign out** (`<form action={signOutAction}>`).
  - Behavior: opens on click; closes on outside-click, `Escape`, or item activation; focus moves to
    the first item on open and returns to the avatar button on close; items are `role="menuitem"`.

`signOutAction` is unchanged (returns to base URL `/`). The admin link is **never** the security
boundary — `/admin` re-checks server-side (§6); hiding it is cosmetic.

## 6. Web — `/admin` placeholder

`web/app/admin/page.tsx` (server, dynamic): call `getViewer()`. If **not authenticated** → redirect
to sign-in with `returnTo="/admin"`. If **authenticated but not admin** → `notFound()` (404 — do not
reveal the route exists). If **admin** → render `SiteHeader variant="bar"` + a stub body
("Moderation tools are coming soon", listing the planned 6g actions). The gate is the authoritative
`is_admin` from `GET /me`; no new backend endpoint is needed for the placeholder.

## 7. Web — Contribute section (write actions)

A single grouped **Contribute** section appended to the bottom of `FountainDetail` (so it appears
identically in the standalone page and the intercepted modal). The 6a read sections above are
unchanged. One auth gate:

- **Signed out** → an inline prompt + a **"Sign in to contribute"** button
  (`signInWithReturn.bind(null, \`/fountains/${detail.id}\`)`); no write controls render.
- **Signed in** → the three forms below.

### 7.1 Rating form

One row per `detail.dimensions` entry: the dimension `name` + a keyboard-accessible 5-star radio
group (the user's own rating, independent of the displayed community average). An untouched dimension
is omitted from the payload; the user may rate **any subset**; **Submit is disabled until ≥1 star is
set**. Submit POSTs `{ ratings:[{rating_type_id, stars}, …] }` for only the set dimensions; success →
inline confirmation + revalidate (so the averages above update).

### 7.2 Condition form

A prominent primary **"I checked — it's working"** (`status:"working"`); a secondary **"Report a
problem"** disclosure reveals a single-select of the seven problem statuses with friendly labels (a
pure `conditionStatusLabel` helper):

| `ConditionStatus` | Label |
|---|---|
| `broken` | "Broken / not working" |
| `low_pressure` | "Low water pressure" |
| `dirty` | "Dirty" |
| `bad_taste` | "Bad taste" |
| `blocked` | "Blocked / clogged" |
| `seasonal_unavailable` | "Shut off for the season" |
| `hours_limited` | "Only available certain hours" |

Submit POSTs `{ status, is_proximate:false }` (always false on web — honest default; verified
proximity is the mobile app's job later). Success → inline confirmation + revalidate (so the
StatusBlock / "Last verified" trust line can update).

### 7.3 Note form

A textarea (1–1000 chars, trimmed, live counter) + **"Save note"**, with copy stating it **replaces**
any prior note. **Not prefilled** — `NoteOut` carries no user id and there is no "my note" lookup or
DELETE, so the web layer cannot reliably identify "your note" (matching `author_display_name` would
be fragile and is deliberately avoided). Submit POSTs `{ body }`; empty/whitespace rejected
client-side; success → inline confirmation + revalidate (the new note appears in the 6a notes list).

## 8. Shared — sign-in return path

Today `/callback` always redirects to `/account`. Logto's redirect URI must remain the **registered**
`/callback`, so the post-login destination travels out-of-band:

- **`web/lib/return-path.ts`** — pure `safeReturnPath(value): string | null`, unit-tested. Accepts
  only a **safe internal path**: a string that starts with a single `/` (not `//` or `/\`), contains
  no scheme (`://`), no backslashes, no control characters, and is ≤512 chars; path + query + hash
  allowed. Everything else → `null`. This is the open-redirect defense; it generalizes beyond
  fountains so the **header** sign-in can return to *any* current page (map, detail, etc.) and the
  Contribute prompt can return to `/fountains/{id}`.
- **`signInWithReturn(returnTo: string)`** server action (`web/app/actions/auth.ts`): validate via
  `safeReturnPath`; if valid, set an **httpOnly, `SameSite=Lax`, `Secure` (prod), short `Max-Age`
  (~600s)** cookie `fr_return_to` (via `cookies()`); then `await signIn(config, \`${baseUrl}/callback\`)`.
  The existing `signInAction()` (used by `/account`) is left unchanged.
- **`/callback`**: after `handleSignIn` succeeds, read `fr_return_to`, **delete it**, **re-validate**
  with `safeReturnPath`, and redirect there; fall back to `/account` when absent/invalid. Failure
  path unchanged (`/account?error=signin`). Re-validating on read means a tampered cookie can't drive
  an open redirect.

## 9. Architecture & data flow

### 9.1 Write mechanism — server actions

Writes are **Next.js Server Actions**: a client form collects typed input, calls a `"use server"`
action that fetches the Logto access token **server-side**, calls the typed API client, revalidates,
and returns a typed result. **The API token never reaches the browser** (`server-only` guards). Server
actions get CSRF protection from Next's same-origin action checks; the session cookie is `SameSite=Lax`.

`web/app/actions/contribute.ts` (`"use server"`):

```
type ContributeError = "unauthenticated" | "validation" | "not_found" | "server";
type ActionResult = { ok:true } | { ok:false; error: ContributeError };

submitRating(fountainId, ratings: {rating_type_id:number; stars:number}[]): Promise<ActionResult>
submitCondition(fountainId, status: ConditionStatus): Promise<ActionResult>   // is_proximate:false set here
submitNote(fountainId, body: string): Promise<ActionResult>
```

Each: mint `requestId`; **server-side input validation** (ratings non-empty + integer
`rating_type_id` + `stars` ∈ 1–5; `status` ∈ the ConditionStatus set; `body` trimmed 1–1000) → on
failure return `{ ok:false, error:"validation" }` **without** calling the API; obtain the authed
action client (§9.2); POST via the typed client; on `2xx` → `revalidatePath(\`/fountains/${fountainId}\`)`
and `{ ok:true }`; map non-2xx → `401→"unauthenticated"`, `404→"not_found"`, `422→"validation"`, else
`"server"`; a thrown token/network error → `{ ok:false, error:"unauthenticated" }` (never an
unhandled 500). Structured logs (action, `requestId`, `fountainId`, outcome `status`) — never the
token, note body, or PII. Inputs are typed object args (not raw `FormData`) so the rating payload is
type-checked end to end and the actions are unit-testable with a mocked client.

### 9.2 Authed action client

`getAuthedApiClientForAction(requestId)` in `web/lib/server/api.ts`, parallel to `getAuthedApiClient`
but using **`getAccessToken`** (server-action variant, writable cookies) instead of
`getAccessTokenRSC`. Reuses `authedClientHeaders`; `server-only`.

### 9.3 Components

- `components/SiteHeader.tsx` (server) — slim bar; calls `getViewer()`; renders logo + `AuthControl`
  (+ tagline when `variant="hero"`).
- `components/AuthControl.tsx` (client) — sign-in button or avatar + user menu (§5.3).
- `components/fountain/ContributeSection.tsx` (client) — `{ fountainId, dimensions, isAuthenticated }`;
  signed-out prompt or the three forms.
- `components/fountain/{RatingForm,ConditionForm,NoteForm}.tsx` (client) — `useActionState`/
  `useTransition` for pending/disabled/success/error; user text `break-words`.
- Pure `conditionStatusLabel(status)` in `web/lib/map/format.ts` (with a generic title-cased fallback).

### 9.4 Wiring

`FountainDetail` gains `isAuthenticated: boolean` and renders `<ContributeSection … />` at the bottom.
Both detail routes (`app/fountains/[id]/page.tsx`, `app/@modal/(.)fountains/[id]/page.tsx`) add the
viewer's `isAuthenticated` (derive from `getViewer()` or `getLogtoContext`) to their existing
`Promise.all` and pass it down, and render `SiteHeader` (the standalone page; the modal keeps its
overlay chrome). Both are already `force-dynamic`.

## 10. Error handling & edge cases

- **Signed-out submit impossible** — controls not rendered; the prompt is the only affordance.
- **Session expired** (`401`/thrown token error) → form shows "Your session expired — sign in again";
  read panel untouched. The header, on a `/me` failure, degrades to a minimal menu (Account + Sign
  out), never blanks.
- **Validation** (`"validation"`/`422`) → inline message; never blanks the panel.
- **`404`** (fountain hidden/removed) → "This fountain is no longer available."
- **Network/`5xx`** → "Couldn't save — please try again."; controls re-enable.
- **Double-submit** → controls disabled while pending.
- **Admin reconciliation lag (documented):** after `ADMIN_EMAILS` ships, an **existing** user (the
  owner) becomes admin on their next `sync_me` (i.e. next `/account` visit); new users are correct on
  first sign-in. The header reflects admin once `GET /me` returns `is_admin:true`.
- **Unknown future `ConditionStatus`** → `conditionStatusLabel` title-cases generically.
- **Revalidation scope (documented limitation):** `revalidatePath(\`/fountains/${id}\`)` refreshes the
  detail; it does **not** refresh map pins on `/` (a `not_working` report won't instantly recolor the
  pin — reflected on next load). Whether the intercepted-modal segment re-renders from the same
  `revalidatePath` is verified during implementation (fallback: `router.refresh()` after success).
- **XSS** — all contributor text renders as escaped React children; inputs sent as JSON.
- **Accessibility** — star rating is a labeled radio group (keyboard, not color-only); the user menu
  and "Report a problem" disclosure manage `aria-expanded`/focus/`Escape`; success/error use
  `role="status"`/`aria-live="polite"`; `DetailOverlay` focus-trap unchanged.

## 11. Security considerations

- The API access token is fetched/used **only** in `server-only` modules and never serialized to the
  client; logs never include it.
- **Open-redirect**: the return path is allowlisted to safe internal paths and **re-validated on read**
  in the callback (§8).
- **Admin authorization** is enforced **server-side** (`/admin` re-checks `GET /me.is_admin`); the
  hidden menu item is cosmetic only. The `ADMIN_EMAILS` match uses the backend-accepted (verified)
  email and is the single source of `is_admin`.
- **CSRF**: writes are same-origin Next server actions; `fr_return_to` is httpOnly + `SameSite=Lax` +
  `Secure` (prod).
- Server-side input validation runs **before** any API call; the backend independently re-validates,
  enforces auth, per-user upsert/dedup, and corroboration.

## 12. Style guide

Add to `docs/style-guide.md`: the **slim site header** (hero vs bar variants, logo sizing, tagline),
the **auth control** (sign-in button; **avatar button + user menu** — items, divider, admin item
visibility, open/close/focus/`Escape` behavior), the **Contribute section** (heading + signed-out
prompt + the auth-gated three-action layout), the **star-rating input**, the **condition action row +
"Report a problem" disclosure**, the **note form** (textarea + counter + replace copy), the **inline
form pending/success/error** convention, and the **`/admin` placeholder** shell. Update the "Detail
overlay → Content" table.

## 13. Testing

**Backend (pytest, mirrors existing patterns):**
- `Settings.admin_emails` parsing: comma-separated, JSON array, empty → `[]`, case/space normalization.
- `sync_me` sets `is_admin=true` when the verified email ∈ allowlist and **clears** it when not
  (authoritative); subject-mismatch path still 403; returns updated `MeResponse`.
- `get_or_create_user` honors `is_admin` at creation; existing-user path is unchanged (no write).

**Web (vitest + jsdom):**
- `lib/return-path.test.ts`: `safeReturnPath` accepts `/fountains/{uuid}`, `/`, `/account?x=1`;
  rejects `null`/empty, `//evil.com`, `https://evil`, `/\evil`, backslash/control-char variants, and
  >512 chars.
- `lib/map/format.test.ts` (extend): `conditionStatusLabel` for all seven labels + `working` +
  unknown-status fallback.
- `lib/server/viewer.test.ts`: signed-out; signed-in happy path (name/avatar/`is_admin`); `/me`
  failure → degraded authenticated viewer; asserts token never logged (mock `getLogtoContext` + `/me`).
- `app/actions/contribute.test.ts`: each action with mocked authed client + token — happy path returns
  `{ok:true}` and calls `revalidatePath`; validation short-circuits before any API call;
  `401/404/422/5xx` → correct `ContributeError`; thrown token error → `"unauthenticated"`; token/body
  never appear in logged fields.
- Component tests: `AuthControl` (signed-out shows Sign in with bound return path; signed-in shows
  avatar + menu; **Admin item present iff `isAdmin`**; menu opens/closes on click/outside/`Escape`;
  Sign out posts `signOutAction`); `SiteHeader` (hero shows tagline, bar does not); `RatingForm`
  (Submit disabled until ≥1 star; payload only set dimensions; pending disables; success/error);
  `ConditionForm` (verify posts `working`; disclosure reveals seven labels; selecting posts the right
  status); `NoteForm` (empty rejected; counter; success/error); `ContributeSection` (signed-out prompt
  vs signed-in forms).
- `app/admin/page.test.tsx`: unauthenticated → redirect; authenticated non-admin → `notFound`;
  admin → renders the stub.
- Route tests (extend `app/fountains/[id]/page.test.tsx` + modal): `isAuthenticated` is threaded into
  `FountainDetail` for both auth states; existing 404/!data/non-fatal-notes assertions stay green.
- Full local mirror before PR: `./run.ps1 check` (backend + workspace-js + web build + mobile). Mid-loop:
  `./run.ps1 check -Web` and `./run.ps1 check -Backend`.

## 14. Deployment / infra notes

- **`ADMIN_EMAILS`** must be provided to the **backend** deployment (the owner's email(s),
  comma-separated). It is **not** a repo secret and must not be committed; it is supplied via the
  backend environment in the k8s/Terraform config and applied **through CI** (no manual cluster
  mutation, per the IaC rules). Treat as standard config (or a k8s Secret if preferred since it is
  PII). After deploy, the owner signs in and visits `/account` once to reconcile `is_admin` (§10).
- No new web env vars. No DB migration (the `is_admin` column already exists). No API
  contract/openapi change (the generated client already exposes every path + `is_admin`).

## 15. Out of scope / follow-ups

- **6b-2** — add-fountain (map-pin placement, status/rating/attributes/comment/placement-note,
  409-duplicate) + attribute-observation editing built from `GET /attribute-types`.
- **6g** — fountain **moderation**: `require_admin` dependency, hide/unhide endpoints (leveraging the
  existing `is_hidden` hooks), and the admin moderation pages the `/admin` menu will link to (the
  deferred #10–#13 cluster).
- **6c** filters, **6d** gamification surfacing (meaningfully populated once writes exist), **6e**
  mobile (reuses this authenticated-write pattern). Subject-based admin allowlisting / Logto RBAC and
  instant map-pin refresh on status change are deferred.
