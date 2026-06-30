# Implementation plan — Leaderboard (#117)

**Spec:** `docs/specs/2026-06-29-leaderboard-design.md` (owner-approved; Codex-reviewed with this
plan). One feature branch `feat/leaderboard-117` → one PR (backend + api-client + web + mobile +
docs). Each task is independently testable; run the relevant local check after each, and the full
`./run.ps1 check` before the PR and before every push.

Order: **backend → regenerate api-client → web → mobile → docs/style-guide → full mirror → PR**.
Backend is fully verifiable here; web is code+CI (owner visual); mobile is code+CI (owner device).

---

## Task 0 — Confirm the breaking change is safe (consumer audit)

Before changing the response shape, run an `rg` audit to confirm nothing **calls** the current
contract:
`rg -n "leaderboard/contributors|ContributorRow|fountains_added|ratings_count" web mobile packages
docs`. **Expected result:** *no production caller* of `/leaderboard/contributors` in
`web/`/`mobile/`/`packages/` (`fountains_added`/`ratings_count` also appear on the unrelated
account/contributions surfaces — those are **not** leaderboard consumers and stay as-is). The
matches that DO appear and must be reconciled are **docs/generated**: `packages/api-client`
generated schema (regenerated in Task 6) and stale prose in
`docs/specs/2026-06-29-ui-refresh-pins-ratings-splash-design.md` (describes the old
`ContributorRow = display_name, points, fountains_added, ratings_count`) and
`docs/plans/2026-06-22-gamification-leaderboards.md` (old response) — reconciled in Task 12. List
the audit output in the PR description. If a real web/mobile **caller** turns up, stop and
reconcile before proceeding (spec §5.2).

**Verify:** audit output shows no production caller; the expected docs/generated matches are the
ones reconciled in Tasks 6/12.

## Task 1 — Backend: schemas

`backend/app/schemas.py`:
- Replace `ContributorRow` with: `rank:int`, `display_name:str`, `points:int`,
  `category_count:int|None=None`, `is_you:bool=False` (remove `fountains_added`/`ratings_count`).
- Add `YourStanding`: `rank:int|None`, `points:int`, `category_count:int|None=None`.
- Add `LeaderboardOut`: `rows:list[ContributorRow]`, `you:YourStanding|None=None`.

**Verify:** `ruff check` + import compiles (covered by Task 5 run).

## Task 2 — Backend: category map + sort enum

In `backend/app/routers/leaderboard.py` (keep the category mapping local to the router; it joins
two concerns — the `UserContributionStats` counter column and the `ContributionEvent.event_type`):
- Define `LeaderboardSort = Literal["total","fountains","ratings","verifications","conditions",
  "attributes","notes"]` and a `_CATEGORY: dict[str, tuple[InstrumentedAttribute, str]]` mapping
  each non-`total` value to `(UserContributionStats.<counter>, "<event_type>")`.
- Add `sort: LeaderboardSort = Query(default="total")` to the endpoint signature.

**Verify:** unknown `sort` → 422 (Task 5 test).

## Task 3 — Backend: query logic (global + local, total + category) + `you`

Rewrite the endpoint body (`backend/app/routers/leaderboard.py`), `response_model=LeaderboardOut`,
add `user: User | None = Depends(get_optional_user)`. Implement exactly per **spec §5.3–§5.4**:

- **Global total**: `user_contribution_stats`, `total_points>0`, order `total_points DESC,
  user_id ASC`, limit. `points=total_points`, `category_count=None`.
- **Global category**: same table, `<counter>>0`, order `<counter> DESC, user_id ASC`, limit.
  `points=total_points`, `category_count=<counter>`.
- **Local** (`near_lat`&`near_lng` set): the **single** `WITH base … , ranked …` statement from
  spec §5.3 — `base` aggregates ALL awarded in-area events per user (`SUM(points)` + a
  category `COUNT(*) FILTER`) in one `ST_DWithin` scan; `ranked` applies
  `ROW_NUMBER() OVER (ORDER BY <active_metric> DESC, user_id ASC)` over `base` filtered to
  `<active_metric> > 0`. `rows = ranked WHERE rn <= :limit` (so a below-cut caller is still
  rankable from the same result), `rank = rn`.
- **Rows**: set `is_you=True` on the caller's row (compare `user_id`);
  `display_name=public_display_name(display_name, logto_user_id)`.
