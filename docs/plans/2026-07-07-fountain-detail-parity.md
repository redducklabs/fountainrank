# Fountain Detail Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the native mobile fountain-detail screen the same Info/Details/Photos tabs as web, and add the single tappable "hero" photo (newest) to the top of the Info tab on both clients.

**Architecture:** Reuse web's existing tab architecture on mobile. A tabs component owns the active-tab state and exposes `setActive` through a React context so a `PhotoHero` rendered inside the Info body can switch to the Photos tab. All tab bodies stay mounted (inactive ones hidden) to preserve form input and scroll. No backend changes.

**Tech Stack:** Next.js/React (web), Expo/React Native + `@tanstack/react-query` (mobile), Vitest for both.

## Global Constraints

- Spec: `docs/specs/2026-07-07-fountain-detail-parity-design.md`. Every task's requirements implicitly include the spec.
- Hero photo is `photos[0]` (backend `list_photos` orders `created_at desc`), shown only when `photos.length > 0`.
- Web hero MUST resolve the photo path with `resolveApiBaseUrl()` (from `web/lib/api.ts`) — never raw `photo.url`. Mobile uses `resolvePhotoUrl(apiBaseUrl, path)` (from `mobile/lib/detail/photo-carousel.ts`).
- Mobile: ALL three tab bodies stay mounted; hide inactive with `style={{ display: "none" }}` — never conditionally render only the active body.
- Mobile tab buttons: `accessibilityRole="button"` + `accessibilityState={{ selected }}` + label. Do NOT use `accessibilityRole="tab"`. Hero: `accessibilityRole="button"`, label `See all N photos`.
- No AI attribution in commits/PRs. No time estimates. Conventional Commits. Frequent commits.
- Local checks before PR: web `pnpm --filter web lint/typecheck/test/build`; mobile `pnpm --filter mobile exec tsc --noEmit` (render tests run in CI). Prettier via `node node_modules/prettier/bin/prettier.cjs --check`.

---

## File Structure

**Web**
- Modify `web/components/fountain/FountainDetailTabs.tsx` — add `FountainDetailTabsContext` exposing `setActive`; wrap panels in the provider.
- Create `web/components/fountain/PhotoHero.tsx` — client component; newest photo; click → `setActive("photos")`.
- Modify `web/components/fountain/FountainDetail.tsx` — render `<PhotoHero>` at top of the `primary` tab body when photos exist.
- Modify `web/components/fountain/FountainDetail.test.tsx` — hero, zero-photo, hero→Photos.
- Create `web/components/fountain/PhotoHero.test.tsx`.

**Mobile**
- Create `mobile/components/fountain/FountainDetailTabs.tsx` — segmented control + context; all bodies mounted; per-tab `ScrollView`.
- Create `mobile/components/fountain/PhotoHero.tsx` — hero image; tap → `setActive("photos")`.
- Modify `mobile/components/fountain/FountainDetail.tsx` — split body into three tab bodies; accept `infoContribution`/`detailsContribution`/`photosContribution`; move `PhotoCarousel` into Photos tab; render `PhotoHero` on Info.
- Modify `mobile/app/fountains/[id].tsx` — build the three contribution nodes (each `ContributePanel`-wrapped); remove `showMoreDetails` + toggle; change `attributeTypesQuery` gate; remove the outer `ScrollView` (tabs own scrolling).
- Create `mobile/components/fountain/FountainDetailTabs.test.tsx`, `PhotoHero.test.tsx`; modify `mobile/components/fountain/FountainDetail.test.tsx`.

**Docs**
- Modify `docs/style-guide.md` — extend the fountain-detail tabs + fountain-photo sections.

---

## Task 1: Web — tabs context exposes `setActive`

**Files:**
- Modify: `web/components/fountain/FountainDetailTabs.tsx`
- Test: `web/components/fountain/FountainDetailTabs` is covered indirectly; add a focused test in `web/components/fountain/PhotoHero.test.tsx` (Task 2). This task has no standalone test — verify via typecheck + Task 2/3 tests.

