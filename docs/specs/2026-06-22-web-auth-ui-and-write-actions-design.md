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
>
> **Revision note (spec-review round 1):** admin authorization was redesigned to be **authoritative
> at request time** via a **subject-based** allowlist (`ADMIN_SUBJECTS`), reconciled on every
> authenticated request — replacing the earlier email-allowlist-reconciled-at-profile-sync design,
> which was not authoritative enough for a privilege boundary (stale grants/demotions, unverified
> email). Other round-1 fixes (CSRF origin pinning, return-path hardening, fail-closed admin gate,
> concrete env delivery, internal plan sequencing) are folded in below.

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
     **Admin** (only when admin, → `/admin`), and **Sign out**.
3. **Admin authorization** — a **subject allowlist** (`ADMIN_SUBJECTS` env) evaluated as the
   authority on every authenticated request and synchronized into the existing `User.is_admin`
   column, so the "two user levels" (admin / regular) are real, immediate, and revocable.
4. **`/admin` placeholder page** — admin-gated server-side (authoritative via `GET /me`, fails
   **closed**), a stub landing page ("moderation tools coming soon"); the real moderation tooling is
   **6g**.
5. **Write actions on an existing fountain**, in a grouped **Contribute** section of the detail
   panel: **rate** (1–5 stars per dimension), **verify "it's working" / report a problem**, and
   **add/update a note**. Signed-out visitors see an inline "Sign in to contribute" prompt that
   returns them to the fountain.

**Out of scope (explicit non-goals):**

- The **add-fountain** flow, map-pin placement, 409-duplicate, and attribute-observation editing →
  **6b-2**.
