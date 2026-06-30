# Leaderboard (#117) — design

**Status:** approved design (owner-approved 2026-06-29), pending Codex spec/plan review.
**Issue:** [#117](https://github.com/redducklabs/fountainrank/issues/117) — "(web + mobile) Leaderboard:
tap the on-map points display to view rankings."
**Behavior source:** `docs/specs/2026-06-29-ui-refresh-pins-ratings-splash-design.md` Item 4
(behavior approved; this spec adds the implementation + UX decisions the ticket deferred).

---

## 1. Goal

Make the on-map points display tappable on **web and mobile**, navigating to a **Leaderboard**
screen that ranks contributors by **total points** (default), scoped **global** or to a
**region**, with an optional sort by one **major point-origination category**. The signed-in
caller can always see **where they stand**.

## 2. What already exists (no rework)

- `GET /api/v1/leaderboard/contributors` (`backend/app/routers/leaderboard.py`): global by
  `UserContributionStats.total_points` (excludes zero-point users, #119); local (in-area) by
  summed `ContributionEvent.points` within `ST_DWithin(near_lat, near_lng, radius_m)`. Public.
- `UserContributionStats` already denormalizes all six major counters: `fountains_added`,
  `ratings_count`, `attributes_count`, `conditions_reported`, `verifications_count`,
  `notes_count` (kept in sync by `record_contributions` / `reverse_contributions`).
- `get_optional_user` (`backend/app/auth.py`): resolves the caller when credentials are present,
  returns `None` for anonymous, and still hard-401s a present-but-invalid bearer.
- Entry-point widgets already render: web `PointsBadge` (`web/components/map/MapStates.tsx`,
  mounted in `MapBrowser.tsx` for signed-in users); mobile `PointsChip`
  (`mobile/app/(tabs)/index.tsx`, top-right). Neither is tappable yet. *(The issue text says
  mobile has no on-map points display — it does; the work is making it tappable.)*
- **No code consumes the leaderboard endpoint yet** (verified) — so its response shape may be
  reshaped freely; only our own backend tests assert the current shape and will be updated.

## 3. Owner-approved decisions

1. **Region = "where the map is looking."** On opening the leaderboard we capture the map's
   current **center** and offer a **Global / Near here** choice; "Near here" ranks contributors
   around that center using the existing in-area mode (default radius
   `settings.leaderboard_local_radius_m`). No new location permission.
2. **Your rank, always.** Highlight the caller's row when it's in the visible top-N, **and** show
   a pinned **"You — #N"** row when they fall below the cut (or "not yet ranked" when they have
   no qualifying points in the active scope/category).
3. **Category sort shows the count as the primary metric**, with total points secondary.
4. **Web uses a full-page `/leaderboard` route** (server-rendered, shareable URL, simplest),
   not the intercepting-modal pattern. Trade-off accepted: returning to the map remounts it
   (re-geolocate + reload pins). The intercept-modal is a possible later enhancement.

## 4. Key simplification — count-order ≡ points-order for the current categories

**Scoped claim (not a general law):** for each of the six *currently selectable* major categories,
the category maps to exactly **one** `ContributionEvent.event_type`, and that event type has a
single **fixed, positive** point value (`POINTS` in `app/contributions.py`: `add_fountain=10`,
`rate=2`, `verify_working=3`, `report_condition=2`, `observe_attribute=2`, `add_note=2`). While
that holds, a user's category **points** = category **count** × (the fixed value), so ranking a
category by **count** and by **points** produce the **identical order**.

`POINTS` is documented as tunable, and bonus events are point-bearing yet absent from
`_STAT_COUNTER`, so this equivalence is **not** guaranteed for a future variable-value event.
Therefore we:
- **rank category boards by count** (global: the denormalized counter; local: `COUNT(*) FILTER`)
  and **display the count** (the intuitive number);
- add a **guardrail test** asserting every `_CATEGORY` entry maps to a real `_STAT_COUNTER` event
  type with the expected counter column and `POINTS[event_type] > 0`. If a future change breaks
  the one-event-type / fixed-positive-value assumption, that test fails loudly and forces this
  design to be revisited (e.g. maintaining per-category point counters).

Consequence today: the **global** category board sorts on the already-denormalized counter in
`UserContributionStats` (no event-log scan); only the **local** board scans `contribution_events`.

## 5. Backend — extend `GET /api/v1/leaderboard/contributors`

### 5.1 Request

| Param | Type | Notes |
|---|---|---|
| `limit` | int 1..100, default 20 | unchanged |
| `near_lat`,`near_lng` | float, optional, paired | unchanged; both-or-neither (422) |
| `radius_m` | float >0, optional | unchanged; capped at `nearby_max_radius_m` |
| `sort` | enum, default `total` | **new**: `total \| fountains \| ratings \| verifications \| conditions \| attributes \| notes` |

Auth: add `user: User | None = Depends(get_optional_user)` — the endpoint **stays public**; auth
only enriches the response with `you`. An invalid bearer still 401s (delegated behavior).

**Category map** (`sort` value → (stats counter column, `ContributionEvent.event_type`)):

| `sort` | counter column | event_type |
|---|---|---|
| `fountains` | `fountains_added` | `add_fountain` |
| `ratings` | `ratings_count` | `rate` |
| `verifications` | `verifications_count` | `verify_working` |
| `conditions` | `conditions_reported` | `report_condition` |
| `attributes` | `attributes_count` | `observe_attribute` |
| `notes` | `notes_count` | `add_note` |

Bonus events (`first_fountain_bonus`, `first_in_area_bonus`, `first_rating_bonus`) are **never**
selectable as a category. They still count toward **total** points (they are legitimate points).

### 5.2 Response (shape change: list → object)

```python
class ContributorRow(BaseModel):
    rank: int                      # 1-based ordinal position in the active board
    display_name: str              # via public_display_name (never the raw subject)
    points: int                    # total points in scope (global total_points OR in-area sum)
    category_count: int | None = None   # the sorted category's count; null when sort=total
    is_you: bool = False           # true for the caller's own row when it is in `rows`

class YourStanding(BaseModel):
    rank: int | None               # null = signed in but unranked in this scope/category
    points: int
    category_count: int | None = None

class LeaderboardOut(BaseModel):
    rows: list[ContributorRow]
    you: YourStanding | None = None   # null when the caller is anonymous
```

The two old fields (`fountains_added`, `ratings_count`) on `ContributorRow` are **removed** —
generalized into `category_count`.

**This is an intentional, breaking response-shape change** (bare list → object; field removal),
taken deliberately because the endpoint has **no production consumer yet**. The plan requires an
explicit `rg` audit (over `web/`, `mobile/`, `packages/`, `docs/`, and the generated schema) to
confirm that before implementing, and updates the backend OpenAPI contract test to assert the new
shape (`LeaderboardOut` + `YourStanding`). The default **total** board intentionally shows only
rank + name + total points; per-category context appears when the user sorts by a category
(`category_count`). A signed-in user's own per-category counters remain available elsewhere (the
account/contributions surface via `/me/contributions` + badges) — the leaderboard's job is ranking,
not a per-user stat dump; the audit step verifies those counters are still surfaced there.

`points` is **always the user's total points in scope** (global `total_points`, or the in-area sum
— and it can include bonus events). The UI labels it as *total points* and **never** as "category
points"; the category metric is `category_count`, labeled with the category (e.g. "42 fountains").