**Interfaces:**
- Produces: `export const FountainDetailTabsContext: React.Context<{ setActive: (id: FountainDetailTab["id"]) => void } | null>` and a hook `export function useFountainDetailTabs(): { setActive: (id: FountainDetailTab["id"]) => void }` that throws if used outside the provider.

- [ ] **Step 1: Add the context + hook and wrap the panels**

In `web/components/fountain/FountainDetailTabs.tsx`, add after the imports:

```tsx
import { createContext, useContext, useId, useState } from "react";

const FountainDetailTabsContext = createContext<{
  setActive: (id: FountainDetailTab["id"]) => void;
} | null>(null);

/** Read the enclosing tabs controller — lets content inside a tab body (e.g. the Info
 *  `PhotoHero`) switch to another tab. Throws if used outside `FountainDetailTabs`. */
export function useFountainDetailTabs() {
  const ctx = useContext(FountainDetailTabsContext);
  if (!ctx) throw new Error("useFountainDetailTabs must be used within FountainDetailTabs");
  return ctx;
}
```

Wrap the component's returned JSX in the provider so panels can read it. Change the outer `<div className="flex min-h-0 flex-1 flex-col">` to be the provider's child:

```tsx
  return (
    <FountainDetailTabsContext.Provider value={{ setActive }}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* existing tablist + panels unchanged */}
      </div>
    </FountainDetailTabsContext.Provider>
  );
```

(Remove the now-duplicate `useId`/`useState` import line if you consolidated imports; keep the existing `useId`/`useState` usage.)