- **Functional fountain moderation** (hide/unhide endpoints, `require_admin`-gated routes, admin
  moderation UI) → **6g** (the deferred #10–#13 cluster). This slice only makes the app
  **admin-aware** and links the menu to the `/admin` placeholder.
- Logto RBAC / roles in the JWT (the subject allowlist is the "for now" grant; RBAC is the long-term
  path), browser **geolocation / proximity** (`is_proximate` is always `false` on web), **optimistic
  UI**, note **prefill / delete**, gamification surfacing (6d), photos, and mobile (6e).

## 2. Existing building blocks (already shipped — reused, not rebuilt)

- **`User.is_admin: bool`** (default false) already exists (`backend/app/models.py`), and
  **`GET /api/v1/me` already returns `is_admin`** (`MeResponse`, surfaced in the generated web
  client type). The role concept exists at the data + API layer; only the **authority/grant** and the
  **UI** are missing.
- Moderation **data hooks** (`is_hidden` on `Fountain`, `FountainNote`, `ConditionReport`,
  `AttributeObservation`) already exist — used by 6g, not this slice. Note: a note upsert
  deliberately leaves `is_hidden` untouched (`backend/app/routers/fountains.py`), so a previously
  hidden note stays hidden after edit (see §7.3).
- **Auth plumbing:** `web/lib/logto.ts` (`getLogtoConfig`, `API_RESOURCE`, `resources:[API_RESOURCE]`);
  `web/app/actions/auth.ts` (`signInAction`, `signOutAction`); `web/app/callback/route.ts`;
  `web/lib/server/api.ts` (`getAuthedApiClient` via RSC token + `authedClientHeaders`);
  `web/lib/server/sync.ts` (`syncProfile`); `SignInButton`/`SignOutButton`; the `/account` page.
- `backend/app/auth.py`: `get_current_user` validates the Logto resource JWT (signature/iss/aud/exp
  via JWKS) and resolves the local user through `get_or_create_user`; the validated **`sub`** is the
  trustworthy identity. `claims.get("email")` is **not** guaranteed verified (no `email_verified`
  check), which is why admin authority is **subject-based**, not email-based (§4).
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
  (trimmed, 1–1000). One note per user/fountain — a second submit **replaces** the first; moderation
  fields are untouched (§7.3).
- **`GET /api/v1/me`** → **200** `MeResponse { id, display_name, email, avatar_url, is_admin, created_at }`
  (auth). Drives the header avatar/name and the admin gate; `is_admin` is reconciled to the
  `ADMIN_SUBJECTS` authority before the response (§4).

Rating dimensions come from the detail payload: `FountainDetail.dimensions` is built with an **outer
join from `RatingType`** (`backend/app/routers/fountains.py`), so it lists **every** fountain-scoped
rating type (zero-vote included), ordered by `sort_order` — the rating form renders from it with
**no extra `GET /rating-types`**. `NoteOut` carries **no user id / `is_mine`**, and the notes path is
GET (list) + POST (upsert) only — hence the note form is an unprefilled upsert (§7.3).

## 4. Backend — admin authorization (subject allowlist, authoritative at request time)

The only backend code change in this slice. **Authority = `ADMIN_SUBJECTS`** (a set of Logto subject
ids — the validated JWT `sub`, the only cryptographically trustworthy identity available on every
request). Email is **not** used (the JWT `email` claim is not verified at request time, and fetching
verified userinfo per request is too heavy).

- **`Settings.admin_subjects`** (`backend/app/config.py`): `Annotated[list[str], NoDecode] = []` with
  a `mode="before"` validator accepting a comma-separated **or** JSON list (empty → `[]`), trimmed.
  Sourced from the `ADMIN_SUBJECTS` env (delivery in §14). Subjects are opaque ids, not secrets.
  Matching is **exact, case-sensitive, and trim-only** — a Logto `sub` is opaque and must **never**
  be lowercased/normalized (do not copy the email-normalization habit into subject handling).
- **Reconcile on every authenticated request, in `get_current_user`.** After resolving the user,
  compute `desired = sub in settings.admin_subjects`; if `user.is_admin != desired`, set it and
  **commit (write-if-changed only)**. After the first reconciliation the value matches and **no
  further writes occur** — the comparison is O(1) and the write is one-shot per transition. This
  makes `User.is_admin` an always-fresh synchronized cache and makes **grant and demotion take
  effect immediately on the next authenticated request** (no `/account` visit, no indefinite stale
  admin). The change is an independent user-row update (the row is already provisioned/flushed by
  `get_or_create_user`); committing it in the dependency does not couple to the endpoint's own
  transaction, and if a later rollback discards it, it simply reconciles again next request. Applies
  to both the real-JWT path (`sub`) and the dev-auth seam (`x_dev_user` as the subject).
- **`GET /me`** then returns the reconciled `is_admin`; **`/admin`** (web) gates on it authoritatively
  (§5–§6). A reusable backend `require_admin` dependency (computing the same authority) is **deferred
  to 6g**, where admin endpoints actually exist.
- `sync_me` and `get_or_create_user` are **unchanged** with respect to admin (no creation-time or
  profile-sync admin coupling — request-time reconciliation supersedes it).
- **Logging:** an admin-status transition (false↔true) is logged once, structured, with the request
  id, the (already-validated, already-logged-at-debug) `sub`, and the old→new value — **never** the
  allowlist contents or any email. Steady state logs nothing extra.

Rationale: subject-based + request-time reconciliation is declarative (no hand-editing the managed
DB), authoritative at the decision point, immediately revocable, and based on a verified identity.
Logto RBAC (roles as JWT claims) is the documented long-term path.

## 5. Web — slim header + auth control

### 5.1 Layout

A shared **`SiteHeader`** (server component) renders a slim brand bar: a small logo (left) and the
**`AuthControl`** (right). On the **map page** it also shows the single-line tagline "Find a drinking
fountain near you." beneath the bar (the longer subcopy is dropped); on other full-page routes it
renders the **bar only**. The map page's tall hero band is removed so the **map dominates the
viewport**. A `variant: "hero" | "bar"` prop selects the tagline. `SiteHeader` is used by the map
page (`app/page.tsx`, `hero`), the fountain standalone page, `/account`, and `/admin` (`bar`).

The map page footer's "Sign in" link is made auth-aware (a sign-in trigger when signed out; hidden
when signed in) so it is never a dead link. The signed-in footer's exact contents/spacing are pinned
in the style guide + a test so removing the item doesn't regress mobile wrapping.

### 5.2 Auth state — `getViewer()`

A new `web/lib/server/viewer.ts` (`server-only`) `getViewer()` returns a **discriminated** result so
callers can fail closed:

```
type Viewer =
  | { state: "anonymous" }
  | { state: "authed"; displayName: string; avatarUrl: string | null; isAdmin: boolean }
  | { state: "error" };   // a session exists but identity could not be confirmed
```

