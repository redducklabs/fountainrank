# FountainRank Style Guide

The single source of truth for FountainRank's visual language. Read this before
creating any new UI element, and document new components here as they are added
(house rule from `CLAUDE.md`).

Styling is done with **Tailwind CSS v4** utility classes (`web/app/globals.css`
is just `@import "tailwindcss";`). There is no custom CSS layer yet — brand colors
are applied as arbitrary-value utilities (e.g. `bg-[#0A357E]`) until a token theme
is introduced.

---

## Brand color tokens

Colors are derived from the FountainRank logo (a crowned blue map pin with a
water-fountain spray).

| Token       | Hex       | Usage                                                            |
| ----------- | --------- | ---------------------------------------------------------------- |
| Navy (deep) | `#0A357E` | Top of the page background gradient; deepest brand blue.         |
| Blue (mid)  | `#0C44A0` | Middle of the background gradient.                               |
| Royal blue  | `#0E4DA4` | Bottom of the background gradient; primary brand blue.           |
| Crown gold  | `#F2C200` | Accent: the "coming soon" pill, the "Rank" wordmark, highlights. |
| Water cyan  | `#5FC5F0` | Subtle decorative accents and glows (the fountain spray color).  |
| White       | `#FFFFFF` | Primary text on blue backgrounds.                                |

**Contrast:** White text on the navy→royal-blue gradient meets WCAG AA. Gold
(`#F2C200`) is used for accents and large/bold wordmark text, not for small body
copy on blue.

### Background gradient

The brand background is a top-to-bottom gradient:

```
bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4]
```

---

## Logo assets

Stored in `web/public/`, copied from the source artwork in `docs/logos/`.

| File                    | Source (`docs/logos/`)     | Usage                                                                |
| ----------------------- | -------------------------- | -------------------------------------------------------------------- |
| `fountainrank-logo.png` | `horizontal-with-text.png` | Primary horizontal wordmark (pin + "FountainRank"). Hero + OG image. |
| `icon.png`              | `filled-pin-logo-only.png` | Pin mark only, no text. Favicon / app icon (`metadata.icons`).       |

- Both PNGs have transparent backgrounds and are intended to sit on the brand blue.
- The wordmark is rendered with `next/image` and **always** carries a meaningful
  `alt` describing the mark (never decorative-empty).
- Do **not** recreate or redraw the logos in code — use these raster assets.

---

## Typography

- **Font:** the platform default sans-serif stack (no custom web font loaded yet).
- **Hero headline:** `font-bold`, responsive `text-3xl` → `sm:text-4xl` →
  `md:text-5xl`, `leading-tight`, `text-balance`.
- **Supporting copy:** `text-base` → `sm:text-lg`, `leading-relaxed`,
  `text-white/80` for reduced emphasis on the blue background.
- **Eyebrow / pill label:** `text-sm`, `font-semibold`, `uppercase`, wide tracking
  (`tracking-[0.18em]`).
- Use `text-balance` on headline and lead paragraph to avoid ragged wrapping.

---

## Components

### Landing hero (`web/app/page.tsx`)

The temporary "coming soon" landing page. A full-viewport
(`min-h-dvh`), vertically and horizontally centered `<main>` on the brand
gradient, containing:

1. The wordmark logo via `next/image`, responsive
   (`w-[min(80vw,480px)]`, `priority`), with a soft drop shadow.
2. The **coming-soon pill** (see below).
3. An `<h1>` tagline.
4. One supporting sentence (`text-white/80`).
5. A small fixed copyright `<footer>` at the bottom.

A decorative, `aria-hidden` cyan radial glow sits behind the content
(`bg-[#5FC5F0] opacity-15 blur-3xl`) for depth. It is purely visual and conveys
no information.

Mobile-first and responsive; no interactivity (pure server component).

### Coming-soon pill

A small gold-bordered status pill used to communicate launch state.

```tsx
<span className="mt-10 inline-flex items-center gap-2 rounded-full border border-[#F2C200]/70 bg-[#F2C200]/10 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.18em] text-[#F2C200]">
  <span className="h-2 w-2 rounded-full bg-[#F2C200]" aria-hidden="true" />
  Coming soon
</span>
```

- Gold border at 70% opacity over a faint gold fill (`bg-[#F2C200]/10`).
- A solid gold dot precedes the label (decorative, `aria-hidden`).
- Pill-shaped (`rounded-full`), uppercase, wide letter-spacing.

