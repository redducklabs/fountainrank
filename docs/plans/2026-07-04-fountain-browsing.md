# Fountain browsing (#169, #170, #168) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "See on Map" links + visual star ratings to the city fountain list (#169), a
"My rated water fountains" account page backed by a new `/me/fountains` endpoint (#170), and
fix/extend the fountain Share action on web + mobile (#168).

**Architecture:** A new presentational `FountainListRow`/`FountainList` (web) renders a
`FountainPin`-shaped item as a detail link + stars (reusing the existing `Stars` component) +
a "See on Map" deep-link (`/?flyto=<lng>,<lat>&focus=<id>`). `MapBrowser` gains a `focus` query
param that highlights a fountain. A new auth-gated backend endpoint `GET /api/v1/me/fountains`
returns the deduped set of fountains a user has contributed to (awarded events, non-hidden,
recent-first), serialized as `FountainPin`. The web share button gains visible copy feedback;
mobile gains a Share button using a new `webBaseUrl` config value.

**Tech Stack:** FastAPI + SQLAlchemy 2 async (backend); Next.js 16 App Router + React 19 +
Vitest/@testing-library (web); Expo/React Native + Vitest pure-helper suite (mobile).

## Global Constraints

- Spec: `docs/specs/2026-07-04-fountain-browsing-design.md` — the source of truth. Read it first.
- Conventional Commits; frequent commits; one branch `feat/fountain-browsing-169-170-168`; one PR;
  squash-merge. **No AI attribution**; **no time estimates**.
- Windows host: file tools use **backslash** paths; the Bash tool is Git Bash (forward-slash,
  `/c/Repos/fountainrank/...`). Codex's WSL adapter sees the same files at `/mnt/c/Repos/...`.
- Local checks mirror CI: `./run.ps1 check` (backend + web + mobile). Backend needs the db
  container (`./run.ps1 up`). Run the **full** `check` before the PR and before every push.
- Backend change adds an endpoint → **regenerate `packages/api-client`** so web/mobile typings
  include `/api/v1/me/fountains`; the web page consumes the generated client.
- **No migration** — reads existing tables only; `alembic check` must stay drift-free (no drift
  because no model change).
- **Auth:** `/me/fountains` returns only the caller's own data; never accept a user id from the
  client. Structured logging, user id only, never PII/secrets.
- `EXPO_PUBLIC_WEB_BASE_URL` is a **public, non-secret** build var — document by name in
  `mobile/README.md`; never write a `.env`.

## File structure

**Backend (`backend/`)**
- `app/schemas.py` — add `MyFountainsOut { fountains: list[FountainPin] }`.
- `app/routers/users.py` — add `GET /api/v1/me/fountains`.
- `tests/test_me_fountains.py` (new) — endpoint tests.

**api-client (`packages/api-client/`)**
- Regenerated from the backend OpenAPI (adds the `/me/fountains` path + `MyFountainsOut`).

**Web (`web/`)**
- `components/fountain/FountainListRow.tsx` (new) + `FountainList.tsx` (new) — shared row/list.
- `components/fountain/FountainListRow.test.tsx` (new) — row unit tests.
- `app/drinking-fountains/[country]/[city]/page.tsx` — render `FountainList` instead of the
  inline `<li>`/`formatAverage` markup.
- `components/map/MapBrowser.tsx` — derive `activeId` from `focus` param or path.
- `components/map/MapBrowser.test.tsx` (new or existing) — `focus` → `activeId` test.
- `app/account/fountains/page.tsx` (new) — auth-gated my-fountains page.
- `app/account/page.tsx` — add "My rated water fountains" link.
- `components/fountain/ShareButton.tsx` — add visible copied/failed feedback.
- `components/fountain/ShareButton.test.tsx` (new) — clipboard-feedback test.
- `lib/fountain/see-on-map.ts` (new) + `.test.ts` — pure href builder (shared, testable).

**Mobile (`mobile/`)**
- `lib/config.ts` — add `webBaseUrl` (HTTPS-only) to the parsed config.
- `lib/config.test.ts` — `webBaseUrl` validation cases.
- `lib/share-url.ts` (new) + `lib/share-url.test.ts` (new) — pure `webBaseUrl`+id → URL builder.
- `app.config.ts` — expose `webBaseUrl` in `extra` from `EXPO_PUBLIC_WEB_BASE_URL`.
- `components/fountain/FountainDetail.tsx` — add the Share control.
- `README.md` — document `EXPO_PUBLIC_WEB_BASE_URL`.

**Docs**
- `docs/style-guide.md` — document the mobile Share button.

---

## Phase A — Backend `/me/fountains` (TDD)

### Task 1: `MyFountainsOut` schema

**Files:**
- Modify: `backend/app/schemas.py`

**Interfaces:**
- Produces: `MyFountainsOut(fountains: list[FountainPin])`.

- [ ] **Step 1:** Add the schema near `MeContributionsOut`:

```python
class MyFountainsOut(BaseModel):
    """Fountains the authenticated user has contributed to (#170).

    Deduped to one entry per fountain (any AWARDED contribution — add/rate/note/condition),
    non-hidden, most-recent-contribution first. Serialized as ``FountainPin`` so the web list
    reuses the city-list row (including ``location`` for the See-on-Map link)."""

    fountains: list[FountainPin]
```

- [ ] **Step 2:** Commit.

```bash
git add backend/app/schemas.py
git commit -m "feat: add MyFountainsOut schema (#170)"
```

### Task 2: `GET /api/v1/me/fountains` — failing test

**Files:**
- Test: `backend/tests/test_me_fountains.py` (new)

**Interfaces:**
- Consumes: existing test fixtures/helpers for an authed client + factories that create a
  fountain and record a contribution event (mirror `backend/tests/test_me_contributions.py`).
- Produces: `GET /api/v1/me/fountains` → `200 {"fountains": [FountainPin, ...]}`.

- [ ] **Step 1:** Read `backend/tests/test_me_contributions.py` to reuse its auth + factory
  setup verbatim (same fixtures, same user/token helper). Write the test file covering:
  dedup (add + rate on the same fountain → one row), awarded-only (a `reversed` event does not
  surface), excludes `is_hidden`, recent-first ordering (two fountains; the one with the newer
  event is first), 401 unauthenticated, empty → `{"fountains": []}`. Sketch:

```python
async def test_me_fountains_dedupes_and_orders_recent_first(authed_client, factories):
    f_old = await factories.fountain()
    f_new = await factories.fountain()
    await factories.contribution_event(fountain=f_old, event_type="add", status="awarded")
    await factories.contribution_event(fountain=f_old, event_type="rate", status="awarded")  # dup
    await factories.contribution_event(fountain=f_new, event_type="note", status="awarded")
    resp = await authed_client.get("/api/v1/me/fountains")
    assert resp.status_code == 200
    ids = [f["id"] for f in resp.json()["fountains"]]
    assert ids == [str(f_new.id), str(f_old.id)]  # recent-first, deduped

async def test_me_fountains_excludes_reversed_and_hidden(authed_client, factories):
    f_rev = await factories.fountain()
    f_hidden = await factories.fountain(is_hidden=True)
    await factories.contribution_event(fountain=f_rev, event_type="rate", status="reversed")
    await factories.contribution_event(fountain=f_hidden, event_type="rate", status="awarded")
    resp = await authed_client.get("/api/v1/me/fountains")
    assert resp.json()["fountains"] == []

async def test_me_fountains_requires_auth(client):
    assert (await client.get("/api/v1/me/fountains")).status_code == 401

async def test_me_fountains_empty(authed_client):
    resp = await authed_client.get("/api/v1/me/fountains")
    assert resp.status_code == 200 and resp.json() == {"fountains": []}
```

> Adjust factory/fixture names to whatever `test_me_contributions.py` actually uses.

- [ ] **Step 2:** Run to confirm it fails (route not found → 404):

Run: `./run.ps1 up` then `cd backend && pytest tests/test_me_fountains.py -v`
Expected: FAIL (404 / route missing).

### Task 3: Implement the endpoint

**Files:**
- Modify: `backend/app/routers/users.py`

**Interfaces:**
- Consumes: `ContributionEvent`, `Fountain`, `latitude_of`/`longitude_of` (same helpers
  `app/routers/places.py` uses), `FountainPin`, `Coordinates`, `MyFountainsOut`.

- [ ] **Step 1:** Add imports (`Fountain`, `ContributionEvent` already imported; add
  `MyFountainsOut`, `FountainPin`, `Coordinates`, and the geo column helpers used by
  `places.py` — confirm their import path, e.g. `from app.geo import latitude_of, longitude_of`).

- [ ] **Step 2:** Implement:

```python
@router.get("/me/fountains", response_model=MyFountainsOut)
async def get_my_fountains(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MyFountainsOut:
    # Auth-required, caller's own data only. Deduped fountains the user has an AWARDED
    # contribution to (add/rate/note/condition), non-hidden, most-recent-contribution first.
    last_touch = (
        select(
            ContributionEvent.fountain_id.label("fid"),
            func.max(ContributionEvent.created_at).label("last_at"),
        )
        .where(
            ContributionEvent.user_id == current_user.id,
            ContributionEvent.status == "awarded",
            ContributionEvent.fountain_id.is_not(None),
        )
        .group_by(ContributionEvent.fountain_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                Fountain.ranking_score,
                Fountain.current_status,
                Fountain.last_verified_at,
            )
            .join(last_touch, last_touch.c.fid == Fountain.id)
            .where(Fountain.is_hidden.is_(False))
            .order_by(last_touch.c.last_at.desc(), Fountain.id.asc())
        )
    ).all()
    fountains = [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            ranking_score=score,
            current_status=cur_status,
            last_verified_at=last_verified,
        )
        for (rid, rlat, rlng, working, avg, count, score, cur_status, last_verified) in rows
    ]
    logger.info(
        "my fountains served",
        extra={"user_id": str(current_user.id), "count": len(fountains)},
    )
    return MyFountainsOut(fountains=fountains)
```

- [ ] **Step 3:** Run the tests to green:

Run: `cd backend && pytest tests/test_me_fountains.py -v`
Expected: PASS (all cases).

- [ ] **Step 4:** Full backend mirror:

Run: `./run.ps1 check -Backend`
Expected: ruff + format + alembic upgrade + `alembic check` (no drift) + pytest all PASS.

- [ ] **Step 5:** Commit.

```bash
git add backend/app/routers/users.py backend/tests/test_me_fountains.py
git commit -m "feat: GET /me/fountains — user's contributed fountains (#170)"
```

### Task 4: Regenerate the API client

**Files:**
- Modify: `packages/api-client/**` (generated)

- [ ] **Step 1:** Regenerate from the backend OpenAPI:

Run: `./run.ps1 generate` (or the repo's client-gen task — confirm the exact command in
`run.ps1`/`packages/api-client/README`).
Expected: the generated types now include the `/api/v1/me/fountains` path and `MyFountainsOut`.

- [ ] **Step 2:** Verify the client typechecks:

Run: `./run.ps1 check -ApiClient`
Expected: ESLint + tsc + vitest PASS.

- [ ] **Step 3:** Commit.

```bash
git add packages/api-client
git commit -m "chore: regenerate api-client for /me/fountains (#170)"
```

---

## Phase B — Web shared list row + city page (#169)

### Task 5: `see-on-map` href builder (pure, TDD)

**Files:**
- Create: `web/lib/fountain/see-on-map.ts`, `web/lib/fountain/see-on-map.test.ts`

**Interfaces:**
- Produces: `seeOnMapHref({ id, lng, lat }): string` → `/?flyto=<lng>,<lat>&focus=<id>`.

- [ ] **Step 1:** Failing test:

```ts
import { describe, expect, it } from "vitest";
import { seeOnMapHref } from "./see-on-map";

describe("seeOnMapHref", () => {
  it("builds the flyto + focus deep link", () => {
    expect(seeOnMapHref({ id: "abc", lng: -122.42, lat: 37.77 })).toBe(
      "/?flyto=-122.42,37.77&focus=abc",
    );
  });
});
```

- [ ] **Step 2:** Run → FAIL. Run: `cd web && pnpm vitest run lib/fountain/see-on-map.test.ts`

- [ ] **Step 3:** Implement:

```ts
export function seeOnMapHref(f: { id: string; lng: number; lat: number }): string {
  return `/?flyto=${f.lng},${f.lat}&focus=${encodeURIComponent(f.id)}`;
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit (`feat: see-on-map href builder (#169)`).

### Task 6: `FountainListRow` + `FountainList` (TDD)

**Files:**
- Create: `web/components/fountain/FountainListRow.tsx`, `FountainList.tsx`,
  `FountainListRow.test.tsx`

**Interfaces:**
- Consumes: `Stars` (`web/components/fountain/Stars.tsx`), `seeOnMapHref`, the generated
  `FountainPin` type.
- Produces: `<FountainList fountains={FountainPin[]} />`, `<FountainListRow fountain={FountainPin} />`.

- [ ] **Step 1:** Failing test (`FountainListRow.test.tsx`) — rated shows stars + count and a
  correct See-on-Map href; unrated shows "Not yet rated" and no stars:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FountainListRow } from "./FountainListRow";

const base = {
  id: "f1",
  location: { latitude: 37.77, longitude: -122.42 },
  is_working: true,
  rating_count: 3,
  average_rating: 4.5,
} as const;

describe("FountainListRow", () => {
  it("renders stars, count, and a See on Map link for a rated fountain", () => {
    render(<FountainListRow fountain={base} />);
    expect(screen.getByRole("img", { name: /Rated 4.5 out of 5/ })).toBeInTheDocument();
    expect(screen.getByText(/3 ratings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See on Map/i })).toHaveAttribute(
      "href",
      "/?flyto=-122.42,37.77&focus=f1",
    );
  });

  it("shows 'Not yet rated' and no stars when unrated", () => {
    render(<FountainListRow fountain={{ ...base, average_rating: null, rating_count: 0 }} />);
    expect(screen.getByText(/Not yet rated/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL. Run: `cd web && pnpm vitest run components/fountain/FountainListRow.test.tsx`

- [ ] **Step 3:** Implement `FountainListRow.tsx` (presentational; match the city page's existing
  Tailwind classes so the look is unchanged apart from stars + the new link):

```tsx
import Link from "next/link";
import type { components } from "@fountainrank/api-client";
import { Stars } from "./Stars";
import { seeOnMapHref } from "../../lib/fountain/see-on-map";

type FountainPin = components["schemas"]["FountainPin"];

export function FountainListRow({ fountain: f }: { fountain: FountainPin }) {
  const href = seeOnMapHref({
    id: String(f.id),
    lng: f.location.longitude,
    lat: f.location.latitude,
  });
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <Link href={`/fountains/${f.id}`} className="text-[#0C44A0] underline">
        Drinking fountain{f.is_working ? "" : " · Out of order"}
      </Link>
      <span className="flex items-center gap-3 text-sm text-slate-500">
        {f.average_rating != null ? (
          <span className="flex items-center gap-1">
            <Stars value={f.average_rating} />
            {f.rating_count ? <span>· {f.rating_count} ratings</span> : null}
          </span>
        ) : (
          <span className="text-slate-400">Not yet rated</span>
        )}
        <Link href={href} className="text-[#0C44A0] underline">
          See on Map
        </Link>
      </span>
    </li>
  );
}
```

`FountainList.tsx`:

```tsx
import type { components } from "@fountainrank/api-client";
import { FountainListRow } from "./FountainListRow";

type FountainPin = components["schemas"]["FountainPin"];

export function FountainList({ fountains }: { fountains: FountainPin[] }) {
  return (
    <ul className="mt-6 divide-y divide-slate-100">
      {fountains.map((f) => (
        <FountainListRow key={String(f.id)} fountain={f} />
      ))}
    </ul>
  );
}
```

> Confirm the exact api-client import alias (`@fountainrank/api-client` vs a relative
> `lib/api` re-export) from how `web/app/.../city/page.tsx` currently imports `CityFountainsOut`,
> and match it.

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit (`feat: shared FountainList row with stars + See on Map (#169)`).

### Task 7: Use `FountainList` on the city page

**Files:**
- Modify: `web/app/drinking-fountains/[country]/[city]/page.tsx`

- [ ] **Step 1:** Replace the inline `<ul>…{fountains.map(<li><Link>…)}` block (and the
  `formatAverage` import if it becomes unused) with `<FountainList fountains={fountains} />`,
  keeping the surrounding heading/empty-state markup. Empty state (`fountains.length === 0`)
  stays the existing "No public fountains are mapped here yet." paragraph.

- [ ] **Step 2:** Web mirror:

Run: `./run.ps1 check -Web`
Expected: ESLint + Prettier + tsc + vitest + `next build` PASS.

- [ ] **Step 3:** Commit (`feat: city list uses FountainList (stars + See on Map) (#169)`).

---

## Phase C — Map `focus` param (#169)

### Task 8: `MapBrowser` highlights the `focus` fountain (TDD)

**Files:**
- Modify: `web/components/map/MapBrowser.tsx`
- Test: `web/components/map/MapBrowser.test.tsx` (extend if present, else a focused unit test on
  the `activeId` derivation — extract `resolveActiveId(focusParam, pathname)` to keep it pure and
  testable if `MapBrowser` is hard to render in jsdom).

**Interfaces:**
- Produces: `activeId = focus param ?? activeIdFromPath(pathname)`.

- [ ] **Step 1:** Add a pure helper next to `activeIdFromPath`:

```ts
export const resolveActiveId = (focus: string | null, pathname: string | null) =>
  focus ?? activeIdFromPath(pathname);
```

- [ ] **Step 2:** Failing test:

```ts
import { describe, expect, it } from "vitest";
import { resolveActiveId } from "./MapBrowser";

describe("resolveActiveId", () => {
  it("prefers the focus param over the path", () => {
    expect(resolveActiveId("f9", "/")).toBe("f9");
  });
  it("falls back to the path fountain id", () => {
    expect(resolveActiveId(null, "/fountains/f3")).toBe("f3");
  });
});
```

- [ ] **Step 3:** Run → FAIL, then wire it in `MapBrowser`:

```ts
const activeId = resolveActiveId(searchParams.get("focus"), pathname);
```

(remove the old `const activeId = activeIdFromPath(pathname);`).

- [ ] **Step 4:** Run → PASS. Web mirror `./run.ps1 check -Web` PASS.

- [ ] **Step 5:** Commit (`feat: MapBrowser highlights ?focus fountain for See on Map (#169)`).

---

## Phase D — My-fountains page + account link (#170)

### Task 9: `/account/fountains` page

**Files:**
- Create: `web/app/account/fountains/page.tsx`

**Interfaces:**
- Consumes: `getAuthedApiClient` + `getLogtoContext` (same as `web/app/account/page.tsx`),
  `FountainList`, the generated `/api/v1/me/fountains` client method.

- [ ] **Step 1:** Read `web/app/account/page.tsx` for the exact auth-gating + authed-client +
  error-handling pattern and mirror it. The page: `force-dynamic`; if unauthenticated render the
  same sign-in prompt; else GET `/api/v1/me/fountains`; on error render a graceful state; on
  success render `<FountainList fountains={data.fountains} />` under a heading
  ("Fountains you've added or rated"); when `data.fountains.length === 0` render an empty state
  ("You haven't added or rated any fountains yet.") with a link back to the map. Use `SiteHeader`
  like the city page. Log fetch failures via `web/lib/server/log`.

- [ ] **Step 2:** Web mirror `./run.ps1 check -Web` PASS.

- [ ] **Step 3:** Commit (`feat: /account/fountains — my rated fountains page (#170)`).

### Task 10: "My rated water fountains" link on the account page

**Files:**
- Modify: `web/app/account/page.tsx`

- [ ] **Step 1:** In the signed-in `return` (near `DisplayNameForm`/`SignOutButton`), add:

```tsx
<Link href="/account/fountains" className="text-sm font-semibold text-white underline">
  My rated water fountains
</Link>
```

(import `Link from "next/link"`). Keep it visible only in the authenticated view.

- [ ] **Step 2:** Web mirror `./run.ps1 check -Web` PASS.

- [ ] **Step 3:** Commit (`feat: account page links to my rated fountains (#170)`).

---

## Phase E — Web share feedback (#168)

### Task 11: `ShareButton` visible copy feedback (TDD)

**Files:**
- Modify: `web/components/fountain/ShareButton.tsx`
- Create: `web/components/fountain/ShareButton.test.tsx`

- [ ] **Step 1:** Failing test — with `navigator.share` undefined, clicking copies and shows
  "Link copied!":

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "./ShareButton";

describe("ShareButton", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies to clipboard and shows feedback when Web Share is unavailable", async () => {
    // @ts-expect-error force the clipboard fallback
    navigator.share = undefined;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareButton />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });
});
```

- [ ] **Step 2:** Run → FAIL. Run: `cd web && pnpm vitest run components/fountain/ShareButton.test.tsx`

- [ ] **Step 3:** Implement feedback state:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "copied" | "error";

export function ShareButton() {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (s: Status) => {
    setStatus(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2000);
  };

  const onClick = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        flash("copied");
      }
    } catch (err) {
      // A user-cancelled native share sheet is an AbortError — stay idle, not an error.
      if ((err as Error)?.name !== "AbortError") flash("error");
    }
  };

  const label =
    status === "copied" ? "Link copied!" : status === "error" ? "Couldn't copy" : "Share";
  return (
    <button
      onClick={onClick}
      aria-live="polite"
      className="rounded-full border border-[#cdd6e6] bg-white px-4 py-2 text-sm font-bold text-[#0A357E]"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 4:** Run → PASS. Web mirror `./run.ps1 check -Web` PASS.

- [ ] **Step 5:** Commit (`fix: web share button shows copy feedback (#168)`).

---

## Phase F — Mobile share (#168)

### Task 12: `webBaseUrl` config (TDD)

**Files:**
- Modify: `mobile/lib/config.ts`, `mobile/lib/config.test.ts`, `mobile/app.config.ts`,
  `mobile/README.md`

**Interfaces:**
- Produces: parsed config gains `webBaseUrl: string` (HTTPS-only).

- [ ] **Step 1:** Read `mobile/lib/config.ts` + `config.test.ts` for the exact `apiBaseUrl`
  validation shape and mirror it for `webBaseUrl` (required, HTTPS-only, rejects bare
  `https://`, rejects whitespace). Add test cases cloning the `apiBaseUrl` ones for `webBaseUrl`,
  plus a default value assertion if the parser applies one.

- [ ] **Step 2:** Run → FAIL. Run: `cd mobile && pnpm vitest run lib/config.test.ts`

- [ ] **Step 3:** Add `webBaseUrl` to the config type + parser (same validation helper as
  `apiBaseUrl`); in `app.config.ts` `extra`, add
  `webBaseUrl: process.env.EXPO_PUBLIC_WEB_BASE_URL ?? "https://fountainrank.com"`. Document
  `EXPO_PUBLIC_WEB_BASE_URL` in `mobile/README.md` next to the other `EXPO_PUBLIC_*` vars.

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit (`feat: mobile webBaseUrl config (#168)`).

### Task 13: `share-url` builder (TDD)

**Files:**
- Create: `mobile/lib/share-url.ts`, `mobile/lib/share-url.test.ts`

**Interfaces:**
- Produces: `fountainShareUrl(webBaseUrl: string, id: string): string`.

- [ ] **Step 1:** Failing test:

```ts
import { describe, expect, it } from "vitest";
import { fountainShareUrl } from "./share-url";

describe("fountainShareUrl", () => {
  it("joins base + fountain id without a double slash", () => {
    expect(fountainShareUrl("https://fountainrank.com", "f1")).toBe(
      "https://fountainrank.com/fountains/f1",
    );
    expect(fountainShareUrl("https://fountainrank.com/", "f1")).toBe(
      "https://fountainrank.com/fountains/f1",
    );
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement:

```ts
export function fountainShareUrl(webBaseUrl: string, id: string): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/fountains/${id}`;
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit (`feat: mobile fountain share-url builder (#168)`).

### Task 14: Mobile Share button

**Files:**
- Modify: `mobile/components/fountain/FountainDetail.tsx`
- Modify: `docs/style-guide.md`

**Interfaces:**
- Consumes: `Share` from `react-native`, `fountainShareUrl`, `webBaseUrl` from config
  (via the existing config/context the component can reach — confirm how `FountainDetail`
  obtains config; if it has no config access, thread `webBaseUrl` from the screen that renders it).

- [ ] **Step 1:** Read `mobile/components/fountain/FountainDetail.tsx` to find the header/action
  area and how it receives the fountain `id` + any config. Add a Share control (button/pressable
  consistent with existing controls) whose handler:

```tsx
import { Share } from "react-native";
import { fountainShareUrl } from "../../lib/share-url";
// ...
const onShare = () =>
  Share.share({ url: fountainShareUrl(webBaseUrl, String(fountain.id)) }).catch(() => {
    /* user dismissed the share sheet — no-op */
  });
```

- [ ] **Step 2:** Document the Share button in `docs/style-guide.md` (new UI element: placement,
  label/icon, behavior).

- [ ] **Step 3:** Mobile mirror:

Run: `./run.ps1 check -Mobile`
Expected: tsc + ESLint + vitest + expo-doctor PASS.

- [ ] **Step 4:** Commit (`feat: mobile fountain Share button (#168)`).

---

## Phase G — Final verification

### Task 15: Full CI mirror + style guide + issue references

**Files:** none (verification) — plus any fixups the mirror surfaces.

- [ ] **Step 1:** Full mirror:

Run: `./run.ps1 check`
Expected: backend + web + mobile all green. Fix anything red and re-run.

- [ ] **Step 2:** Confirm the working tree is clean apart from intended changes
  (`git status`), no `.env`/secrets, no `next build` artifacts left dirty.

- [ ] **Step 3:** Push the branch and open the PR (body references #169, #170, #168; notes the
  mobile Share button ships with the next mobile build). Then run Loop B (Codex PR review) per
  `claude_help/codex-review-process.md`.

## Testing summary

- Backend: `tests/test_me_fountains.py` — dedup, awarded-only, excludes hidden, recent-first,
  401, empty.
- Web: `see-on-map.test.ts`, `FountainListRow.test.tsx`, `MapBrowser` `resolveActiveId` test,
  `ShareButton.test.tsx`.
- Mobile: `config.test.ts` (`webBaseUrl`), `share-url.test.ts`.
- Full `./run.ps1 check` green before the PR and before every push.

## Self-review notes (coverage vs spec)

- Spec §2 (stars + See on Map) → Tasks 5–8. §3 (my-fountains + endpoint) → Tasks 1–4, 9–10.
  §4 (focus param) → Task 8. §5 (share) → Tasks 11–14. §6 (testing) → tests in each task.
  §7 (security/standards) → auth in Task 3, logging in Task 3, public env var in Task 12.
  §8 (rollout) → Task 15 + PR/deploy.
- No schema/migration; `alembic check` unaffected. api-client regen (Task 4) keeps the
  web/mobile type contract intact.