`getLogtoContext(getLogtoConfig(), { fetchUserInfo:false })` decides anonymous vs. has-session; when
a session exists, `GET /api/v1/me` via `getAuthedApiClient(requestId)` fills name/avatar/`is_admin`.
**Failure handling distinguishes the cases (do not collapse them):**
- `/me` **401** (or a thrown token/session error) → `state:"anonymous"` (the session is no longer
  usable → offer sign-in).
- `/me` **5xx / network** → `state:"error"` (backend unavailable — never silently downgrade to
  "authed non-admin", which would mask an outage and hide the Admin link).

Header rendering: `anonymous` → Sign-in button; `authed` → avatar + menu (Admin item iff `isAdmin`);
`error` → avatar + a minimal menu (Account, Sign out) with a subtle "couldn't load your account"
note, **no Admin item**. Logged with `requestId`/`status` only — never the token. Reading the session
cookie makes rendering **dynamic**; `app/page.tsx` (today static) becomes dynamic — an acceptable
change for an app shell.

### 5.3 `AuthControl` + user menu (client)

`AuthControl` receives the `Viewer`.

- **Signed out:** a "Sign in" button — `<form action={signInWithReturn.bind(null, returnTo)}>` where
  `returnTo` is the current path+query from `usePathname()`/`useSearchParams()` (§8).
- **Signed in:** an **avatar button** (`aria-label="Open account menu"`; the image is decorative,
  `alt=""`; initials/glyph fallback when `avatarUrl` is null) with `aria-haspopup="menu"` +
  `aria-expanded`, toggling a **dropdown menu** (`role="menu"`):
  - the display name (non-interactive header),
  - **Your account** → `/account`,
  - **Admin** → `/admin` (**rendered only when `viewer.isAdmin`**),
  - a divider, then **Sign out** (`<form action={signOutAction}>`).
  - Behavior: opens on click; closes on outside-click, `Escape`, or item activation; focus moves to
    the first item on open and returns to the avatar button on close; items are `role="menuitem"`.

`signOutAction` is unchanged (returns to base URL `/`). The hidden Admin item is **cosmetic only** —
`/admin` re-checks server-side and fails closed (§6).

## 6. Web — `/admin` placeholder

`web/app/admin/page.tsx` (server, dynamic): call `getViewer()`. **Fails closed:**
- `state:"anonymous"` → redirect to sign-in with `returnTo="/admin"`.
- `state:"authed"` && **not** `isAdmin` → `notFound()` (404 — do not reveal the route).
- `state:"error"` → render a clear "couldn't verify admin access — try again" state (NOT admin
  content, NOT a 404).