### Legal text pages (`web/app/privacy/page.tsx`, `web/app/terms/page.tsx`)

Static, readable policy pages for app-store and OAuth registration URLs.

- White background, dark slate text, constrained content width (`max-w-3xl`).
- Small brand-blue text link back to the landing page.
- Header includes an uppercase brand-blue page label, a compact title, last-updated
  date, and one lead sentence.
- Body is sectioned with `h2` headings and simple disc lists for scanability.
- These pages intentionally avoid the landing page gradient so long policy text
  remains comfortable to read.

### Auth buttons (`web/components/SignInButton.tsx`, `SignOutButton.tsx`)

Pill-shaped buttons that submit a Next.js server action (`<form action={...}>`).

- **Sign in (primary):** solid crown-gold fill (`bg-[#F2C200]`), navy text
  (`text-[#0A357E]`), `hover:bg-[#ffce1f]`, gold focus ring.
- **Sign out (secondary):** transparent with a `border-white/40` outline, white text,
  `hover:bg-white/10`, white focus ring — for use on the brand gradient.
- Both are `rounded-full`, `px-6 py-2.5`, `text-sm font-semibold`, and carry a visible
  `focus-visible` outline for keyboard users.

### Account panel (`web/app/account/page.tsx`)

The authenticated utility page (the BFF round-trip surface), on the brand gradient
(`min-h-dvh`, centered). Three states: signed-out (heading + copy + Sign in), signed-in
(heading + a `name`/`email` definition list + Sign out), and a profile-load error
(heading + Sign out). Not linked from the marketing hero; reached via the footer
"Sign in" link.

---

## Map UI

Added in Phase 3a. The map replaces the old "coming soon" landing page as the primary
product surface. Several components work together: the page shell (hero band + map
region), the MapLibre GL canvas with its controls and layers, and the overlay/list
components that provide keyboard-accessible and mobile-friendly access to fountain data.

### Homepage shell (`web/app/page.tsx`)

The root `/` page is no longer a static splash — it is the map product shell. The
layout is a vertical flex column that fills the viewport (`flex min-h-dvh flex-col`):

| Region     | Element                   | Notes                                                                             |
| ---------- | ------------------------- | --------------------------------------------------------------------------------- |
| `<header>` | Brand-gradient hero band  | `bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4]`, `px-6 py-6 sm:py-8` |
| Top row    | Wordmark + Sign-in button | `max-w-6xl`, `flex items-center justify-between`                                  |
| Hero copy  | `<h1>` + supporting `<p>` | `max-w-2xl`, `mt-5 sm:mt-6`                                                       |
| `<main>`   | Map region                | `relative flex-1` — grows to fill remaining viewport                              |
| `<footer>` | Reversed gradient footer  | `from-[#0E4DA4] to-[#0A357E]`, copyright + Privacy / Terms / Sign-in links        |

**Hero band details:**

- Wordmark: `next/image`, `w-[min(48vw,320px)] sm:w-[min(60vw,320px)]`, `drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]`, `priority`.
- Sign-in link: gold pill (`bg-[#F2C200] text-[#0A357E] rounded-full`), `hover:bg-[#ffce1f]`, `focus-visible:outline-[#F2C200]`, `shrink-0` so it never wraps under the logo.
- Headline: `text-2xl font-bold leading-tight text-balance sm:text-3xl md:text-4xl`.
- Supporting copy: `text-sm sm:text-base leading-relaxed text-white/80 text-balance`.

**Map region (`<main>`):** `relative flex-1` — the map canvas fills this area completely. `MapBrowserLoader` lazy-loads `MapBrowser` (no SSR) and renders a green-tinted placeholder (`bg-[#e9efe7]`) while the JS bundle loads.

**Footer:** `text-xs text-white/60`; links have `hover:text-white hover:underline underline-offset-4`.

**Accessibility:** The hero `<header>`, map `<main>`, and `<footer>` are native landmark elements with no additional `role` needed. The Sign-in link has visible `focus-visible` styling.

### Map controls

MapLibre GL controls added to the `"top-right"` corner of the canvas in `MapBrowser.tsx`:

| Control             | Class             | Behaviour                                                                                                                                 |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `NavigationControl` | MapLibre built-in | Zoom-in (+) and zoom-out (−) buttons; keyboard-accessible via the GL canvas.                                                              |
| `GeolocateControl`  | MapLibre built-in | Locate-me button (arrow icon); triggers `navigator.geolocation.getCurrentPosition`. `trackUserLocation: false`, `showUserLocation: true`. |

Both controls use MapLibre's default styling (included via `maplibre-gl/dist/maplibre-gl.css`).
On initial map load the app also fires an automatic geolocation attempt (via
`navigator.geolocation.getCurrentPosition`) and flies to the user's position at zoom 14
(`NEIGHBORHOOD_ZOOM`) if permission is granted; on denial the default continental-US view
(`DEFAULT_CENTER = [-98.5, 39.8]`, `DEFAULT_ZOOM = 3.5`) is kept silently.

### Map pins

Fountain pins are MapLibre symbol layers driven by raster sprite assets (loaded at map
startup from `PIN_ASSETS` in `web/lib/map/style.ts`). Pin variant is selected per feature
by `basePinIcon()` in `web/lib/map/pins.ts`:

| Variant               | Asset key      | Condition                                                                       |
| --------------------- | -------------- | ------------------------------------------------------------------------------- |
| Standard              | `pin-standard` | `is_working: true` and `ranking_score ≤ 4` (or null)                            |
| Gold                  | `pin-gold`     | `is_working: true` and `ranking_score > 4` (`GOLD_THRESHOLD`)                   |
| Broken / out-of-order | `pin-broken`   | `is_working: false`                                                             |
| Selected              | `pin-selected` | Active (selected) working non-gold pin — swapped in by the `selected-pin` layer |

Color and shape together encode status (colorblind-safe design): gold adds a distinct
shape/glyph cue in addition to color so the distinction does not rely on color alone.

**Layer stack** (from `web/lib/map/layers.ts`, rendered bottom-to-top):

1. `clusters` — circle layer for clustered groups (see Cluster bubbles below).
2. `cluster-count` — symbol layer showing the abbreviated count inside clusters.
3. `pins` — symbol layer for individual (non-cluster) fountains. `icon-anchor: "bottom"`, `icon-size: 0.5`, `icon-allow-overlap: true`.
4. `pins-pill` — rating pill overlaid above each pin (see Rating pill below).
5. `selected-halo` — semi-transparent blue circle behind the selected pin (`circle-color: "#0C44A0"`, `circle-opacity: 0.18`, radius 26 px translated −18 px upward to sit behind the pin head).
6. `selected-pin` — re-renders the active pin at a slightly larger size (`icon-size: 0.56`) using `SELECTED_ICON_EXPR` (working non-gold → `pin-selected`; gold or broken → base icon unchanged).

Clicking a pin or selected-pin layer navigates to `/fountains/:id` (soft Next.js navigation; map stays mounted). Clicking a cluster calls `getClusterExpansionZoom` and eases to that zoom. Cursor changes to `pointer` on `mouseenter` for all three interactive layers.

**Cursor:** canvas cursor is set to `"pointer"` on `mouseenter` for `clusters`, `pins`, and `selected-pin`.

### Rating pill

A small label that appears above each pin at zoom ≥ 13 (`PILL_MIN_ZOOM`) when the fountain has at least one rating.

- **Content:** `★ {avg}` (e.g. `★ 4.2`) formatted by `formatPill()` in `web/lib/map/format.ts`.
- **Rendering:** MapLibre symbol layer `pins-pill`. Uses a stretchable 9-patch image (`pill-bg`) as the icon background (`icon-image: "pill-bg"`, `icon-text-fit: "both"`, padding `[2, 6, 2, 6]`). The text is positioned above the pin head (`text-anchor: "top"`, `icon-anchor: "top"`, `text-offset: [0, 1.4]`).
- **Typography:** `text-size: 12`, `"Noto Sans Bold"`, `text-color: "#0A357E"` (Navy).
- **Visibility:** only shown when the feature has a non-null `pill` property and the map zoom is ≥ 13. Not shown on clusters.

### Cluster bubbles

When multiple fountains are close together at low zoom, they collapse into a cluster bubble
(MapLibre `cluster: true`, `clusterRadius: 60 px`, `clusterMaxZoom: 14`).