- **`you`** (only when `user is not None`):
  - Global: read the caller's metric (`total_points` or `<counter>`); if no row or `mine=0` →
    `rank=None` (points/category_count from the row, 0 if absent); else
    `rank = SELECT count(*)+1 WHERE <metric_col> > 0 AND (<metric_col> > :mine OR (<metric_col> =
    :mine AND user_id < :caller_id))`. The `<metric_col> > 0` guard is **required** (spec §5.4).
  - Local: from the SAME `base`/`ranked` CTEs — `you.rank = ranked.rn` if the caller is in
    `ranked` else `None`; `you.points = base.points` (defined even when category-unranked because
    `base` is unfiltered); `you.category_count = base.category_count`.
- **Logging**: `logger.info("leaderboard served", extra={"scope": …, "sort": …, "limit": …,
  "rows": n, "you_resolved": bool})` — repo style; correlation id from existing middleware; never
  log names/ids/subjects/coords/bearer (spec §5.6).

**Verify:** Task 5.

## Task 4 — Backend: keep geo/auth centralized

No new geo math (reuse `point_geography`); no migration (counters + `reversed` status exist).
Confirm `alembic check` still reports no drift (Task 5 runs it).

## Task 5 — Backend: tests

Update `backend/tests/test_gamification_api.py` leaderboard cases to the `{rows, you}` shape and
add coverage (full list in spec §9):
- **Boards:** global total (order, `user_id ASC` tie-break, zero-exclusion, `rank` 1..n,
  `category_count` null); global category (≥2 of the six incl. one non-`fountains`: order by
  counter, zero-in-category excluded, `category_count` set, `points`=`total_points`); local total
  (in-area sum, reversed + NULL-location excluded); local category (`COUNT FILTER`, `points` =
  in-area total over all types); **local category tie-break** — two users with equal
  `category_count` but different total in-area points must order by `user_id ASC`, not points;
  subject masking preserved.
- **`you`:** authed + in top-N (`is_you` true on the row, `you.rank` = its position); authed +
  below top-N (no `is_you` row, `you.rank` correct); authed + unranked-in-category but holding
  points elsewhere (`you.rank` null, `you.points` > 0); authed + total-unranked / all-reversed
  (`you.rank` null); **a zero-metric user with a smaller `user_id` must not shift a ranked
  caller's rank**; anonymous (`you` null). Override `app.dependency_overrides[get_optional_user]`
  (mirror `test_fountains_detail.py`).
- **Optional-auth security:** malformed / non-`Bearer` header → 401; **invalid bearer → 401 even
  with `dev_auth_enabled=True` + `X-Dev-User` present** (no silent downgrade) — mirror the existing
  Logto invalid-bearer seam tests.
- **Guardrail:** assert each `_CATEGORY` entry maps to a real `_STAT_COUNTER` event type with the
  expected counter column and `POINTS[event_type] > 0`.
- **Validation / shape:** unknown `sort` → 422; existing 422s unchanged; **anonymous + empty →
  exactly `{"rows": [], "you": null}`**; signed-in + empty → `{"rows": [], "you": {rank: null,
  points: 0, …}}`.
- **OpenAPI contract** (`backend/tests/test_openapi.py`): update the existing `ContributorRow`
  assertion to assert the `/api/v1/leaderboard/contributors` 200 response references
  `LeaderboardOut` and components include `YourStanding` + the new `ContributorRow` shape.

**Verify:** `./run.ps1 check -Backend` green (ruff + format + alembic upgrade + `alembic check` no
drift + pytest).

## Task 6 — Regenerate the api-client

`./run.ps1 generate` (exports backend OpenAPI → `packages/api-client/openapi.json` →
`schema.d.ts`). Commit the regenerated artifacts.

**Verify:** `./run.ps1 check -ApiClient` green; `LeaderboardOut`/`YourStanding` present in
`schema.d.ts`.

## Task 7 — Web: leaderboard fetch helper + types

- `web/lib/leaderboard.ts`: a fetch helper (client-bundled, like `lib/fountains.ts`) taking the
  query (`scope`/lat/lng/sort/limit) + an optional viewer token; returns the typed
  `LeaderboardOut`. Map UI `scope=near` → `near_lat`/`near_lng` (+ default radius from the API).
- A pure mapper `searchParams → query` (+ the row primary/secondary metric selector) in a
  unit-testable module.

**Verify:** Task 11 web unit test.

## Task 8 — Web: `/leaderboard` page + controls

- `web/app/leaderboard/page.tsx` (server component): read `searchParams`; call
  `getViewerAccessToken()` (existing #65 pattern) → fetch via the helper (authed when a token
  exists, else anonymous). Render: header + back link to `/`; **Global/Near here** scope toggle
  (Near here only when lat/lng present) and **category chips**, both as `<Link>`s setting query
  params; numbered rows with you-highlight; pinned **You — #N** row from `you` when below the cut
  (or "Not yet ranked"); empty state.
