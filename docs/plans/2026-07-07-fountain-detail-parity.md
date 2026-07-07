# Fountain Detail Parity Implementation Plan

> **For the implementing agent (Claude Code):** optionally drive this task-by-task with `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Not a repo requirement; steps use checkbox (`- [ ]`) syntax for tracking. This plan is self-contained without any such skill.

**Goal:** Give the native mobile fountain-detail screen the same Info/Details/Photos tabs as web, and add a single tappable "hero" photo (newest) to the top of the Info tab on both clients.

**Architecture:** Reuse web's existing tab architecture on mobile. A tabs component owns the active-tab state and exposes `setActive` through a React context so a `PhotoHero` rendered inside the Info body can switch to the Photos tab. All mobile tab bodies stay mounted (inactive ones hidden with `display:"none"`) to preserve form input and scroll. No backend changes.

**Tech Stack:** Next.js/React (web), Expo/React Native + `@tanstack/react-query` (mobile), Vitest both.

## Global Constraints

- Spec: `docs/specs/2026-07-07-fountain-detail-parity-design.md` — every task's requirements implicitly include it.
- Hero photo is `photos[0]` (backend `list_photos` orders `created_at desc`), shown only when `photos.length > 0`.
- Web hero MUST resolve the photo path with `resolveApiBaseUrl()` (`web/lib/api.ts`) — never raw `photo.url`. Mobile uses `resolvePhotoUrl(apiBaseUrl, path)` (`mobile/lib/detail/photo-carousel.ts`).
- Mobile: ALL three tab bodies stay mounted; hide inactive with `style={{ display: "none" }}`. Never conditionally render only the active body.
- Mobile a11y: tab buttons use `accessibilityRole="button"` + `accessibilityState={{ selected }}` + label. **Do NOT use `accessibilityRole="tab"` or `"tablist"` anywhere on mobile.** Hero: `accessibilityRole="button"`, label `See all N photos`.
- **Testing reality:** web has `@testing-library/react` (render tests OK). **Mobile has NO render-test harness** (no `@testing-library/react-native`; only pure-logic `.test.ts` under `mobile/lib`/co-located). Do NOT add RN render tests or new test deps — extract testable logic into pure functions and unit-test those; verify mobile components via `tsc --noEmit`, `expo-doctor`, and the emulator pass (Task 10).
- Local CI mirror (run from the repo root in PowerShell): `./run.ps1 check -Web` (eslint + prettier + typecheck + test + build), `./run.ps1 check -Mobile` (eslint + typecheck + vitest + expo-doctor), full `./run.ps1 check` before PR. Per-task quick typecheck: `pnpm --filter web exec tsc --noEmit` / `pnpm --filter mobile exec tsc --noEmit`.
- No AI attribution in commits/PRs. No time estimates. Conventional Commits. Frequent commits. Do NOT change any mutation/handler logic — only where forms render and the noted gates/refresh.

---

## File Structure

**Mobile pure logic (new, testable)**
- Create `mobile/lib/detail/fountain-detail.ts` — `heroPhoto`, `photosTabLabel`, `seeAllPhotosLabel`.
- Create `mobile/lib/detail/fountain-detail.test.ts`.

**Web**
- Modify `web/components/fountain/FountainDetailTabs.tsx` — export `useFountainDetailTabs()` (a context exposing `setActive`); wrap panels in the provider.
- Create `web/components/fountain/PhotoHero.tsx` (+ `PhotoHero.test.tsx`).
- Modify `web/components/fountain/FountainDetail.tsx` (+ `FountainDetail.test.tsx`) — render hero at top of the `primary` body.

**Mobile components (verified via typecheck + emulator)**
- Create `mobile/components/fountain/FountainDetailTabs.tsx` — segmented control + context; all bodies mounted; per-tab `ScrollView`.
- Create `mobile/components/fountain/PhotoHero.tsx` — hero image; tap → `setActive("photos")`.
- Modify `mobile/components/fountain/FountainDetail.tsx` — three tab bodies; three contribution props; move `PhotoCarousel` to Photos; hero on Info.
- Modify `mobile/app/fountains/[id].tsx` — three `ContributePanel`-wrapped contribution nodes (built in the `detailQuery.data` branch); remove `showMoreDetails` + toggle; change `attributeTypesQuery` gate; add photos to refresh; remove the outer `ScrollView`.

**Docs**
- Modify `docs/style-guide.md`.

---

## Task 1: Mobile pure helpers (`heroPhoto`, `photosTabLabel`, `seeAllPhotosLabel`)

**Files:**
- Create: `mobile/lib/detail/fountain-detail.ts`
- Test: `mobile/lib/detail/fountain-detail.test.ts`

**Interfaces:**
- Produces:
  - `heroPhoto(photos: PhotoOut[] | undefined): PhotoOut | null`
  - `photosTabLabel(count: number): string`
  - `seeAllPhotosLabel(count: number): string`

- [ ] **Step 1: Write the failing test**

`mobile/lib/detail/fountain-detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { heroPhoto, photosTabLabel, seeAllPhotosLabel } from "./fountain-detail";