### 5.3 Ranking semantics (precise)

Total order on every board: **active-metric DESC, then `user_id` ASC** (deterministic, matching
the existing tie-break). `rank` on each row is its **ordinal position** in that order (1,2,3,…);
this is the simple list numbering users expect, not competition ranking with shared ranks.

- **Global, `sort=total`**: from `user_contribution_stats`, `WHERE total_points > 0`,
  `ORDER BY total_points DESC, user_id ASC LIMIT :limit`. `points=total_points`,
  `category_count=null`.
- **Global, `sort=<category>`**: same table, `WHERE <counter> > 0`,
  `ORDER BY <counter> DESC, user_id ASC LIMIT :limit`. `points=total_points` (secondary context),
  `category_count=<counter>`.
- **Local** (`sort=total` or category): build **one** per-user in-area aggregate in a single
  statement so `rows` and `you` derive from the *same* `ST_DWithin` scan — no second scan, no
  cross-execution race:

  ```sql
  WITH base AS (                        -- every in-area contributor, scanned once
    SELECT user_id,
           SUM(points)                                  AS points,        -- ALL awarded types
           COUNT(*) FILTER (WHERE event_type = :etype)  AS category_count -- category mode only
    FROM contribution_events
    WHERE status = 'awarded'
      AND ST_DWithin(location, :point, :radius)
    GROUP BY user_id
  ),
  ranked AS (                           -- only users with a positive ACTIVE metric are ranked
    SELECT *, ROW_NUMBER() OVER (ORDER BY <active_metric> DESC, user_id ASC) AS rn
    FROM base
    WHERE <active_metric> > 0           -- total: points > 0 ; category: category_count > 0
  )
  ```
  `<active_metric>` = `points` for `sort=total`, else `category_count`. `rows` = `ranked` joined to
  `users`, `WHERE rn <= :limit`, ordered by `rn`; `rank = rn`, `points = base.points`,
  `category_count = base.category_count` (null in total mode). Because `base` is **not** filtered by
  the active metric, a caller who is unranked in a category still has a defined `base.points` for
  `you` (see §5.4).