- Components in `web/components/leaderboard/` (row, controls), following existing component style.

**Verify:** `./run.ps1 check -Web`.

## Task 9 — Web: make `PointsBadge` tappable

- `web/components/map/MapStates.tsx`: `PointsBadge` becomes a real Next `<Link>` taking an `href`
  prop (focusable, `aria-label` "View leaderboard — N points", focus ring + hover).
- `web/components/map/MapBrowser.tsx`: keep the latest center fresh — update a ref/state on the
  map's `moveend` (and after the initial geolocate) — and pass a computed `href`
  (`/leaderboard?lat=&lng=` once known, `/leaderboard` before the map is ready / WebGL absent).
  **Not** a static href and **not** a click-time `mapRef` read (spec §6.1).
- A pure `leaderboardHref(center | null)` helper + unit test (fresh center → query params; null →
  `/leaderboard` fallback).

**Verify:** `./run.ps1 check -Web` (incl. `next build`); update `app/page.test.tsx`/component
tests if they assert the badge.

## Task 10 — Mobile: leaderboard screen + tappable `PointsChip`

- `mobile/app/leaderboard.tsx`: a stack route (root `Stack`; set its own header via
  `<Stack.Screen>`); react-query via `useApi()`; **Global/Near here** segmented control +
  scrollable category chips; `FlatList` rows with you-highlight + pinned-you row; theme tokens.
- A pure param/query builder in `mobile/lib/leaderboard/` for unit testing.
- `mobile/app/(tabs)/index.tsx`: wrap `PointsChip` in a `Pressable` → push `/leaderboard` with
  `{ lat, lng }` from the current `region` center **when `region` is known**, else push
  `/leaderboard` with no params (global) — never stale/zero coords (spec §7.1); a11y role button
  + label.

**Verify:** `./run.ps1 check -Mobile` (tsc + ESLint + Vitest + expo-doctor). Owner device-verifies.

## Task 11 — Tests for the JS mappers

- Web Vitest: `searchParams → query` mapping (global vs near, each sort) + primary/secondary
  metric selection.
- Mobile Vitest: the param/query builder (center → near params, sort passthrough, **missing region
  → global/no-params fallback**).

**Verify:** `./run.ps1 check -Web` + `-Mobile`.

## Task 12 — Docs: style guide

`docs/style-guide.md`: document PointsBadge-as-link states, the leaderboard list row (incl.
you-highlight + pinned-you), and the scope toggle + category chips.

Also reconcile stale leaderboard-contract prose so the repo stays single-sourced (Codex review-2):
add a one-line supersession note to `docs/specs/2026-06-29-ui-refresh-pins-ratings-splash-design.md`
(Item 4 / the `ContributorRow = …` line) and `docs/plans/2026-06-22-gamification-leaderboards.md`
pointing at `docs/specs/2026-06-29-leaderboard-design.md` as the authoritative endpoint shape.

## Task 13 — Full mirror + PR

- `./run.ps1 check` (backend + workspace-js + web build + mobile) green.
- Open the PR (`feat/leaderboard-117`), body references #117 + the spec/plan. Get CI green.
- **Codex PR review loop** (`claude_help/codex-review-process.md`) until `VERDICT: APPROVED`;
  address every PR comment (Codex/Copilot/Dependabot/human). Re-run the mirror after any change.
- Squash-merge once CI green + Codex approved + all comments addressed.

## Task 14 — Post-merge release step (batched deploy, ships #119 too)

**Not part of implementing #117** — a separate, owner-authorized release step (the owner explicitly
asked to deploy this in-session). It is a CI-triggered `workflow_dispatch`, not a local
cluster/Terraform mutation, so it conforms to the IaC rules. Verify `gh auth status` first
(`claude_help/github-cli.md`), then `gh workflow run deploy.yml --ref main` (web+backend → DOKS) and
**monitor the run to success**. This batched deploy also releases the merged-but-undeployed #119
anti-gaming fix. (Mobile store release is separate — `mobile-store-release.yml` — and stays the
owner's call.)

---

## Risks / watch-list

- **Response shape change** (list → object) breaks current leaderboard tests — Task 5 updates them;
  no external consumer exists.
- **Local `you` rank** needs a window over the in-area CTE — keep it the *same* scan as `rows`
  (don't add a second radius scan).
- **api-client drift** — forgetting Task 6 makes web/mobile typecheck fail in CI; the full mirror
  catches it before the PR.
- **a11y** — the badge/chip become interactive; give them roles, labels, and visible focus.