- **Circle:** `circle-color: "#0C44A0"` (Blue mid / brand blue), `circle-stroke-color: "#ffffff"`, `circle-stroke-width: 3 px`.
- **Size steps:** radius 16 px for < 10 fountains, 22 px for 10–49, 28 px for 50+.
- **Count label:** white `"Noto Sans Bold"` at 13 px, showing the abbreviated count (e.g. `"12"` or `"1.2k"`).
- **Interaction:** clicking a cluster calls `getClusterExpansionZoom` and eases the map to that zoom at the cluster's centroid.

### Detail overlay (`web/components/fountain/DetailOverlay.tsx`, `FountainDetail.tsx`)

Displayed when a user navigates to `/fountains/:id` from the map (intercepted by the
`@modal` parallel route slot). Outside the map context the same `FountainDetail` renders
in a full standalone page (`web/app/fountains/[id]/page.tsx`).

**Shell (`DetailOverlay`):**

- Full-screen fixed layer (`fixed inset-0 z-50`).
- Semi-transparent backdrop (`bg-black/30`), click-to-dismiss (`router.back()`), `aria-hidden`.
- Panel: `role="dialog"` `aria-label="Fountain detail"` `tabIndex={-1}` — receives focus on mount.
  - Mobile: bottom sheet — `absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-2xl`.
  - Desktop (≥ `md`): right side panel — `md:inset-y-0 md:left-auto md:right-0 md:w-96 md:rounded-none`.
  - Background: `bg-white`, `p-5`, `shadow-xl`.
- Close button: `absolute right-4 top-4 h-7 w-7 rounded-full bg-slate-100 text-slate-600`, `aria-label="Close"`.
- **Focus trap:** Tab/Shift-Tab cycle is trapped inside the panel. Escape calls `router.back()`. Focus is restored to the triggering element on close.

**Content (`FountainDetail`):**

The panel now also renders (in document order): the **status block** (chip + advisory + trust
line, see below) in place of the old standalone status chip; a **placement note** (`📍` prefix,
shown only when `placement_note` is present); the **attribute consensus** group; a "from who added
it" caption under the creator comment; and the **community notes** section.

| Element            | Styling                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading            | `text-lg font-bold text-[#0A357E]`                                                                                                                                                     |
| Status chip        | Pill badge: working → `bg-emerald-100 text-emerald-800`; out of order → `bg-red-100 text-red-800`. `rounded-full px-2.5 py-0.5 text-xs font-bold`.                                     |
| Overall rating     | `text-2xl font-extrabold text-[#0A357E]` (formatted by `formatAverage()`); vote count in `text-sm text-slate-500`.                                                                     |
| Per-dimension list | `<dl>` with `divide-y divide-slate-100 border-t border-slate-100`; dimension name `text-sm font-medium`, value `text-sm text-slate-600`.                                               |
| Notes / comments   | `rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`.                                                                                                           |
| Meta line          | Added / last-rated dates, `text-xs text-slate-400`.                                                                                                                                    |
| Directions button  | Gold pill: `rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]`. Links to Google Maps directions.                                                                    |
| Share button       | Outlined pill: `rounded-full border border-[#cdd6e6] bg-white px-4 py-2 text-sm font-bold text-[#0A357E]`. Uses `navigator.share` when available; falls back to `navigator.clipboard`. |

#### Status block (`StatusBlock.tsx`)

A small stack under the detail heading: a status **chip**, an optional **advisory line**, and a
**trust line**.

- **Chip** — driven by the fountain's `current_status` for the corroborated categories, and by the
  `is_working` baseline otherwise:
  | `current_status` | Label | Tone |
  | --- | --- | --- |
  | `ok` | "Verified working" | emerald (`bg-emerald-100 text-emerald-800`) |
  | `degraded` | "Working — issues reported" | amber (`bg-amber-100 text-amber-800`) |
  | `not_working` | "Not working" | red (`bg-red-100 text-red-800`) |
  | `reported_issue` | baseline ("Working" / "Out of order") | emerald / red |
  | `null` / unexpected | baseline ("Working" / "Out of order") | emerald / red |
  Chip shape: `rounded-full px-2.5 py-0.5 text-xs font-bold`.
- **Advisory line** — only for `reported_issue` (a non-flipping advisory): `text-xs text-amber-700`
  with a decorative `aria-hidden` ⚠, "Issue reported recently — not yet confirmed". The baseline
  chip is preserved so the working/out-of-order distinction is never lost.