NULL-location events are excluded in local mode (ST_DWithin already does this). Reversed events
are excluded everywhere (`status='awarded'` filter), so a reversed contributor drops off — same
invariant as #119.

### 5.4 `you` (caller's standing)

Computed only when `get_optional_user` returns a user, in the **same scope + sort**:

- **Global, exact predicate.** Let `mine` = the caller's active metric (`total_points` for
  `sort=total`, else the category counter) and `:caller_id` = the caller's `user_id`.
  - If the caller has no stats row **or** `mine = 0` → `you.rank = null` ("not yet ranked");
    `points = total_points` (0 if no row), `category_count` = the counter (0) in category mode.
  - Else
    ```sql
    SELECT count(*) + 1 FROM user_contribution_stats
    WHERE <metric_col> > 0
      AND (<metric_col> > :mine OR (<metric_col> = :mine AND user_id < :caller_id))
    ```
    where `<metric_col>` = `total_points` (total) or the category counter. The **`<metric_col> > 0`
    guard is required**: it stops zero-metric users with a smaller `user_id` from being counted
    ahead, and stops an unranked caller from ever receiving a non-null rank. This count equals the
    caller's ordinal position, consistent with the in-list `rank`.
- **Local, exact.** From the `base`/`ranked` CTEs in §5.3 (one scan):
  - `you.rank` = the caller's `ranked.rn` if the caller is in `ranked`, else `null`.
  - `you.points` = the caller's `base.points` (their **total** in-area sum — defined even when the
    caller is unranked in a category, because `base` is not filtered by the active metric); `0`
    when the caller has no in-area events at all.
  - `you.category_count` = the caller's `base.category_count` in category mode (may be `0`).
- `is_you` is set on the caller's in-list row when present. The client pins the `you` row **only**
  when no in-list row has `is_you` (the caller is below the cut). `you` is still returned when the
  caller is in-list (harmless) — the client shows the highlight instead of a duplicate pin.

### 5.5 Validation & errors

- Unknown `sort` → FastAPI 422 (enum-typed param).
- `near_lat`/`near_lng` unpaired → 422 (existing check).
- All existing validations (limit range, negative radius) unchanged.

### 5.6 Logging

