# Fountain browsing: city-list polish, my-fountains, and share — design

Design spec for GitHub issues **#169** (city fountain list: "See on Map" + visual
star ratings), **#170** (profile → "My rated water fountains" list), and **#168**
(fix web share + add mobile share). These three ship together as one branch/PR:
#169 and #170 share a list-row component and the map deep-link, and #168 is a small
adjacent fix on the same fountain-browsing surface.

## 1. Problem & scope

- **#169** — The city fountain list (`/drinking-fountains/[country]/[city]`) shows a
  bare numeric average and links every row only to the fountain detail page. Users
  can't jump from a listed fountain to its place on the map, and ratings are hard to
  scan. Add a per-row **"See on Map"** link that opens the main map centered on and
  highlighting that fountain, and render ratings as **stars**.
- **#170** — There is no way from the account page to see the fountains a user has
  contributed to. Add a **"My rated water fountains"** link on the account page and a
  new auth-gated page listing the fountains the signed-in user has contributed to,
  reusing the #169 row treatment.
- **#168** — The web fountain-detail **Share** button silently copies to clipboard on
  desktop (no `navigator.share`), so it appears to do nothing; give it visible
  feedback. Mobile fountain detail has **no** share button; add one.

**Out of scope (explicitly):** mobile "my rated fountains" list (web-only this batch —
a mobile follow-up can reuse the new endpoint); any change to how contributions are
recorded or pointed; photo/carousel (#167); web filter chips (#43).

**Platforms:** #169 web only (the city list is a web SEO page). #170 web only. #168
web (feedback) **and** mobile (new button).

## 2. #169 — City list: stars + "See on Map"

### 2.1 Visual star ratings

The city page already receives each fountain as a `FountainPin` (id, `location`,
`is_working`, `average_rating`, `rating_count`). A `Stars` component already exists
(`web/components/fountain/Stars.tsx`) and is used on the fountain-detail page; it is
**reused as-is** here — no new star rendering.

- When `average_rating` is a number: render `<Stars value={average_rating} />`
  followed by the rating count (`· N ratings`).
- When `average_rating` is `null` (unrated): `Stars` requires a number, so render a
  muted **"Not yet rated"** label instead of stars (no zero-star row).
- Accessibility: `Stars` already exposes `role="img"` + an `aria-label`
  (`Rated X out of 5`); the "Not yet rated" branch is plain text. This satisfies the
  #169 AC "remains accessible with text/ARIA context."

### 2.2 "See on Map" link

Each row gets a **"See on Map"** link whose href is:

```
/?flyto=<lng>,<lat>&focus=<fountain-id>
```

`lng`/`lat` come from the row's `location`. The main map lives at `/`. The `flyto`
param is the existing, validated map deep-link contract
(`web/lib/search/flyto.ts`: `flyto=lng,lat`); `focus` is a new param (§4) that tells
the map which fountain to highlight. Together they fly the camera to the fountain and
draw the selected halo on it.

### 2.3 Row restructure & shared component

Today each row is a single `<a>` wrapping the whole line. A "See on Map" link cannot
be nested inside another `<a>`, so the row is restructured into sibling links: the
fountain label links to `/fountains/[id]` (unchanged destination) and "See on Map"
links to the map deep-link, with the stars/rating between them.

Because #170 needs the same row, extract a reusable presentational component
**`FountainListRow`** (and a thin `FountainList` wrapper) under
`web/components/fountain/`. It takes a `FountainPin`-shaped item and renders the
detail link + stars/"Not yet rated" + "See on Map" link. The city page and the
my-fountains page both render it, guaranteeing the "behaves similarly to the city
list" AC in #170. The component is presentational only (no data fetching), so it is
unit-testable in isolation.

## 3. #170 — "My rated water fountains"

Per the confirmed scope, the list contains **every fountain the user has contributed
to** (added, rated, noted, or condition-reported) — "all contributions", not
rated-only — deduplicated to one row per fountain.

### 3.1 Backend: `GET /api/v1/me/fountains`

New endpoint on the existing users router (`backend/app/routers/users.py`), auth
required, caller's own data only (mirrors `/me/contributions`).

- **Source of truth:** `contribution_events`. Select `DISTINCT fountain_id` where
  `user_id = current_user.id` **AND** `status = 'awarded'` **AND**
  `fountain_id IS NOT NULL`. Awarded-only excludes reversed events (consistent with
  the stats/badges/leaderboard reads); `fountain_id` is nullable and `SET NULL` on a
  hard-deleted fountain, so the `IS NOT NULL` guard drops orphaned events.
- **Join to fountains, exclude hidden:** join the distinct ids to `fountains` and
  filter `is_hidden = false` so moderated-hidden fountains never surface.
- **Ordering:** **most-recent-contribution first** — order by the user's
  `MAX(contribution_events.created_at)` per fountain, descending; tie-break on
  `fountain.id` for determinism.
- **Serialization:** reuse the exact `FountainPin` shape the city list already uses
  (id, `location` via `latitude_of`/`longitude_of`, `is_working`, `average_rating`,
  `rating_count`, `current_status`, `last_verified_at`), so the web list reuses
  `FountainListRow` unchanged, including the `location` the "See on Map" link needs.
- **Response schema:** `MyFountainsOut { fountains: list[FountainPin] }` (a wrapper
  object, matching the `CityFountainsOut`/`MeContributionsOut` convention rather than
  a bare array, so the response can grow — e.g. a count — without a breaking change).
- **Empty state:** a user with no contributions returns `{ fountains: [] }` (200, not
  404).
- **Logging:** log the returned fountain count at INFO (no PII; user id only) so the
  path is diagnosable, per the logging standard.
- **Pagination:** none this iteration. A contributor's own list is expected to be
  small; if it grows we add `limit`/`offset` like the city endpoint. This cap is
  called out here so it is a deliberate decision, not an oversight.

### 3.2 Web: my-fountains page + account link

- **Page** `web/app/account/fountains/page.tsx` — server component, `force-dynamic`,
  auth-gated exactly like `web/app/account/page.tsx` (Logto context; unauthenticated
  → the same sign-in prompt). Fetches `/api/v1/me/fountains` with the authed API
  client and renders `FountainList`. Renders a friendly **empty state** ("You haven't
  added or rated any fountains yet") when the list is empty, and a graceful
  error state when the fetch fails (matching the account page's existing pattern).
- **Link** — add a **"My rated water fountains"** link on `web/app/account/page.tsx`
  (in the signed-in view) pointing to `/account/fountains`.
- **Route choice:** `/account/fountains` (nested under the existing account section)
  rather than a top-level `/my-fountains`, keeping account-scoped pages together.

## 4. Map: `focus` query param (powers "See on Map")

`web/components/map/MapBrowser.tsx` currently derives the selected fountain purely
from the path: `activeId = activeIdFromPath(pathname)` (matches `/fountains/[id]`),
and an effect sets the `selected-halo` / `selected-pin` MapLibre filters to that id.
Separately, a `flyto`/`bbox` effect moves the camera and then strips those two params.

Change: derive `activeId` from the new `focus` param **or** the path:

```ts
const activeId = searchParams.get("focus") ?? activeIdFromPath(pathname);
```

- The existing halo/pin effect then highlights the focused fountain with **no other
  change**; the existing `flyto` effect flies the camera. The halo appears once the
  pin loads from the post-fly bbox fetch.
- `focus` is **not** stripped (unlike `flyto`): keeping it in the URL makes the
  selection stable across the bbox reload and shareable, and it clears naturally when
  the user clicks another pin (a soft-nav to `/fountains/[id]`, which has no `focus`).
- **Security:** `focus` is only ever used as the right-hand side of a MapLibre
  `["==", ["get","id"], activeId]` filter expression — it is compared, never
  rendered as HTML or executed, so there is no injection surface. A malformed value
  simply matches no pin (no halo). No validation beyond the existing string handling
  is required; we do not fetch by it.

## 5. #168 — Share

### 5.1 Web — visible feedback (`web/components/fountain/ShareButton.tsx`)

The button already calls `navigator.share({ url })` and falls back to
`navigator.clipboard.writeText(url)`. The defect is that the clipboard path is
**silent**, so on desktop the button "does nothing" visibly. Fix:

- Native-share path (mobile web / supporting browsers): unchanged — open the share
  sheet; a user-cancel stays a no-op.
- Clipboard path: on success, show a transient **"Link copied!"** state on the button
  (swap the label for ~2s, then revert), so the action is visible. On clipboard
  failure, surface a brief "Couldn't copy" state rather than failing silently.
- Still shares `window.location.href` (the canonical fountain URL). Remains a client
  component. State is local (`useState` + a timeout cleared on unmount).

### 5.2 Mobile — new Share button (`mobile/components/fountain/FountainDetail.tsx`)

- Add a Share control to the mobile fountain-detail UI using React Native's
  `Share.share({ url })` (iOS) / `{ message }` (Android) with the fountain's **web**
  URL: `` `${webBaseUrl}/fountains/${id}` ``.
- **`webBaseUrl` config:** mobile config exposes `apiBaseUrl` but no web URL. Add a
  `webBaseUrl` field to the mobile config (`mobile/lib/config.ts` + `app.config.ts`
  `extra`), overridable via `EXPO_PUBLIC_WEB_BASE_URL`, defaulting to the production
  apex host `https://fountainrank.com`. Validate it HTTPS-only, matching the existing
  `apiBaseUrl` validation (and its test coverage in `mobile/lib/config.test.ts`).
- Styling follows the existing mobile detail controls; because this is a **new UI
  element**, document it in `docs/style-guide.md` per the style-guide rule.

## 6. Testing

- **Backend** (`backend/tests/`) — `GET /api/v1/me/fountains`: (a) returns the
  deduped set for a user with add + rate + note events on overlapping fountains
  (one row per fountain); (b) awarded-only (a reversed event does not surface);
  (c) excludes `is_hidden` fountains; (d) orders most-recent-contribution first;
  (e) 401 unauthenticated; (f) empty list → `{ fountains: [] }`.
- **Web** (`*.test.tsx` via Vitest) — `FountainListRow`: stars for a rated fountain,
  "Not yet rated" for `average_rating: null`, and the exact `See on Map` href
  (`/?flyto=<lng>,<lat>&focus=<id>`). `ShareButton`: with `navigator.share`
  undefined, clicking copies and shows the "Link copied!" state. `MapBrowser`:
  `activeId` prefers `focus` over the path (a focused pin is highlighted on `/`).
- **Mobile** (Vitest pure-helper suite) — the web-URL builder
  (`webBaseUrl` + id → `<host>/fountains/<id>`) and the `webBaseUrl` HTTPS-only config
  validation. The `Share.share` call site is thin; assert it is invoked with the
  built URL if the component is testable, otherwise cover the URL builder.
- All of `./run.ps1 check` (backend + web + mobile) green before the PR.

## 7. Security & standards

- **Auth:** `/me/fountains` requires a valid Logto-issued JWT (existing
  `get_current_user`); it returns only the caller's own contribution set — no user id
  is accepted from the client. No new auth surface, no dev-auth seam change.
- **No data exposure:** the endpoint returns the same public `FountainPin` fields the
  map/city list already expose; it does not leak other users' data or admin fields.
- **Logging:** structured, user id only (never PII); no secrets.
- **No new secrets/env values committed;** `EXPO_PUBLIC_WEB_BASE_URL` is a public,
  non-secret build var documented by name in `mobile/README.md`.
- **No migration:** no schema change (reads existing tables); nothing for
  `alembic check` to drift on.

## 8. Rollout

Single branch `feat/fountain-browsing-169-170-168` → CI green → Codex
`VERDICT: APPROVED` → all PR comments addressed → squash-merge → deploy from CI →
verify on production (city list stars + See-on-Map, account → my-fountains, web share
feedback; mobile share ships in the next mobile build). Close #169, #170, #168 on
merge/deploy. `#168` mobile button reaches users when the next mobile build is cut;
note this in the handoff.