- [ ] **Step 2: Typecheck**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add web/components/fountain/FountainDetailTabs.tsx
git commit -m "feat(web): expose setActive from FountainDetailTabs via context"
```

---

## Task 2: Web — `PhotoHero` component

**Files:**
- Create: `web/components/fountain/PhotoHero.tsx`
- Test: `web/components/fountain/PhotoHero.test.tsx`

**Interfaces:**
- Consumes: `useFountainDetailTabs` (Task 1); `resolveApiBaseUrl` from `web/lib/api.ts`; `PhotoOut` from `web/lib/fountains`.
- Produces: `export function PhotoHero({ photos }: { photos: PhotoOut[] }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

`web/components/fountain/PhotoHero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhotoHero } from "./PhotoHero";
import * as tabs from "./FountainDetailTabs";

vi.mock("../../lib/api", () => ({ resolveApiBaseUrl: () => "http://api" }));

const photo = (id: string) => ({
  id,
  url: `/api/v1/photos/${id}`,
  thumbnail_url: `/api/v1/photos/${id}/thumb`,
  width: 800,
  height: 600,
  uploaded_by: null,
  created_at: "2026-07-07T00:00:00Z",
  is_own: false,
});

describe("PhotoHero", () => {
  it("renders nothing when there are no photos", () => {
    const { container } = render(<PhotoHero photos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the newest photo (photos[0]) with the resolved API url", () => {
    render(<PhotoHero photos={[photo("a"), photo("b")]} />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("http://api/api/v1/photos/a");
  });

  it("switches to the Photos tab when activated", async () => {
    const setActive = vi.fn();
    vi.spyOn(tabs, "useFountainDetailTabs").mockReturnValue({ setActive });
    render(<PhotoHero photos={[photo("a")]} />);
    await userEvent.click(screen.getByRole("button", { name: /see all/i }));
    expect(setActive).toHaveBeenCalledWith("photos");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm exec vitest run components/fountain/PhotoHero.test.tsx`
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
 *  API-relative gated path (`/api/v1/photos/{id}`); resolve it against the API origin the
 *  same way `PhotoCarousel` does (split-origin deploys). */
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

Run: `cd web && pnpm exec vitest run components/fountain/PhotoHero.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/fountain/PhotoHero.tsx web/components/fountain/PhotoHero.test.tsx
git commit -m "feat(web): add PhotoHero (Info tab newest-photo, opens Photos tab)"
```

---

## Task 3: Web — render `PhotoHero` at top of the Info tab

**Files:**
- Modify: `web/components/fountain/FountainDetail.tsx:39-124` (the `primary` node)
- Test: `web/components/fountain/FountainDetail.test.tsx`

**Interfaces:**
- Consumes: `PhotoHero` (Task 2).

- [ ] **Step 1: Add/adjust failing tests in `FountainDetail.test.tsx`**

Add these cases (adapt to the file's existing render helper / fixtures — it already builds a `detail`, `notes`, `photos`). Use the existing pattern for switching tabs (click the tab button by role/name):

```tsx
it("shows the newest photo as a hero at the top of the Info tab", () => {
  render(<FountainDetail {...propsWithPhotos([photo("a"), photo("b")])} />);
  // Info is the default tab; the hero button links to all photos.
  expect(screen.getByRole("button", { name: /see all 2 photos/i })).toBeInTheDocument();
});

it("shows no hero on the Info tab when there are no photos", () => {
  render(<FountainDetail {...propsWithPhotos([])} />);
  expect(screen.queryByRole("button", { name: /see all/i })).not.toBeInTheDocument();
});

it("activating the hero switches to the Photos tab", async () => {
  render(<FountainDetail {...propsWithPhotos([photo("a")])} />);
  await userEvent.click(screen.getByRole("button", { name: /see all/i }));
  // The Photos panel (gallery) is now visible; the Photos tab is selected.
  expect(screen.getByRole("tab", { name: /photos/i })).toHaveAttribute("aria-selected", "true");
});
```

If the test file lacks a `propsWithPhotos`/`photo` helper, add small local helpers mirroring the existing fixture shape (a `PhotoOut` with `id`, `url`, `is_own`, etc.).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && pnpm exec vitest run components/fountain/FountainDetail.test.tsx`
Expected: FAIL (hero not rendered yet).

- [ ] **Step 3: Render the hero in the `primary` node**

In `web/components/fountain/FountainDetail.tsx`, import it:

```tsx
import { PhotoHero } from "./PhotoHero";
```

Add `<PhotoHero photos={photos} />` as the FIRST child of the `primary` node's outer `<div className="space-y-4">` (above the title `<div>`):

```tsx
  const primary = (
    <div className="space-y-4">
      <PhotoHero photos={photos} />
      <div>
        <h1 className="text-lg font-bold text-brand-ink">
          {locationLabel ?? "Public drinking fountain"}
        </h1>
        {/* ...unchanged... */}
```

- [ ] **Step 4: Run the full web fountain test suite**

Run: `cd web && pnpm exec vitest run components/fountain/`
Expected: PASS (new hero cases + existing).

- [ ] **Step 5: Commit**

```bash
git add web/components/fountain/FountainDetail.tsx web/components/fountain/FountainDetail.test.tsx
git commit -m "feat(web): show newest-photo hero at top of the Info tab"
```

---

## Task 4: Mobile — `FountainDetailTabs` (segmented control + context, all bodies mounted)

**Files:**
- Create: `mobile/components/fountain/FountainDetailTabs.tsx`
- Test: `mobile/components/fountain/FountainDetailTabs.test.tsx`

**Interfaces:**
- Produces:
  - `export type FountainDetailTabId = "info" | "details" | "photos";`
  - `export type FountainDetailTab = { id: FountainDetailTabId; label: string; content: React.ReactNode };`
  - `export function FountainDetailTabs({ tabs, refreshing, onRefresh }: { tabs: FountainDetailTab[]; refreshing?: boolean; onRefresh?: () => void }): JSX.Element`
  - `export function useFountainDetailTabs(): { setActive: (id: FountainDetailTabId) => void }` (throws outside provider).
- Behavior: tab bar fixed at top; each tab body in its own `ScrollView` (with the shared `RefreshControl`); inactive bodies stay mounted, hidden via `style={{ display: "none" }}`.

- [ ] **Step 1: Write the failing test**

`mobile/components/fountain/FountainDetailTabs.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Text, TextInput } from "react-native";
import { describe, expect, it } from "vitest";
import { FountainDetailTabs, useFountainDetailTabs } from "./FountainDetailTabs";

function HeroLike() {
  const { setActive } = useFountainDetailTabs();
  return <Text accessibilityRole="button" onPress={() => setActive("photos")}>go-photos</Text>;
}
function TypingBody() {
  const [v, setV] = useState("");
  return <TextInput testID="typed" value={v} onChangeText={setV} />;
}

const tabs = [
  { id: "info" as const, label: "Info", content: <><Text>info-body</Text><HeroLike /></> },
  { id: "details" as const, label: "Details", content: <TypingBody /> },
  { id: "photos" as const, label: "Photos (1)", content: <Text>photos-body</Text> },
];

describe("FountainDetailTabs", () => {
  it("defaults to the first tab (Info)", () => {
    render(<FountainDetailTabs tabs={tabs} />);
    expect(screen.getByText("info-body")).toBeTruthy();
  });

  it("switches tabs when a tab button is pressed", () => {
    render(<FountainDetailTabs tabs={tabs} />);
    fireEvent.press(screen.getByText("Photos (1)"));
    expect(screen.getByText("photos-body")).toBeTruthy();
  });

  it("keeps inactive bodies mounted so typed input survives a switch", () => {
    render(<FountainDetailTabs tabs={tabs} />);
    fireEvent.press(screen.getByText("Details"));
    fireEvent.changeText(screen.getByTestId("typed"), "draft note");
    fireEvent.press(screen.getByText("Info"));
    fireEvent.press(screen.getByText("Details"));
    expect(screen.getByTestId("typed").props.value).toBe("draft note");
  });

  it("lets tab content switch tabs via the context (hero → photos)", () => {
    render(<FountainDetailTabs tabs={tabs} />);
    fireEvent.press(screen.getByText("go-photos"));
    expect(screen.getByText("photos-body")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && pnpm exec vitest run components/fountain/FountainDetailTabs.test.tsx`
Expected: FAIL ("Cannot find module './FountainDetailTabs'").

> Note: mobile render tests may be blocked locally by the hoisted-linker React duplicate; if `vitest` errors on that rather than on the missing module, rely on CI for the render assertions and continue. `tsc` must still pass locally.

- [ ] **Step 3: Implement `FountainDetailTabs`**

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
        <View style={styles.tabBar} accessibilityRole="tablist">
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
        {/* All bodies stay mounted; inactive ones are hidden (display:none) so form input
            and scroll position survive a switch. Each body owns its own ScrollView. */}
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

- [ ] **Step 4: Run test / typecheck**

Run: `cd mobile && pnpm exec vitest run components/fountain/FountainDetailTabs.test.tsx` (or rely on CI if the render-duplicate blocks it)
Then: `cd /d/repos/fountainrank && pnpm --filter mobile exec tsc --noEmit`
Expected: tests PASS (4) in CI; `tsc` PASS locally.

- [ ] **Step 5: Commit**

```bash
git add mobile/components/fountain/FountainDetailTabs.tsx mobile/components/fountain/FountainDetailTabs.test.tsx
git commit -m "feat(mobile): FountainDetailTabs segmented control (mounted panels, tab context)"
```

---

## Task 5: Mobile — `PhotoHero`

**Files:**
- Create: `mobile/components/fountain/PhotoHero.tsx`
- Test: `mobile/components/fountain/PhotoHero.test.tsx`

**Interfaces:**
- Consumes: `useFountainDetailTabs` (Task 4); `resolvePhotoUrl` from `mobile/lib/detail/photo-carousel.ts`; `expo-image` `Image`; `PhotoOut`.
- Produces: `export function PhotoHero({ photos, apiBaseUrl }: { photos: PhotoOut[]; apiBaseUrl: string }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

`mobile/components/fountain/PhotoHero.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, it, vi } from "vitest";
import { PhotoHero } from "./PhotoHero";

const setActive = vi.fn();
vi.mock("./FountainDetailTabs", () => ({ useFountainDetailTabs: () => ({ setActive }) }));

const photo = (id: string) => ({
  id, url: `/api/v1/photos/${id}`, thumbnail_url: `/api/v1/photos/${id}/thumb`,
  width: 800, height: 600, uploaded_by: null, created_at: "2026-07-07T00:00:00Z", is_own: false,
});

describe("PhotoHero (mobile)", () => {
  it("renders nothing with no photos", () => {
    const { toJSON } = render(<PhotoHero photos={[]} apiBaseUrl="http://api" />);
    expect(toJSON()).toBeNull();
  });

  it("opens the Photos tab when pressed", () => {
    render(<PhotoHero photos={[photo("a"), photo("b")]} apiBaseUrl="http://api" />);
    fireEvent.press(screen.getByLabelText(/see all 2 photos/i));
    expect(setActive).toHaveBeenCalledWith("photos");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && pnpm exec vitest run components/fountain/PhotoHero.test.tsx`
Expected: FAIL ("Cannot find module './PhotoHero'"). (Or rely on CI if the render-duplicate blocks it.)

- [ ] **Step 3: Implement `PhotoHero`**

`mobile/components/fountain/PhotoHero.tsx`:

```tsx
import type { components } from "@fountainrank/api-client";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { resolvePhotoUrl } from "../../lib/detail/photo-carousel";
import { colors, spacing } from "../../theme";
import { useFountainDetailTabs } from "./FountainDetailTabs";

type PhotoOut = components["schemas"]["PhotoOut"];

const ASPECT_RATIO = 3 / 4; // height = width * ratio, matching PhotoCarousel's 4:3

/** Single newest-photo hero atop the Info tab; tapping opens the Photos tab. Rendered only
 *  when a photo exists. Uses the same API-base URL resolution as `PhotoCarousel`. */
export function PhotoHero({ photos, apiBaseUrl }: { photos: PhotoOut[]; apiBaseUrl: string }) {
  const { setActive } = useFountainDetailTabs();
  if (photos.length === 0) return null;
  const newest = photos[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`See all ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
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
    marginBottom: spacing.md,
  },
});
```

- [ ] **Step 4: Run test / typecheck**

Run: `cd mobile && pnpm exec vitest run components/fountain/PhotoHero.test.tsx` (or CI)
Then: `pnpm --filter mobile exec tsc --noEmit`
Expected: tests PASS; `tsc` PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/components/fountain/PhotoHero.tsx mobile/components/fountain/PhotoHero.test.tsx
git commit -m "feat(mobile): add PhotoHero (Info tab newest-photo, opens Photos tab)"
```

---

## Task 6: Mobile — restructure `FountainDetail` into three tab bodies

**Files:**
- Modify: `mobile/components/fountain/FountainDetail.tsx`
- Test: `mobile/components/fountain/FountainDetail.test.tsx`

**Interfaces:**
- Consumes: `FountainDetailTabs`, `PhotoHero` (Tasks 4–5).
- Produces (new prop shape for `FountainDetail`): replace the single `contribution?: React.ReactNode` with three: `infoContribution?: React.ReactNode`, `detailsContribution?: React.ReactNode`, `photosContribution?: React.ReactNode`. Add `refreshing?: boolean` and `onRefresh?: () => void` (forwarded to `FountainDetailTabs`). All other props unchanged.

- [ ] **Step 1: Update the prop type and build the three tab bodies**

Change the destructured props: remove `contribution`, add `infoContribution`, `detailsContribution`, `photosContribution`, `refreshing`, `onRefresh`. Import `FountainDetailTabs` and `PhotoHero`.

Compose three `content` nodes from the EXISTING JSX blocks (move, don't rewrite):

- **Info body** (`<View style={{ gap: spacing.md }}>`): `PhotoHero` (photos, apiBaseUrl) → header block (title + `StatusBlock`) → rating hero row → dimensions block → `infoContribution` → the Directions/Share `actions` row.
- **Details body**: `AttributeList` → context comment card → notes (the `notesError`/`NotesList` block) → `adminControls` → `detailsContribution` → the `footer` (Added/Last-rated) → the `onReportFountain` "Report this fountain" pressable.
- **Photos body**: the full `PhotoCarousel` (moved here from the top; keep the `photos && photos.length > 0` guard and the `onReportPhoto`/`onDeletePhoto` wiring) → `photosContribution`. When `photos` is empty, render a muted "No photos have been added yet." `Text` (mirrors web).

Return:

```tsx
  return (
    <FountainDetailTabs
      refreshing={refreshing}
      onRefresh={onRefresh}
      tabs={[
        { id: "info", label: "Info", content: infoBody },
        { id: "details", label: "Details", content: detailsBody },
        {
          id: "photos",
          label: `Photos${photos && photos.length > 0 ? ` (${photos.length})` : ""}`,
          content: photosBody,
        },
      ]}
    />
  );
```

Keep all existing styles; the top-level `wrap` `View` is replaced by the three per-tab `View`s (each uses `gap: spacing.md`). Remove the now-unused outer `wrap` style if nothing references it.

- [ ] **Step 2: Update `FountainDetail.test.tsx`**

Update the existing tests to the new prop shape (`infoContribution`/`detailsContribution`/`photosContribution` instead of `contribution`) and add cases:
- Info tab shows the hero when photos exist; none when empty.
- `Photos (N)` label reflects `photos.length`; no count when empty.
- Photos tab shows the carousel; Details tab shows attributes/notes.
- Deleting `photos[0]` (re-render with a shorter array) makes the hero show the new newest.

Use `@testing-library/react-native` queries; press the tab labels to switch. Reuse existing fixtures; add `photo(id)` helper if absent.

- [ ] **Step 3: Run tests / typecheck**

Run: `cd mobile && pnpm exec vitest run components/fountain/FountainDetail.test.tsx` (or CI)
Then: `pnpm --filter mobile exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/components/fountain/FountainDetail.tsx mobile/components/fountain/FountainDetail.test.tsx
git commit -m "feat(mobile): split fountain detail into Info/Details/Photos tab bodies + hero"
```

---

## Task 7: Mobile — wire three contribution nodes in `[id].tsx`; retire "More Details"

**Files:**
- Modify: `mobile/app/fountains/[id].tsx`

**Interfaces:**
- Consumes: `FountainDetail`'s new `infoContribution`/`detailsContribution`/`photosContribution`/`refreshing`/`onRefresh` props (Task 6); `ContributePanel`.

- [ ] **Step 1: Remove the outer ScrollView; forward refresh to FountainDetail**

The tabs component now owns scrolling. Replace the `<ScrollView ...>{<FountainDetail .../>}</ScrollView>` wrapper (lines ~437-577) so `FountainDetail` is rendered directly inside `QueryStateView`, and pass refresh state through:

```tsx
        {detailQuery.data ? (
          <FountainDetail
            detail={detailQuery.data}
            /* ...existing props unchanged... */
            refreshing={detailQuery.isRefetching || notesQuery.isRefetching}
            onRefresh={refetchAll}
            infoContribution={/* Step 2 */}
            detailsContribution={/* Step 2 */}
            photosContribution={/* Step 2 */}
          />
        ) : null}
```

Remove the `import { ... ScrollView, RefreshControl ... }` entries from `react-native` if no longer used elsewhere in the file (check first).

- [ ] **Step 2: Build the three `ContributePanel`-wrapped nodes**

Each node reuses the SAME mutation handlers/state already in the file. Extract a small helper to avoid repeating the `ContributePanel` wrapper:

```tsx
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
        dimensions={detailQuery.data.dimensions}
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
        conditionPointsEligibleAt={detailQuery.data?.condition_points_eligible_at}
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
```

Delete the old inline `contribution={<ContributePanel>...</ContributePanel>}` block, the `<Pressable ...>More Details</Pressable>` toggle, and the `showMoreDetails`-gated `AttributeContributionForm`.

- [ ] **Step 3: Remove `showMoreDetails` and fix the attribute-types gate**

- Delete the `const [showMoreDetails, setShowMoreDetails] = useState(false);` line.
- Change `attributeTypesQuery`'s `enabled` from
  `enabled: fountainId != null && auth.status === "authenticated" && showMoreDetails`
  to `enabled: fountainId != null && auth.status === "authenticated"`.
  (Intentional: eager fetch on signed-in detail views; endpoint is public — see spec §5.4.)
- Remove the `secondaryButton`/`secondaryButtonText` styles if now unused (grep first).

- [ ] **Step 4: Typecheck**

Run: `cd /d/repos/fountainrank && pnpm --filter mobile exec tsc --noEmit`
Expected: PASS (no unused vars, no type errors).

- [ ] **Step 5: Commit**

```bash
git add mobile/app/fountains/[id].tsx
git commit -m "feat(mobile): tabbed fountain detail — per-tab contribution panels, retire More Details toggle"
```

---

## Task 8: Docs — style guide

**Files:**
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Update the fountain-detail tabs section**

In the existing section that documents the web `FountainDetailTabs`, add the mobile segmented-control tab bar: purpose (Info/Details/Photos parity), structure (fixed tab bar + per-tab `ScrollView`, all bodies mounted), states (selected/unselected), a11y (`accessibilityRole="button"` + `accessibilityState={{ selected }}`), and a short usage example.

- [ ] **Step 2: Update the fountain-photo section**

In the existing fountain-photo/carousel section, add the **photo hero**: purpose (single newest photo atop Info, opens Photos tab), web (`PhotoHero`, `<img>` + `resolveApiBaseUrl`) and mobile (`PhotoHero`, `expo-image` + `resolvePhotoUrl`, 4:3), a11y (`See all N photos` button), and that it renders only when a photo exists.

- [ ] **Step 3: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): document fountain detail tab bar + photo hero (web + mobile)"
```

---

## Task 9: Full local checks + PR

- [ ] **Step 1: Run the local CI mirror**

```bash
cd /d/repos/fountainrank
node node_modules/prettier/bin/prettier.cjs --check "{web,mobile,packages}/**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,md}"
pnpm --filter web exec tsc --noEmit && pnpm --filter web exec vitest run && pnpm --filter web run build
pnpm --filter mobile exec tsc --noEmit
```
Expected: all green (mobile render tests run in CI).

- [ ] **Step 2: Manual emulator pass (mobile)**

Build/run per `claude_help`/the local-android-build notes: verify the three tabs render, switching preserves a half-typed note, the Info hero opens the Photos tab, and photo upload still works (201).

- [ ] **Step 3: Open the PR, run the Codex PR-review loop, get CI green, address all comments, squash-merge.**

Per `claude_help/codex-review-process.md`: one PR covering both web + mobile; loop Codex until `VERDICT: APPROVED`; merge only when CI is green AND Codex approved AND every PR comment is addressed.

---

## Notes for the implementer

- **Do not** change any mutation/handler logic in `[id].tsx` — Task 7 only regroups where forms render.
- **Do not** add `accessibilityRole="tab"` on mobile.
- The web `FountainDetail` is a server component rendering the client `FountainDetailTabs`; `PhotoHero` (client) sits inside the `primary` node and reads the tabs context at render time — this is the confirmed-viable pattern (spec §5.2).
- Keep the mobile `PhotoCarousel` unchanged; it simply moves into the Photos tab body.