One structured `INFO` on a successful response, in the repo's style —
`logger.info("leaderboard served", extra={"scope": "global"|"local", "sort": ..., "limit": ...,
"rows": <n>, "you_resolved": <bool>})`. The per-request correlation id comes from the existing
request-id middleware/filter (not logged manually here). **Never** log display names, user ids,
subjects, bearer/JWT material, or raw coordinates. A 422 is FastAPI's own validation response — no
extra log. A 500 still surfaces via the centralized handler with a stack trace (existing behavior).

## 6. Web — `/leaderboard`

### 6.1 Entry point

`PointsBadge` becomes a real Next `<Link>`. To avoid a **stale center**, `MapBrowser` tracks the
latest map center in a ref/state updated on the map's `moveend` (and after the initial geolocate),
and passes a computed `href` to the badge: `/leaderboard?lat=<lat>&lng=<lng>` once a center is
known, or `/leaderboard` (global only) before the map is ready / when WebGL is unavailable. A
live-updated `<Link href>` (not a static href, and not a click handler that reads `mapRef` only at
navigation time) stays both **current** and right-clickable/prefetchable. Accessibility: focusable,
`aria-label` *"View leaderboard — N points"*, visible focus ring, hover affordance.

### 6.2 Page (server component + searchParams)

`web/app/leaderboard/page.tsx` reads `scope` (`global`|`near`), `lat`, `lng`, `sort` from
`searchParams` and fetches server-side, **with the caller's session when present** (so `you`
resolves) and anonymously otherwise. Data flow mirrors the existing `lib/server` authed-client
pattern; add a small `lib/server/leaderboard.ts` fetch helper + a public type. Controls are
plain `<Link>`s that flip query params (no client state machine):

- **Scope toggle**: `Global` / `Near here` (the latter present only when `lat`/`lng` are in the
  URL; it adds `scope=near`).
- **Category chips**: `Total` (default) · `Fountains` · `Ratings` · `Verifications` ·
  `Conditions` · `Attributes` · `Notes` — each a link setting `sort`.

List: numbered rows (`#rank`, display name, **primary metric** = `category_count` in category
mode else `points`, secondary = the other), the caller's row highlighted, and a pinned
**You — #N · …** row when `you` is below the cut (or "Not yet ranked"). Empty state:
"No contributors yet." A back link returns to `/`.

### 6.3 Style guide

`docs/style-guide.md` gains: the **PointsBadge-as-link** interactive states, the **leaderboard
list row** (rank, name, metrics, you-highlight, pinned-you variant), and the **segmented scope
toggle + category chip** control.

## 7. Mobile — `mobile/app/leaderboard.tsx`

### 7.1 Entry point

`PointsChip` (already on the map) becomes a `Pressable`. When the screen's `region` is known it
pushes `{ pathname: "/leaderboard", params: { lat, lng } }` using the region center; when `region`
is still null (initial load) it pushes `/leaderboard` with **no** params (global only) — never
stale/zero coordinates. a11y role `button`, label *"View leaderboard — N points"*.

### 7.2 Screen

A stack route outside `(tabs)` (pushed over the map) with a native back/close. Uses the typed
`useApi()` client + react-query (the client carries auth, so `you` resolves). Controls: a
segmented **Global / Near here** + a horizontally-scrollable category chip row, mirroring web.
A `FlatList` of rows with the same content + you-highlight + pinned-you row. Reuses theme tokens
(`colors`, `spacing`, `typography`).

## 8. API client regeneration