- **Trust line** — `text-xs text-slate-400`: "Last verified {relative}" (relative time, with a
  precise day-resolution date in the `title`) when `last_verified_at` is set, else "Not yet
  verified by anyone".

#### Attribute consensus (`AttributeList.tsx`)

Observed attributes grouped by category. Group heading: `text-xs font-semibold uppercase
tracking-wide text-slate-500` (category labels: physical→"Features", accessibility→"Accessibility",
access→"Access"; unknown categories title-cased). Each row: attribute name (`text-slate-600`) left,
value right with emphasis by confidence — high/medium `text-slate-700`; low `text-slate-400` + a
muted `(N reports)` hint; `mixed` `text-amber-700` "Mixed" + a muted `latest: …` hint; all-unknown
`text-slate-400` "Unknown". No raw vote tallies.

#### Community notes (`NotesList.tsx`)

A "Community notes" section (heading styled as the attribute group heading). Each note is a card
(`rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`) with the body, then a
`text-xs text-slate-400` byline "— {author_display_name} · {relative time}" plus "· edited" when the
note was edited. The section is omitted entirely when there are no notes. The author is always the
backend's safe public `author_display_name`. User-generated free text (note body, placement note,
creator comment) carries `break-words` so a long unbroken string (URL/token) can't overflow the
narrow panel.

### Accessible fountains-in-view list (`web/components/map/FountainsInViewList.tsx`)

A keyboard-accessible roster of the pins currently visible in the map viewport. Provides
an alternative interaction path for keyboard and screen-reader users who cannot easily
interact with the GL canvas directly.

- **Container:** `<nav aria-label="Fountains in view">`.
  - Mobile: full-width strip along the bottom — `absolute bottom-0 left-0 right-0 max-h-40 overflow-auto`.
  - Desktop (≥ `md`): floating card — `md:bottom-4 md:left-4 md:right-auto md:w-72 md:rounded-lg`.
  - Background: `bg-white/95`, `shadow`, `p-2`.
- **Items:** `<ul class="space-y-1">` of `<li>` elements; each contains a `<button>` that calls `onOpen(id)` (soft nav to `/fountains/:id`).
- **Button styling:** `flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm`.
  - Default hover: `hover:bg-slate-100`.
  - Focus ring: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0C44A0]`.
  - Active (selected) item: `aria-current="true"` + `aria-[current=true]:bg-[#0C44A0]/10`.
- **Label:** Working status (`"Working"` / `"Out of order"`) with an optional `" · Top-rated"` suffix for gold-threshold fountains. Rating displayed right-aligned in `text-slate-500`.
- Hidden entirely (`return null`) when there are no pins in view.

### Map states (`web/components/map/MapStates.tsx`)

Five transient overlays that reflect the map's data-loading status. All are
`pointer-events-none` except `ErrorToast` (which has a Retry button).

| State        | Component    | Trigger                               | Rendering                                                                                                                                                                                                                         |
| ------------ | ------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading      | `LoadingBar` | `status === "loading"`                | `absolute left-0 right-0 top-0 h-1 animate-pulse bg-[#0C44A0]`. `role="status"` `aria-label="Loading fountains"`.                                                                                                                 |
| Zoom-in hint | `ZoomInHint` | `status === "belowZoom"` (zoom < 10)  | Centered pill: `rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow`. Text: "🔍 Zoom in to see fountains".                                                                         |
| Empty        | `EmptyHint`  | `status === "empty"`                  | Bottom-center pill: same pill shape, `text-sm text-slate-700`. Text: "No fountains mapped here yet."                                                                                                                              |
| Cap hint     | `CapHint`    | `status === "capped"` (≥ 500 results) | Bottom-center pill (same style). Text: "Lots of fountains here — zoom in to see them all."                                                                                                                                        |
| Error        | `ErrorToast` | `status === "error"`                  | Bottom-center card: `rounded-lg bg-white px-4 py-2 text-sm shadow`. `role="alert"`. "Couldn't load fountains." + a "Retry" button (`font-semibold text-[#0C44A0] underline`, calls `map.fire("moveend")` to re-trigger the load). |

Loading bar, zoom-in hint, empty hint, and cap hint are all `pointer-events-none` and
purely informational. The error toast has `role="alert"` (live region) and its Retry
button is interactive.