- `state:"authed"` && `isAdmin` → `SiteHeader variant="bar"` + a stub body ("Moderation tools are
  coming soon", listing the planned 6g actions).

The gate is the authoritative, request-time-reconciled `is_admin` from `GET /me` (§4). No new backend
endpoint is needed for the placeholder.

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
inline confirmation + a fresh detail (§9.5).

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
proximity is the mobile app's job later). Success → inline confirmation + fresh detail (§9.5).

### 7.3 Note form

A textarea (1–1000 chars, trimmed, live counter) + **"Save note"**, with copy stating it **replaces**
any prior note. **Not prefilled** — `NoteOut` carries no user id and there is no "my note" lookup or
DELETE, so the web layer cannot reliably identify "your note" (matching `author_display_name` would
be fragile and is deliberately avoided). Submit POSTs `{ body }`; empty/whitespace rejected
client-side; on success the confirmation reads a **neutral "Your note was saved."** — it does **not**
claim the note now appears publicly, because a note that was previously **hidden by moderation stays
hidden after an upsert** (the backend leaves `is_hidden` untouched), so it would not appear in the
public list. The detail is refreshed (§9.5); whether a given note appears is the public list's call.

## 8. Shared — sign-in return path

Today `/callback` always redirects to `/account`. Logto's redirect URI must remain the **registered**
`/callback`, so the post-login destination travels out-of-band:

- **`web/lib/return-path.ts`** — pure `safeReturnPath(value): string | null`, unit-tested. Accepts
  only a **safe internal path** and is **hostile-input hardened**:
  - must be a string starting with a single `/` (reject `//`, `/\`, and any scheme `://`),
  - reject literal **and percent-encoded** backslashes/forward-slash pairs and control chars
    (`%5c`, `%2f%2f`, `%00`–`%1f`), Unicode line/paragraph separators (`U+2028`/`U+2029`) and other
    bidi/control code points,
  - reject length > 512,
  - path + query + hash otherwise allowed.

  Implementation note: decode percent-encoding once and re-apply the disallow checks to the decoded
  form (so `/%5c%5cevil` and `/%2f%2fevil` are rejected), and reject any value that still contains a
  `%` that doesn't decode cleanly. This generalizes beyond fountains so the **header** sign-in can
  return to *any* current page and the Contribute prompt can return to `/fountains/{id}`.
- **`signInWithReturn(returnTo: string)`** server action (`web/app/actions/auth.ts`): validate via
  `safeReturnPath`; if valid, set the cookie `fr_return_to` (via `cookies()`) with
  **`path:"/"`, `httpOnly`, `SameSite:"lax"`, `Secure` in prod, `maxAge ~600s`**, **overwriting** any
  prior value on every sign-in attempt; then `await signIn(config, \`${baseUrl}/callback\`)`. If
  `returnTo` is invalid, set no cookie (callback falls back to `/account`). The existing
  `signInAction()` (used by `/account`) is unchanged.
- **`/callback`**: after `handleSignIn` succeeds, read `fr_return_to`, **delete it with the same
  `path:"/"`**, **re-validate** with `safeReturnPath`, and redirect there; fall back to `/account`
  when absent/invalid. Failure path unchanged (`/account?error=signin`). Re-validating on read means a
  tampered cookie can't drive an open redirect.

## 9. Architecture & data flow

### 9.1 Write mechanism — server actions (client input is untrusted)

Writes are **Next.js Server Actions**: a client form collects input and calls a `"use server"` action
that fetches the Logto access token **server-side**, calls the typed API client, refreshes, and
returns a typed result. **The API token never reaches the browser** (`server-only` guards).

**Trust boundary:** a Server Action argument is **client-originated and untrusted** regardless of its
TypeScript type — a caller can invoke the action with arbitrary serialized arguments. The TS types are
a *developer-ergonomics* aid, **not** a security guarantee. Every action therefore **validates its
input server-side as hostile** before any API call, and the backend independently re-validates and
enforces auth. These controls are **JavaScript-required** (the star matrix and disclosures are
interactive); no-JS progressive enhancement is explicitly out of scope for the Contribute controls
(the detail panel is already client-interactive).

`web/app/actions/contribute.ts` (`"use server"`):

```
type ContributeError = "unauthenticated" | "validation" | "not_found" | "server";
type ActionResult = { ok:true } | { ok:false; error: ContributeError };

submitRating(fountainId, ratings: {rating_type_id:number; stars:number}[]): Promise<ActionResult>
submitCondition(fountainId, status: ConditionStatus): Promise<ActionResult>   // is_proximate:false set here
submitNote(fountainId, body: string): Promise<ActionResult>
```

Each: mint `requestId`; **server-side hostile-input validation** (`fountainId` is a UUID; `ratings`
non-empty, each `rating_type_id` an integer, each `stars` an integer ∈ 1–5; `status` ∈ the
ConditionStatus set; `body` a string, trimmed length 1–1000) → on failure return
`{ ok:false, error:"validation" }` **without** calling the API; obtain the authed action client
(§9.2); POST via the typed client; on `2xx` → refresh (§9.5) and `{ ok:true }`; map non-2xx →
`401→"unauthenticated"`, `404→"not_found"`, `422→"validation"`, else `"server"`; a thrown
token/network error → `{ ok:false, error:"unauthenticated" }` (never an unhandled 500). Structured
logs (action, `requestId`, `fountainId`, outcome `status`) — never the token, note body, or PII.

### 9.2 Authed action client

`getAuthedApiClientForAction(requestId)` in `web/lib/server/api.ts`, parallel to `getAuthedApiClient`
but using **`getAccessToken`** (server-action variant, writable cookies) instead of
`getAccessTokenRSC`. Reuses `authedClientHeaders`; `server-only`.

### 9.3 Server Action CSRF / origin pinning (production)

Next 16 protects Server Actions by comparing the request `Origin` to the `Host`/`X-Forwarded-Host`.
Behind the DOKS NGINX ingress this only holds if the ingress preserves the public host. This slice
therefore **requires**:
- set `experimental.serverActions.allowedOrigins = ["fountainrank.com", "www.fountainrank.com"]` in
  `web/next.config.ts` (explicit, reviewable) so action POSTs are accepted for both public origins;
- **verify** in the prod-like environment that the web ingress forwards `Host`/`X-Forwarded-Host` as
  the public host for action POSTs (the same trust-proxy concern noted in `claude_help/oauth-sso.md`);
- a **post-deploy smoke step**: perform one authenticated write end-to-end against the deployed site
  and confirm it succeeds (catches an ingress/origin misconfig that unit tests cannot). The procedure
  is captured as a **reproducible runbook/script entry delivered with the PR** (it need not run from
  local deploy tooling) and must not log tokens or contributor note bodies.

### 9.4 Components

- `components/SiteHeader.tsx` (server) — slim bar; calls `getViewer()`; renders logo + `AuthControl`
  (+ tagline when `variant="hero"`).
- `components/AuthControl.tsx` (client) — sign-in button or avatar + user menu (§5.3).
- `components/fountain/ContributeSection.tsx` (client) — `{ fountainId, dimensions, isAuthenticated }`;
  signed-out prompt or the three forms.
- `components/fountain/{RatingForm,ConditionForm,NoteForm}.tsx` (client) — `useActionState`/
  `useTransition` for pending/disabled/success/error; user text `break-words`.
- Pure `conditionStatusLabel(status)` in `web/lib/map/format.ts` (with a generic title-cased fallback).

### 9.5 Post-write refresh (decided — no implementation-time hedge)

After a successful action: the action calls `revalidatePath(\`/fountains/${fountainId}\`)` (canonical
detail) **and** the client calls `router.refresh()` on success. The client `router.refresh()` is the
deterministic path that updates **both** the standalone route and the intercepted-modal segment
(`web/app/@modal/(.)fountains/[id]/page.tsx`), so averages/status/notes are never stale after a write
regardless of which segment is mounted. (Known product limitation, documented: map **pins** on `/`
are not revalidated by a single fountain write — a `not_working` report recolors the pin on next map
load; broad map revalidation is out of scope.)

### 9.6 Wiring

`FountainDetail` gains `isAuthenticated: boolean` and renders `<ContributeSection … />` at the bottom.
Both detail routes (`app/fountains/[id]/page.tsx`, `app/@modal/(.)fountains/[id]/page.tsx`) derive
`isAuthenticated` from `getViewer()` (`state==="authed"`) and pass it down, and the standalone page
renders `SiteHeader`; the modal keeps its overlay chrome. Both are already `force-dynamic`.

## 10. Error handling & edge cases

- **Signed-out submit impossible** — controls not rendered; the prompt is the only affordance.
- **Session expired** (`401`/thrown token error) → form shows "Your session expired — sign in again";
  read panel untouched. `getViewer()` returns `anonymous` so the header offers sign-in.
- **Backend down for `/me`** (`5xx`/network) → `getViewer()` returns `error`; the header shows a
  degraded menu (no Admin), `/admin` shows a retry state (fails closed) — neither is silently treated
  as "non-admin".
- **Validation** (`"validation"`/`422`) → inline message; never blanks the panel.
- **`404`** (fountain hidden/removed) → "This fountain is no longer available."
- **Network/`5xx` on a write** → "Couldn't save — please try again."; controls re-enable.
- **Double-submit** → controls disabled while pending.
- **Admin grant/demotion** — takes effect on the **next authenticated request** (§4); no stale-admin
  window, no `/account` round-trip.
- **Hidden prior note** — an upsert over a moderation-hidden note keeps it hidden; the success copy is
  neutral and does not promise public visibility (§7.3).
- **Unknown future `ConditionStatus`** → `conditionStatusLabel` title-cases generically.
- **XSS** — all contributor text renders as escaped React children; inputs sent as JSON.
- **Accessibility** — star rating is a labeled radio group (keyboard, not color-only); the avatar
  button has an `aria-label` and the menu/disclosure manage `aria-expanded`/focus/`Escape`;
  success/error use `role="status"`/`aria-live="polite"`; `DetailOverlay` focus-trap unchanged.

## 11. Security considerations

- **Admin authority** is `ADMIN_SUBJECTS` evaluated against the **verified JWT `sub`** on **every
  authenticated request** (§4): immediate grant, immediate revocation, trustworthy identity (no
  reliance on an unverified email claim). `User.is_admin` is a synchronized cache, never a lazily
  reconciled source of truth. `/admin` and (later) `require_admin` enforce server-side; the hidden
  menu item is cosmetic.
- The API access token is fetched/used **only** in `server-only` modules and never serialized to the
  client; logs never include it.
- **Open-redirect**: `safeReturnPath` allowlists safe internal paths (literal + percent-encoded
  hostile forms rejected) and is **re-validated on read** in the callback; the `fr_return_to` cookie
  is `path:"/"` + httpOnly + `SameSite=Lax` + `Secure` (prod) + short-lived + overwritten/deleted with
  the same path (§8).
- **CSRF / origin**: writes are same-origin Next Server Actions with `allowedOrigins` pinned to the
  two public hosts and an ingress-host verification + post-deploy write smoke (§9.3).
- **Untrusted input**: Server Action arguments are validated server-side as hostile before any API
  call (§9.1); the backend independently re-validates, enforces auth, per-user upsert/dedup, and
  corroboration.

## 12. Style guide (a same-commit prerequisite, not an afterthought)

Per the house rule, the implementation plan's **first task** updates `docs/style-guide.md` (which
still documents the old hero/header) before/with the new UI. Add: the **slim site header** (hero vs
bar variants, logo sizing, tagline), the **auth control** (sign-in button; **avatar button + user
menu** — items, divider, admin-item visibility, open/close/focus/`Escape` behavior, `aria-label`,
decorative avatar `alt`), the **signed-in footer** contents/spacing, the **Contribute section**
(heading + signed-out prompt + auth-gated three-action layout), the **star-rating input**, the
**condition action row + "Report a problem" disclosure**, the **note form** (textarea + counter +
replace copy), the **inline form pending/success/error** convention, and the **`/admin` placeholder**
shell. Update the "Detail overlay → Content" table.

## 13. Testing

**Backend (pytest, mirrors existing patterns):**
- `Settings.admin_subjects` parsing: comma-separated, JSON array, empty → `[]`, trimming.
- `get_current_user` reconciliation: a `sub` in `ADMIN_SUBJECTS` → `is_admin` becomes true (one write)
  and `GET /me` returns true on the same request; a `sub` removed from the allowlist → `is_admin`
  **demoted** to false on the next request; **write-if-changed** (no write when already correct);
  both real-JWT and dev-auth subjects; the admin-transition log line is emitted (no allowlist/email).
- `GET /me` reflects the reconciled value; non-admin user → false.
- an authenticated **write** endpoint (e.g. submit a rating) succeeds **immediately after an admin
  transition**, proving the `get_current_user` write-if-changed commit does not break the endpoint's
  own later transaction/commit on the shared `AsyncSession`.

**Web (vitest + jsdom):**
- `lib/return-path.test.ts`: `safeReturnPath` accepts `/fountains/{uuid}`, `/`, `/account?x=1#h`;
  rejects `null`/empty, `//evil.com`, `https://evil`, `/\evil`, **percent-encoded** `/%5c%5cevil`,
  `/%2f%2fevil`, `%00`/control chars, `U+2028`/`U+2029`, malformed `%`, and >512 chars.
- `lib/map/format.test.ts` (extend): `conditionStatusLabel` for all seven labels + `working` +
  unknown-status fallback.
- `lib/server/viewer.test.ts`: anonymous; authed happy path (name/avatar/`is_admin`); `/me` **401** →
  `anonymous`; `/me` **5xx** → `error` (NOT authed-non-admin); token never logged (mock
  `getLogtoContext` + `/me`).
- `app/actions/contribute.test.ts`: each action with mocked authed client + token — happy path returns
  `{ok:true}` and triggers revalidate; validation short-circuits before any API call; **hostile/
  malformed serialized payloads** (bad `fountainId`, out-of-range `stars`, unknown `status`, oversized
  `body`) are rejected as `"validation"`; `401/404/422/5xx` → correct `ContributeError`; thrown token
  error → `"unauthenticated"`; token/body never appear in logged fields.
- Component tests: `AuthControl` (signed-out shows Sign in with bound return path; authed shows avatar
  + menu with `aria-label`; **Admin item present iff `isAdmin`**; `error` state shows degraded menu w/o
  Admin; menu opens/closes on click/outside/`Escape`; Sign out posts `signOutAction`); `SiteHeader`
  (hero shows tagline, bar does not); `RatingForm` (Submit disabled until ≥1 star; payload only set
  dimensions; pending disables; success/error); `ConditionForm` (verify posts `working`; disclosure
  reveals seven labels; selecting posts the right status); `NoteForm` (empty rejected; counter; neutral
  success copy); `ContributeSection` (signed-out prompt vs signed-in forms).
- `app/admin/page.test.tsx`: anonymous → redirect; authed non-admin → `notFound`; `error` → retry
  state (not admin content, not 404); admin → renders the stub.
- Route tests (extend `app/fountains/[id]/page.test.tsx` + modal): `isAuthenticated` is threaded into
  `FountainDetail` for both auth states; existing 404/!data/non-fatal-notes assertions stay green.
- **Post-deploy**: a manual/scripted authenticated-write smoke against the deployed site (§9.3).
- Full local mirror before PR: `./run.ps1 check` (backend + workspace-js + web build + mobile). Mid-loop:
  `./run.ps1 check -Web` and `./run.ps1 check -Backend`.

## 14. Deployment / infra notes

- **`ADMIN_SUBJECTS`** delivery is concrete (deploy renders raw k8s YAML via `envsubst`, not generic
  Terraform): add a **GitHub Actions variable** `ADMIN_SUBJECTS` (the owner's Logto subject id(s),
  comma-separated — opaque ids, not secrets, so a `vars.` variable like `GOOGLE_DELEGATED_USER`/
  `FROM_EMAIL`/`LOGTO_APP_ID`); reference it in `.github/workflows/deploy.yml` (`ADMIN_SUBJECTS:
  ${{ vars.ADMIN_SUBJECTS }}`) and add `ADMIN_SUBJECTS` to that step's `export …` list; add an env
  entry to `infra/k8s/backend.yaml` (`- name: ADMIN_SUBJECTS\n  value: "${ADMIN_SUBJECTS}"`). All
  applied **through CI** (no manual cluster mutation, per the IaC rules); documented in
  `docs/setup` / `claude_help/github-environments.md`. The owner obtains their `sub` from the Logto
  admin console. With request-time reconciliation, the owner becomes admin on the **next
  authenticated request** after deploy (e.g. the header loading `/me`) — no extra step.
- **`web/next.config.ts`**: add `experimental.serverActions.allowedOrigins` for the two public hosts
  (§9.3). No new web runtime env vars.
- No DB migration (the `is_admin` column already exists). No API contract/openapi change (the
  generated client already exposes every path + `is_admin`).

## 15. Implementation sequencing (single PR, internally gated)

The owner chose one slice/PR; to keep it reviewable, the plan orders it as discrete,
independently-verifiable steps (each with its own tests, green before the next):

1. **Style guide** entries for all new UI (prerequisite, §12).
2. **Backend** — `admin_subjects` setting + request-time reconciliation + logging + tests (§4, §13).
3. **Shared sign-in return path** — `safeReturnPath` + `signInWithReturn` + callback change + tests (§8).
4. **Header / auth shell** — `getViewer`, `SiteHeader`, `AuthControl`, footer; map hero slimmed;
   `app/page.tsx` dynamic (§5).
5. **`/admin`** placeholder (fail-closed gate) (§6).
6. **Contribute server-action infrastructure** — `getAuthedApiClientForAction`, `contribute.ts`
   actions, `next.config.ts` origins (§9).
7. **The three forms** + `ContributeSection` wiring into `FountainDetail` + route threading (§7, §9.6).

## 16. Out of scope / follow-ups

- **6b-2** — add-fountain (map-pin placement, status/rating/attributes/comment/placement-note,
  409-duplicate) + attribute-observation editing built from `GET /attribute-types`.
- **6g** — fountain **moderation**: a `require_admin` dependency, hide/unhide endpoints (leveraging the
  existing `is_hidden` hooks), and the admin moderation pages the `/admin` menu will link to (the
  deferred #10–#13 cluster).
- **6c** filters, **6d** gamification surfacing (meaningfully populated once writes exist), **6e**
  mobile (reuses this authenticated-write pattern). Logto RBAC and instant map-pin refresh on status
  change are deferred.