The OpenAPI types feed `@fountainrank/api-client`, consumed by web + mobile. After the backend
change, regenerate the client (the repo's existing generate step) so both apps typecheck against
`LeaderboardOut`/`ContributorRow`/`YourStanding`. The full `./run.ps1 check` covers the
cross-workspace contract.

## 9. Testing

- **Backend (pytest, fully verifiable here):**
  - *Boards:* global total (order + `user_id ASC` tie-break + zero-exclusion preserved); each
    global category (order by counter, zero-in-category excluded, `category_count` populated,
    `points` = `total_points`); local total (in-area sum, reversed + NULL-location excluded);
    local category (`COUNT FILTER`, `points` = in-area total over all types); **local category
    tie-break** where two users share a `category_count` but differ in total in-area points →
    order by `user_id ASC`, **not** points (guards against an accidental `points DESC` tiebreak);
    subject masking preserved (`public_display_name`).
  - *`you`:* authed and **in** top-N (`is_you` set on the row, `you.rank` = its position); authed
    and **below** top-N (no `is_you` row, `you.rank` correct via the count predicate); authed but
    **unranked in category** while holding points elsewhere (`you.rank = null`, `you.points` still
    > 0); authed and **total-unranked** (all reversed → `you.rank = null`); a **zero-metric user
    with a smaller `user_id`** must not shift a ranked caller's rank; **anonymous** (`you = null`).
  - *Optional-auth security:* malformed / non-`Bearer` `Authorization` → 401; **invalid bearer →
    401 even with `dev_auth_enabled=True` and `X-Dev-User` present** (never silently downgraded to
    anonymous) — mirror the existing Logto invalid-bearer seam tests. Override
    `get_optional_user` (per `test_fountains_detail.py`) for the authed `you` cases.
  - *Guardrail:* assert every `_CATEGORY` entry maps to a real `_STAT_COUNTER` event type with the
    expected counter column and `POINTS[event_type] > 0` (locks the §4 count-order assumption).
  - *Validation / shape:* unknown `sort` → 422; existing validations (limit, paired near, negative
    radius) still 422; **anonymous + empty DB → exactly `{"rows": [], "you": null}`**; signed-in +
    empty → `{"rows": [], "you": {rank: null, points: 0, …}}`. Update the **OpenAPI contract test**
    (`test_openapi.py`) to assert the 200 response references `LeaderboardOut` and components
    include `YourStanding`. Existing tests that read `.json()` as a list move to the `{rows, you}`
    shape.
- **Web (CI):** ESLint + Prettier + `tsc` + Vitest + `next build`; a unit test for the
  search-params → query mapping and the row primary/secondary metric selection. Owner visual pass.
- **Mobile (CI + device):** `tsc` + ESLint + Vitest for the param/query builder. Owner
  device-verifies the screen + tappable chip (mobile visual is owner-gated here).
- **Full mirror:** `./run.ps1 check` before the PR and before every push.

## 10. Security & standards

- Public endpoint; `you` requires a valid session via `get_optional_user` (invalid bearer still
  401s — never silently downgraded). Display names always go through `public_display_name`
  (raw subjects never leak — covered by a test).
- No schema/migration change (counters and `reversed` status already exist) → no Alembic drift.
- PostGIS ordering stays centralized in `app/geo.py` (`point_geography`), unchanged.
- No secrets, no `.env`, no AI attribution, no time estimates. New settings: none required
  (reuses `leaderboard_local_radius_m`, `nearby_max_radius_m`).

**Performance.** Global boards order `user_contribution_stats` (one row per contributing user) by
a counter with `LIMIT` and no dedicated index — identical to today's `total_points` board. This is
acceptable at current scale; if the table grows, partial/covering indexes on the hot sort columns
are a follow-up, not part of this change. Local boards reuse the existing in-area `ST_DWithin`
scan (GiST-indexed `location`); `you`'s local rank reuses that same scan (no second radius query).

## 11. Out of scope (per ticket)

Badges/achievements, time-window variants ("most helpful this month"), pagination beyond top-N,
and the web intercept-modal variant.

## 12. Delivery

One feature branch `feat/leaderboard-117` → one PR carrying backend + api-client + web + mobile +
spec/plan + style-guide. Branch → CI green → Codex `VERDICT: APPROVED` → every PR comment
addressed → squash-merge.

Deployment is a **separate, post-merge, owner-authorized release step** — not part of implementing
#117 (see plan Task 14). It is a CI-triggered `workflow_dispatch`
(`gh workflow run deploy.yml --ref main`, web+backend → DOKS), gated on `gh auth status`, and this
batched deploy also releases the merged-but-undeployed #119 anti-gaming fix.