const photo = (id: string) => ({
  id, url: `/api/v1/photos/${id}`, thumbnail_url: `/api/v1/photos/${id}/thumb`,
  width: 800, height: 600, uploaded_by: null, created_at: "2026-07-07T00:00:00Z", is_own: false,
});

describe("heroPhoto", () => {
  it("returns null for undefined or empty", () => {
    expect(heroPhoto(undefined)).toBeNull();
    expect(heroPhoto([])).toBeNull();
  });
  it("returns the newest (first) photo", () => {
    expect(heroPhoto([photo("a"), photo("b")])?.id).toBe("a");
  });
});

describe("photosTabLabel", () => {
  it("has no count when empty, a count otherwise", () => {
    expect(photosTabLabel(0)).toBe("Photos");
    expect(photosTabLabel(3)).toBe("Photos (3)");
  });
});

describe("seeAllPhotosLabel", () => {
  it("pluralizes correctly", () => {
    expect(seeAllPhotosLabel(1)).toBe("See all 1 photo");
    expect(seeAllPhotosLabel(2)).toBe("See all 2 photos");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter mobile exec vitest run lib/detail/fountain-detail.test.ts`
Expected: FAIL ("Cannot find module './fountain-detail'").

- [ ] **Step 3: Implement the helpers**

`mobile/lib/detail/fountain-detail.ts`:

```ts
import type { components } from "@fountainrank/api-client";

type PhotoOut = components["schemas"]["PhotoOut"];

/** The single hero photo for the Info tab: the newest one (the list is `created_at desc`),
 *  or null when there are none. Tolerates an undefined list (`photosQuery.data` before load). */
export function heroPhoto(photos: PhotoOut[] | undefined): PhotoOut | null {
  return photos && photos.length > 0 ? photos[0] : null;
}

/** Photos tab label — a count suffix only when non-empty (matches web `FountainDetail`). */
export function photosTabLabel(count: number): string {
  return count > 0 ? `Photos (${count})` : "Photos";
}

/** Accessible label for the Info hero (opens the full set on the Photos tab). */
export function seeAllPhotosLabel(count: number): string {
  return `See all ${count} photo${count === 1 ? "" : "s"}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter mobile exec vitest run lib/detail/fountain-detail.test.ts`
Expected: PASS (6 assertions across 3 suites).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/detail/fountain-detail.ts mobile/lib/detail/fountain-detail.test.ts
git commit -m "feat(mobile): add fountain-detail hero/label helpers"
```

---

## Task 2: Web — tabs context exposes `setActive`

**Files:**
- Modify: `web/components/fountain/FountainDetailTabs.tsx`

**Interfaces:**
- Produces: `export function useFountainDetailTabs(): { setActive: (id: FountainDetailTab["id"]) => void }` — throws if used outside the provider. (The context object itself is module-private; only the hook is exported.)

- [ ] **Step 1: Add the hook + provider**

In `web/components/fountain/FountainDetailTabs.tsx`, change the React import to include context hooks and add the context + hook:

```tsx
import { createContext, useContext, useId, useState } from "react";

const FountainDetailTabsContext = createContext<{
  setActive: (id: FountainDetailTab["id"]) => void;
} | null>(null);

/** Read the enclosing tabs controller — lets content inside a tab body (the Info
 *  `PhotoHero`) switch to another tab. Throws if used outside `FountainDetailTabs`. */
export function useFountainDetailTabs() {
  const ctx = useContext(FountainDetailTabsContext);
  if (!ctx) throw new Error("useFountainDetailTabs must be used within FountainDetailTabs");
  return ctx;
}
```

Wrap the returned JSX in the provider (so all panels can read it):

```tsx
  return (
    <FountainDetailTabsContext.Provider value={{ setActive }}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* existing tablist + panels unchanged */}
      </div>
    </FountainDetailTabsContext.Provider>
  );
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/components/fountain/FountainDetailTabs.tsx
git commit -m "feat(web): expose setActive from FountainDetailTabs via context"
```

---

## Task 3: Web — `PhotoHero` component

**Files:**
- Create: `web/components/fountain/PhotoHero.tsx`
- Test: `web/components/fountain/PhotoHero.test.tsx`

**Interfaces:**
- Consumes: `useFountainDetailTabs` (Task 2); `resolveApiBaseUrl` (`web/lib/api.ts`); `PhotoOut` (`web/lib/fountains`).
- Produces: `export function PhotoHero({ photos }: { photos: PhotoOut[] }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

`web/components/fountain/PhotoHero.test.tsx` — mock BOTH the api base and the tabs hook so `PhotoHero` never hits the throwing hook without a provider:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({ resolveApiBaseUrl: () => "http://api" }));
const setActive = vi.fn();
vi.mock("./FountainDetailTabs", () => ({ useFountainDetailTabs: () => ({ setActive }) }));

import { PhotoHero } from "./PhotoHero";

const photo = (id: string) => ({
  id, url: `/api/v1/photos/${id}`, thumbnail_url: `/api/v1/photos/${id}/thumb`,
  width: 800, height: 600, uploaded_by: null, created_at: "2026-07-07T00:00:00Z", is_own: false,
});

describe("PhotoHero (web)", () => {
  it("renders nothing when there are no photos", () => {
    const { container } = render(<PhotoHero photos={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders the newest photo with the resolved API url", () => {
    render(<PhotoHero photos={[photo("a"), photo("b")]} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("http://api/api/v1/photos/a");
  });
  it("switches to the Photos tab when activated", async () => {
    render(<PhotoHero photos={[photo("a")]} />);
    await userEvent.click(screen.getByRole("button", { name: /see all/i }));
    expect(setActive).toHaveBeenCalledWith("photos");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run components/fountain/PhotoHero.test.tsx`
Expected: FAIL ("Cannot find module './PhotoHero'").

- [ ] **Step 3: Implement `PhotoHero`**

`web/components/fountain/PhotoHero.tsx`:

```tsx
"use client";
import type { PhotoOut } from "../../lib/fountains";
import { resolveApiBaseUrl } from "../../lib/api";
import { useFountainDetailTabs } from "./FountainDetailTabs";

/** Single newest-photo hero at the top of the Info tab. Clicking it opens the Photos tab
 *  (the full set). Rendered only when at least one photo exists. `PhotoOut.url` is an
 *  API-relative gated path; resolve it against the API origin like `PhotoCarousel` does. */
export function PhotoHero({ photos }: { photos: PhotoOut[] }) {
  const { setActive } = useFountainDetailTabs();
  if (photos.length === 0) return null;
  const newest = photos[0];
  return (
    <button
      type="button"
      aria-label={`See all ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
      onClick={() => setActive("photos")}
      className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <img
        src={`${resolveApiBaseUrl()}${newest.url}`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run components/fountain/PhotoHero.test.tsx`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add web/components/fountain/PhotoHero.tsx web/components/fountain/PhotoHero.test.tsx
git commit -m "feat(web): add PhotoHero (Info tab newest-photo, opens Photos tab)"
```

---

## Task 4: Web — render `PhotoHero` at top of the Info tab

**Files:**
- Modify: `web/components/fountain/FountainDetail.tsx` (the `primary` node, ~lines 39-124)
- Test: `web/components/fountain/FountainDetail.test.tsx`

**Interfaces:**
- Consumes: `PhotoHero` (Task 3).

- [ ] **Step 1: Add failing tests**

The current `FountainDetail.test.tsx` has a `base` detail fixture and no photo helper. Add local `photo(id)` + a `propsWithPhotos(photos)` helper (mirroring the file's existing props shape — `detail`, `notes`, `photos`, `isAuthenticated`, etc.), then add:

```tsx
it("shows the newest photo as a hero at the top of the Info tab", () => {
  render(<FountainDetail {...propsWithPhotos([photo("a"), photo("b")])} />);
  expect(screen.getByRole("button", { name: /see all 2 photos/i })).toBeInTheDocument();
});

it("shows no hero on the Info tab when there are no photos", () => {
  render(<FountainDetail {...propsWithPhotos([])} />);
  expect(screen.queryByRole("button", { name: /see all/i })).not.toBeInTheDocument();
});

it("activating the hero switches to the Photos tab", async () => {
  render(<FountainDetail {...propsWithPhotos([photo("a")])} />);
  await userEvent.click(screen.getByRole("button", { name: /see all/i }));
  expect(screen.getByRole("tab", { name: /photos/i })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Run to verify the new ones fail**

Run: `pnpm --filter web exec vitest run components/fountain/FountainDetail.test.tsx`
Expected: FAIL (hero not rendered).

- [ ] **Step 3: Render the hero**

In `web/components/fountain/FountainDetail.tsx` add `import { PhotoHero } from "./PhotoHero";` and make `<PhotoHero photos={photos} />` the FIRST child of the `primary` node's outer `<div className="space-y-4">`, above the title `<div>`. (`photos` already defaults to `[]` in this component's props, so no undefined handling is needed here.)

- [ ] **Step 4: Run the web fountain suite**

Run: `pnpm --filter web exec vitest run components/fountain/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/fountain/FountainDetail.tsx web/components/fountain/FountainDetail.test.tsx
git commit -m "feat(web): show newest-photo hero at top of the Info tab"
```

---

## Task 5: Mobile — `FountainDetailTabs` (segmented control + context)

**Files:**
- Create: `mobile/components/fountain/FountainDetailTabs.tsx`

No render test (see Global Constraints). Verified via `tsc` + the emulator pass (Task 10). The `photosTabLabel` used by callers is already unit-tested (Task 1).

**Interfaces:**
- Produces:
  - `export type FountainDetailTabId = "info" | "details" | "photos";`
  - `export type FountainDetailTab = { id: FountainDetailTabId; label: string; content: React.ReactNode };`
  - `export function FountainDetailTabs({ tabs, refreshing, onRefresh }: { tabs: FountainDetailTab[]; refreshing?: boolean; onRefresh?: () => void }): JSX.Element`
  - `export function useFountainDetailTabs(): { setActive: (id: FountainDetailTabId) => void }` (throws outside provider).

- [ ] **Step 1: Implement the component**

`mobile/components/fountain/FountainDetailTabs.tsx`:

```tsx
import type React from "react";
import { createContext, useContext, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "../../theme";

export type FountainDetailTabId = "info" | "details" | "photos";
export type FountainDetailTab = { id: FountainDetailTabId; label: string; content: React.ReactNode };

const TabsContext = createContext<{ setActive: (id: FountainDetailTabId) => void } | null>(null);

/** Read the enclosing tabs controller so content inside a tab body (the Info `PhotoHero`)
 *  can switch to another tab. Throws if used outside `FountainDetailTabs`. */
export function useFountainDetailTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useFountainDetailTabs must be used within FountainDetailTabs");
  return ctx;
}

export function FountainDetailTabs({
  tabs,
  refreshing,
  onRefresh,
}: {
  tabs: FountainDetailTab[];
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [active, setActive] = useState<FountainDetailTabId>(tabs[0]?.id ?? "info");

  return (
    <TabsContext.Provider value={{ setActive }}>
      <View style={styles.wrap}>
        <View style={styles.tabBar}>
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${tab.label} tab`}
                onPress={() => setActive(tab.id)}
                style={[styles.tab, selected ? styles.tabSelected : null]}
              >
                <Text style={[styles.tabLabel, selected ? styles.tabLabelSelected : null]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {/* All bodies stay mounted; inactive ones hidden (display:none) so form input and
            scroll position survive a switch. Each body owns its own ScrollView. */}
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <ScrollView
              key={tab.id}
              style={selected ? styles.panel : styles.panelHidden}
              contentContainerStyle={styles.panelContent}
              refreshControl={
                onRefresh ? (
                  <RefreshControl
                    refreshing={Boolean(refreshing)}
                    onRefresh={onRefresh}
                    tintColor={colors.brandBlue}
                  />
                ) : undefined
              }
            >
              {tab.content}
            </ScrollView>
          );
        })}
      </View>
    </TabsContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderBottomColor: "transparent",
    borderBottomWidth: 2,
  },
  tabSelected: { borderBottomColor: colors.brandBlue },
  tabLabel: { ...typography.body, fontWeight: "700", color: colors.textMuted },
  tabLabelSelected: { color: colors.brandBlue },
  panel: { flex: 1 },
  panelHidden: { flex: 1, display: "none" },
  panelContent: { padding: spacing.md, gap: spacing.md },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/fountain/FountainDetailTabs.tsx
git commit -m "feat(mobile): FountainDetailTabs segmented control (mounted panels, tab context)"
```

---

## Task 6: Mobile — `PhotoHero`

**Files:**
- Create: `mobile/components/fountain/PhotoHero.tsx`

No render test; `heroPhoto`/`seeAllPhotosLabel` are unit-tested (Task 1). Verified via `tsc` + emulator.

**Interfaces:**
- Consumes: `useFountainDetailTabs` (Task 5); `heroPhoto`, `seeAllPhotosLabel` (Task 1); `resolvePhotoUrl` (`mobile/lib/detail/photo-carousel.ts`); `expo-image` `Image`; `PhotoOut`.
- Produces: `export function PhotoHero({ photos, apiBaseUrl }: { photos: PhotoOut[] | undefined; apiBaseUrl: string }): JSX.Element | null`.

- [ ] **Step 1: Implement `PhotoHero`**

`mobile/components/fountain/PhotoHero.tsx`:

```tsx
import type { components } from "@fountainrank/api-client";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { heroPhoto, seeAllPhotosLabel } from "../../lib/detail/fountain-detail";
import { resolvePhotoUrl } from "../../lib/detail/photo-carousel";
import { colors, spacing } from "../../theme";
import { useFountainDetailTabs } from "./FountainDetailTabs";

type PhotoOut = components["schemas"]["PhotoOut"];

const ASPECT_RATIO = 3 / 4; // height = width * ratio, matching PhotoCarousel's 4:3

/** Single newest-photo hero atop the Info tab; tapping opens the Photos tab. Rendered only
 *  when a photo exists. Uses the same API-base URL resolution as `PhotoCarousel`. Accepts an
 *  undefined list (`photosQuery.data` before load) and renders nothing. */
export function PhotoHero({
  photos,
  apiBaseUrl,
}: {
  photos: PhotoOut[] | undefined;
  apiBaseUrl: string;
}) {
  const { setActive } = useFountainDetailTabs();
  const newest = heroPhoto(photos);
  if (!newest) return null;
  const count = photos?.length ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={seeAllPhotosLabel(count)}
      onPress={() => setActive("photos")}
      style={styles.wrap}
    >
      <View style={styles.frame}>
        <Image
          source={{ uri: resolvePhotoUrl(apiBaseUrl, newest.url) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  frame: {
    width: "100%",
    aspectRatio: 1 / ASPECT_RATIO,
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: "hidden",
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/fountain/PhotoHero.tsx
git commit -m "feat(mobile): add PhotoHero (Info tab newest-photo, opens Photos tab)"
```

---

## Task 7: Mobile — restructure `FountainDetail` into three tab bodies

**Files:**
- Modify: `mobile/components/fountain/FountainDetail.tsx`
- Test: none new (helpers already tested; component verified via `tsc` + emulator).

**Interfaces:**
- Consumes: `FountainDetailTabs`, `PhotoHero` (Tasks 5–6); `heroPhoto`/`photosTabLabel` (Task 1).
- Produces (new `FountainDetail` prop shape): remove `contribution?: React.ReactNode`; add `infoContribution?: React.ReactNode`, `detailsContribution?: React.ReactNode`, `photosContribution?: React.ReactNode`, `refreshing?: boolean`, `onRefresh?: () => void`. All other props unchanged. Keep `photos?: PhotoOut[]`.

- [ ] **Step 1: Normalize photos + build the three tab bodies**

At the top of the component body add `const resolvedPhotos = photos ?? [];` and use `resolvedPhotos` everywhere below (hero, carousel, label, empty state). Import `FountainDetailTabs`, `PhotoHero`, and `photosTabLabel`.

Compose three `content` nodes by MOVING the existing JSX blocks (do not rewrite them):

- **Info body** (`<View style={{ gap: spacing.md }}>`): `<PhotoHero photos={resolvedPhotos} apiBaseUrl={apiBaseUrl} />` → the existing header block (title + `StatusBlock`) → the rating hero row → the dimensions block → `{infoContribution}` → the existing Directions/Share `actions` row.
- **Details body**: the existing `AttributeList` → context-comment card → the `notesError`/`NotesList` block → `{adminControls}` → `{detailsContribution}` → the `footer` (Added/Last-rated) → the existing `onReportFountain` "Report this fountain" pressable.
- **Photos body**: `resolvedPhotos.length > 0 ? <PhotoCarousel photos={resolvedPhotos} apiBaseUrl={apiBaseUrl} onReport={onReportPhoto} onDelete={onDeletePhoto} /> : <Text style={styles.emptyPhotos}>No photos have been added yet.</Text>` → `{photosContribution}`. (Add an `emptyPhotos` style: `{ ...typography.body, color: colors.textMuted }`.)

Return:

```tsx
  return (
    <FountainDetailTabs
      refreshing={refreshing}
      onRefresh={onRefresh}
      tabs={[
        { id: "info", label: "Info", content: infoBody },
        { id: "details", label: "Details", content: detailsBody },
        { id: "photos", label: photosTabLabel(resolvedPhotos.length), content: photosBody },
      ]}
    />
  );
```

Remove the old top-level `wrap` `View` and the old top-of-page `PhotoCarousel` block (it moves into the Photos body). Drop the now-unused `wrap` style if nothing references it.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile exec tsc --noEmit`
Expected: PASS (no unused imports, no missing props).

- [ ] **Step 3: Commit**

```bash
git add mobile/components/fountain/FountainDetail.tsx
git commit -m "feat(mobile): split fountain detail into Info/Details/Photos tab bodies + hero"
```

---

## Task 8: Mobile — wire three contribution nodes in `[id].tsx`; refresh photos; retire "More Details"

**Files:**
- Modify: `mobile/app/fountains/[id].tsx`

**Interfaces:**
- Consumes: `FountainDetail`'s new props (Task 7); `ContributePanel`.

- [ ] **Step 1: Add `photosQuery` to refresh**

In `refetchAll`, add `void photosQuery.refetch();` alongside the existing detail/notes/viewer refetches. (This keeps a pull-to-refresh on any tab, including Photos, from leaving the carousel stale after another user's upload or an admin hide.)

- [ ] **Step 2: Build the three `ContributePanel`-wrapped nodes inside the ready branch**

The nodes need `detailQuery.data.dimensions` / `condition_points_eligible_at`, which are only narrowed inside the existing `{detailQuery.data ? ... : null}`. Build them there with a narrowed `const detail = detailQuery.data;` so they typecheck. Replace the `{detailQuery.data ? (<FountainDetail .../>) : null}` block with:

```tsx
        {detailQuery.data ? (() => {
          const detail = detailQuery.data;
          const wrapContribution = (children: React.ReactNode) => (
            <ContributePanel
              authStatus={auth.status}
              onSignIn={async () => {
                await auth.signIn();
              }}
            >
              {children}
            </ContributePanel>
          );
          const infoContribution = wrapContribution(
            <>
              <RatingContributionForm
                fountainId={fountainId}
                dimensions={detail.dimensions}
                pending={ratingMutation.isPending}
                onSubmit={async (body) => {
                  try {
                    await ratingMutation.mutateAsync(body);
                    return { ok: true };
                  } catch (error) {
                    return handleMutationError(error);
                  }
                }}
              />
              <PhotoUploadButton
                pending={photoUploadMutation.isPending}
                message={photoUploadMessage}
                onPick={(asset) => {
                  void pickAndUploadPhoto(asset);
                }}
              />
            </>,
          );
          const detailsContribution = wrapContribution(
            <>
              <AttributeContributionForm
                fountainId={fountainId}
                attributeTypes={attributeTypesQuery.data ?? []}
                pending={attributeMutation.isPending}
                isLoading={attributeTypesQuery.isLoading}
                isError={attributeTypesQuery.isError}
                onRetry={() => void attributeTypesQuery.refetch()}
                onSubmit={async (body) => {
                  try {
                    await attributeMutation.mutateAsync(body);
                    return { ok: true };
                  } catch (error) {
                    return handleMutationError(error);
                  }
                }}
              />
              <ConditionContributionForm
                fountainId={fountainId}
                pending={conditionMutation.isPending}
                conditionPointsEligibleAt={detail.condition_points_eligible_at}
                onSubmit={async (body) => {
                  try {
                    await conditionMutation.mutateAsync(body);
                    return { ok: true };
                  } catch (error) {
                    return handleMutationError(error);
                  }
                }}
              />
              <NoteContributionForm
                fountainId={fountainId}
                pending={noteMutation.isPending}
                onSubmit={async (body) => {
                  try {
                    await noteMutation.mutateAsync(body);
                    return { ok: true };
                  } catch (error) {
                    return handleMutationError(error);
                  }
                }}
              />
            </>,
          );
          const photosContribution = wrapContribution(
            <PhotoUploadButton
              pending={photoUploadMutation.isPending}
              message={photoUploadMessage}
              onPick={(asset) => {
                void pickAndUploadPhoto(asset);
              }}
            />,
          );
          return (
            <FountainDetail
              detail={detail}
              notes={displayNotes}
              notesError={notesQuery.isError}
              onRetryNotes={() => void notesQuery.refetch()}
              photos={photosQuery.data}
              apiBaseUrl={config.apiBaseUrl}
              onReportPhoto={
                auth.status === "authenticated"
                  ? (photo) => setReportTarget({ contentType: "photo", contentId: photo.id })
                  : undefined
              }
              onDeletePhoto={auth.status === "authenticated" ? confirmDeletePhoto : undefined}
              onReportNote={
                auth.status === "authenticated"
                  ? (note) => setReportTarget({ contentType: "note", contentId: note.id })
                  : undefined
              }
              onReportFountain={
                auth.status === "authenticated"
                  ? () => setReportTarget({ contentType: "fountain", contentId: fountainId })
                  : undefined
              }
              adminControls={
                adminDetail ? (
                  /* ...existing AdminControls JSX unchanged... */
                ) : undefined
              }
              infoContribution={infoContribution}
              detailsContribution={detailsContribution}
              photosContribution={photosContribution}
              refreshing={detailQuery.isRefetching || notesQuery.isRefetching || photosQuery.isRefetching}
              onRefresh={refetchAll}
              now={now}
              webBaseUrl={config.webBaseUrl}
            />
          );
        })() : null}
```

(Preserve the existing `adminControls={adminDetail ? <AdminControls ... /> : undefined}` block verbatim — only shown abbreviated above.)

- [ ] **Step 3: Remove the outer `ScrollView` and its `RefreshControl`**

`FountainDetailTabs` now owns scrolling and pull-to-refresh (per-tab). Remove the outer `<ScrollView ... refreshControl=...>` wrapper so the `{detailQuery.data ? ...}` block is the direct child of `QueryStateView`. Remove `ScrollView`/`RefreshControl` from the `react-native` import if unused elsewhere in the file (grep first). Keep `WaterCelebration` and `ReportContentButton` where they are.

- [ ] **Step 4: Remove `showMoreDetails` + fix the attribute-types gate**

- Delete `const [showMoreDetails, setShowMoreDetails] = useState(false);`.
- Change `attributeTypesQuery`'s `enabled` from `... && auth.status === "authenticated" && showMoreDetails` to `... && auth.status === "authenticated"` (intentional eager fetch; endpoint public — spec §5.4).
- The old "More Details" `Pressable` and `showMoreDetails`-gated form are already removed in Step 2. Remove the `secondaryButton`/`secondaryButtonText` styles if now unused (grep first).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter mobile exec tsc --noEmit`
Expected: PASS (no unused vars, no `possibly undefined` on `detailQuery.data`).

- [ ] **Step 6: Commit**

```bash
git add mobile/app/fountains/[id].tsx
git commit -m "feat(mobile): tabbed fountain detail — per-tab contribution panels, refresh photos, retire More Details"
```

---

## Task 9: Docs — style guide

**Files:**
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Extend the fountain-detail tabs section** with the mobile segmented-control tab bar: purpose (Info/Details/Photos parity), structure (fixed tab bar + per-tab `ScrollView`, all bodies mounted / inactive `display:"none"`), states (selected/unselected), a11y (`accessibilityRole="button"` + `accessibilityState={{ selected }}`; explicitly not `tab`/`tablist`), short example.

- [ ] **Step 2: Extend the fountain-photo section** with the **photo hero**: purpose (single newest photo atop Info, opens Photos tab), web (`PhotoHero`, `<img>` + `resolveApiBaseUrl`) and mobile (`PhotoHero`, `expo-image` + `resolvePhotoUrl`, 4:3), a11y (`See all N photos`), renders only when a photo exists.

- [ ] **Step 3: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): document fountain detail tab bar + photo hero (web + mobile)"
```

---

## Task 10: Full local checks + PR

- [ ] **Step 1: Run the local CI mirror** (from the repo root, PowerShell):

```
./run.ps1 check -Web
./run.ps1 check -Mobile
./run.ps1 check
```
Expected: all green (web eslint/prettier/typecheck/test/build; mobile eslint/typecheck/vitest/expo-doctor; full matrix). If Prettier flags a touched file, run `node node_modules/prettier/bin/prettier.cjs --write <file>` and re-check.

- [ ] **Step 2: Manual emulator pass (mobile)** — per the local Android build notes: the three tabs render; switching Info↔Details preserves a half-typed note (mounted panels); the Info hero opens the Photos tab; the Photos tab shows the full carousel; pull-to-refresh on Photos refreshes the carousel; photo upload still works (201).

- [ ] **Step 3: Open ONE PR (web + mobile), run the Codex PR-review loop, get CI green, address every PR comment, squash-merge** — per `claude_help/codex-review-process.md`. Merge only when CI is green AND Codex `VERDICT: APPROVED` AND every comment is addressed.

---

## Notes for the implementer

- Do NOT change any mutation/handler logic in `[id].tsx` — Tasks 7–8 only regroup where forms render and add `photosQuery` to refresh.
- Do NOT use `accessibilityRole="tab"`/`"tablist"` on mobile.
- Do NOT add `@testing-library/react-native` or other test deps — mobile uses pure-logic tests + typecheck + emulator.
- The web `FountainDetail` is a server component rendering the client `FountainDetailTabs`; `PhotoHero` (client) sits inside the `primary` node and reads the tabs context at render time (spec §5.2, confirmed viable).
- The mobile `PhotoCarousel` is unchanged — it moves into the Photos tab body.
