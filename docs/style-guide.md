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

### Slim site header (`web/components/SiteHeader.tsx`)

Replaces the tall hero band introduced in Phase 3a. A shared **server component** that renders a
narrow brand bar on every full-page route and an optional one-line tagline on the map page.

**Variants** — controlled by a `variant: "hero" | "bar"` prop:

| Variant | Use | Extra content |
| ------- | --- | ------------- |
| `hero`  | Map page (`/`) | One-line tagline "Find a drinking fountain near you." below the bar |
| `bar`   | All other full-page routes (`/account`, `/admin`, fountain standalone) | Bar only — no tagline |

**Structure:**

```
<header class="bg-gradient-to-b from-[#0A357E] to-[#0E4DA4] px-6 py-3 text-white">
  <div class="mx-auto flex max-w-6xl items-center justify-between gap-4">
    <!-- Wordmark link (left) -->
    <a href="/" aria-label="FountainRank home">
      <img src="/fountainrank-logo.png" alt="FountainRank" class="h-9 w-auto" />
    </a>
    <!-- AuthControl (right) -->
    <AuthControl viewer={viewer} />
  </div>
  <!-- hero variant only -->
  <p class="mx-auto mt-2 max-w-6xl text-sm font-semibold sm:text-base">
    Find a drinking fountain near you.
  </p>
</header>
```

- Brand gradient: `bg-gradient-to-b from-[#0A357E] to-[#0E4DA4]`.
- Compact height — `py-3` (vs. the old `py-6/py-8` hero) so the map dominates the viewport.
- Wordmark: `next/image`, fixed display height `h-9 w-auto`, `priority`, meaningful `alt`.
- Tagline (hero only): `text-sm font-semibold sm:text-base text-white` — a single sentence, no supporting subcopy.
- `SiteHeader` is a dynamic async server component (reads the session cookie via `getViewer()`).

### Auth control (`web/components/AuthControl.tsx`)

A client component placed in the top-right of `SiteHeader`. Renders one of two affordances
depending on the viewer state produced by `getViewer()`.

#### Sign-in button (signed-out state)

Displayed when `viewer.state === "anonymous"`. A gold pill button inside a `<form>` that
triggers `signInWithReturn` (a server action that stores the current path in a cookie and
redirects to Logto, returning the user to the page they signed in from).

```tsx
<form action={signInWithReturn.bind(null, returnTo)}>
  <button type="submit" className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#F2C200] px-5 py-2 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f]">
    Sign in
  </button>
</form>
```

- Same gold-pill style as the existing sign-in affordance (crown-gold fill, navy text).
- `shrink-0` prevents wrapping under the wordmark on narrow viewports.
- `returnTo` is derived from `usePathname()` + `useSearchParams()` on the client.

#### Avatar button + user menu (signed-in state)

Displayed when `viewer.state === "authed"` or `"error"`. A circular avatar button opens a
dropdown user menu.

**Avatar button:**

```tsx
<button
  type="button"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-label="Open account menu"
  className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/20 text-sm font-semibold text-white"
>
  {avatarUrl
    ? <img src={avatarUrl} alt="" width={36} height={36} className="h-9 w-9 object-cover" />
    : <span aria-hidden="true">{initial}</span>}
</button>
```

- `aria-label="Open account menu"` — the accessible name (never omit; the image has `alt=""`).
- Avatar image is **decorative** (`alt=""`); when no `avatarUrl`, an initials/glyph fallback
  (`initial = displayName[0].toUpperCase()`) is wrapped in `aria-hidden="true"` (the button label
  carries the accessible name).
- `aria-haspopup="menu"` + `aria-expanded={open}` — communicate dropdown state to assistive tech.

**User menu (dropdown):**

```tsx
<div role="menu" className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
  <p className="px-3 py-2 text-sm font-semibold text-slate-700">{displayName}</p>
  <!-- error state only -->
  <p className="px-3 py-1 text-xs text-amber-700">Couldn't load your account.</p>

  <a role="menuitem" href="/account" className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Your account</a>
  <!-- admin only -->
  <a role="menuitem" href="/admin" className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Admin</a>

  <div class="my-1 border-t border-slate-100" />   <!-- divider -->

  <form action={signOutAction}>
    <button role="menuitem" type="submit" className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">Sign out</button>
  </form>
</div>
```

**Menu items:**

| Item | Condition | Target |
| ---- | --------- | ------ |
| Display name (non-interactive header) | Always (authed) | — |
| "Couldn't load your account." | `viewer.state === "error"` only | — |
| **Your account** (`role="menuitem"`) | Always | `/account` |
| **Admin** (`role="menuitem"`) | `viewer.isAdmin === true` only | `/admin` |
| Divider (`border-t border-slate-100`) | Always | — |
| **Sign out** (`role="menuitem"`, form submit) | Always | `signOutAction` |

**Behavior:**

- Opens on avatar button click; `aria-expanded` toggles.
- Closes on: outside click, `Escape` key, or menu item activation.
- On open: focus moves to the first `role="menuitem"` element.
- On close (Escape or outside-click): focus returns to the avatar button.
- Admin item is **rendered only when `viewer.isAdmin`** — hiding it is cosmetic; `/admin` re-checks
  server-side and fails closed regardless.
- Error state (`viewer.state === "error"`) shows a degraded menu: name header omitted, amber
  "couldn't load" note shown, **no Admin item**, Account + Sign out remain.

### Homepage footer (auth-aware)

The map page `<footer>` is auth-aware. When signed out it shows a "Sign in" trigger (a form
submitting `signInWithReturn` bound to `"/"`, styled as a plain text link). When signed in the
item is hidden so the footer never shows a dead sign-in link.

**Signed-out footer:**

```
© {year} FountainRank · <a>Privacy</a> · <a>Terms</a> · <form><button>Sign in</button></form>
```

**Signed-in footer:**

```
© {year} FountainRank · <a>Privacy</a> · <a>Terms</a>
```

- Footer text: `text-xs text-white/60`; links and the sign-in button: `hover:text-white hover:underline underline-offset-4`.
- The sign-in button carries no additional styling beyond the footer link treatment (plain text,
  not a pill) — distinct from the header's gold pill Sign-in button.
- The signed-in variant (three items only) and its spacing are pinned in tests so removal of the
  item doesn't regress mobile wrapping.

### `/admin` placeholder page (`web/app/admin/page.tsx`)

A server-gated page that **fails closed**: any non-admin visitor never sees admin content.

**Gate logic:**

| `getViewer()` result | Outcome |
| -------------------- | ------- |
| `anonymous` | Renders a "Sign in to access the admin tools." prompt + Sign-in button (form submitting `signInWithReturn("/admin")`). Does NOT redirect or mutate cookies during render. |
| `authed` + `isAdmin: false` | `notFound()` — 404, does not reveal the route exists. |
| `error` | Renders "Couldn't verify admin access — please try again." No admin content, no 404. |
| `authed` + `isAdmin: true` | Renders the stub page (see below). |

**Admin stub page** (shown to confirmed admins):

- `SiteHeader variant="bar"` at the top.
- `<h1>` "Admin" in `text-lg font-bold text-[#0A357E]`.
- Body: "Moderation tools are coming soon." with a disc list of planned 6g actions (hide/unhide
  fountains and notes; review reported content).
- Layout: `mx-auto max-w-2xl px-6 py-10` — same constrained-width pattern as the legal text pages.

**Sign-in prompt** (anonymous state): same layout container, heading "Admin", supporting copy
"Sign in to access the admin tools.", gold pill "Sign in" button (`rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]`).

**Error state**: same layout, heading "Couldn't verify admin access", copy "Please try again in a moment." — neither 404 nor admin content.

---

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

The panel renders (in document order): the **status block** (chip + advisory + trust line, see
below) in place of the old standalone status chip; a **placement note** (`📍` prefix, shown only
when `placement_note` is present); the **attribute consensus** group; a "from who added it"
caption under the creator comment; the **community notes** section; and the **Contribute section**
at the bottom (auth-gated write controls).

| Element              | Styling                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading              | `text-lg font-bold text-[#0A357E]`                                                                                                                                                     |
| Status chip          | Pill badge: working → `bg-emerald-100 text-emerald-800`; out of order → `bg-red-100 text-red-800`. `rounded-full px-2.5 py-0.5 text-xs font-bold`.                                     |
| Overall rating       | `text-2xl font-extrabold text-[#0A357E]` (formatted by `formatAverage()`); vote count in `text-sm text-slate-500`.                                                                     |
| Per-dimension list   | `<dl>` with `divide-y divide-slate-100 border-t border-slate-100`; dimension name `text-sm font-medium`, value `text-sm text-slate-600`.                                               |
| Notes / comments     | `rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`.                                                                                                           |
| Meta line            | Added / last-rated dates, `text-xs text-slate-400`.                                                                                                                                    |
| Directions button    | Gold pill: `rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]`. Links to Google Maps directions.                                                                    |
| Share button         | Outlined pill: `rounded-full border border-[#cdd6e6] bg-white px-4 py-2 text-sm font-bold text-[#0A357E]`. Uses `navigator.share` when available; falls back to `navigator.clipboard`. |
| **Contribute section** | Bottom of panel; heading `text-base font-semibold text-[#0A357E]`; signed-out prompt or three grouped forms (see below). |

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

#### Contribute section (`web/components/fountain/ContributeSection.tsx`)

A grouped write-action section at the bottom of `FountainDetail`. Auth-gated: renders one of two
states depending on whether the viewer is authenticated.

**Signed-out prompt:**

```tsx
<section>
  <h2 className="text-base font-semibold text-[#0A357E]">Contribute</h2>
  <p className="mt-1 text-sm text-slate-600">Sign in to rate, verify, or leave a note.</p>
  <form action={signInWithReturn.bind(null, `/fountains/${fountainId}`)}>
    <button type="submit" className="mt-3 rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">
      Sign in to contribute
    </button>
  </form>
</section>
```

- The sign-in button binds `returnTo` to `/fountains/{id}` so the user lands back on the same
  fountain after sign-in.
- No write forms are rendered when signed out.

**Signed-in layout:** the same section heading followed by the three forms stacked vertically
with a divider (`border-t border-slate-100 my-4`) between each:

1. Rating form (see below)
2. Condition form (see below)
3. Note form (see below)

#### Star-rating input (`web/components/fountain/RatingForm.tsx`)

One row per rating dimension from `FountainDetail.dimensions`. Each row: the dimension name
(`text-sm font-medium text-slate-700`) and a 5-star radio group.

**Radio group (per dimension):**

```tsx
<fieldset>
  <legend className="sr-only">{dimension.name}</legend>
  {[1, 2, 3, 4, 5].map((n) => (
    <label key={n}>
      <input type="radio" name={`dim-${id}`} value={n} className="sr-only" />
      <span aria-hidden="true">{selected >= n ? "★" : "☆"}</span>
      <span className="sr-only">{dimension.name}: {n} star{n > 1 ? "s" : ""}</span>
    </label>
  ))}
</fieldset>
```

- The radio group is keyboard-accessible; arrow keys move between star values.
- Labels are visually hidden (`sr-only`) so screen readers announce the dimension name and
  star count for each option.
- Stars are decorative Unicode glyphs (`aria-hidden`); the accessible label on each input is
  the screen-reader text (e.g. "Clarity: 4 stars").
- **Submit button** (`"Submit rating"`) is **disabled until at least one dimension has a star
  set**. `disabled:opacity-50 disabled:cursor-not-allowed`.
- Only dimensions with a star set are included in the payload; untouched dimensions are omitted.
- While pending (form submitting): all controls disabled, button text "Submitting…".
- Success: inline `role="status"` confirmation "Thanks for your rating!" replaces or appears
  below the form.
- Error: inline `role="status"` `aria-live="polite"` error message per the inline form convention
  (see below).

#### Condition action row + "Report a problem" disclosure (`web/components/fountain/ConditionForm.tsx`)

A two-affordance row for submitting condition reports.

**Primary action:**

```tsx
<button type="button" className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
  I checked — it's working
</button>
```

Submits `{ status: "working", is_proximate: false }` immediately on click (no disclosure needed).

**Secondary action — "Report a problem" disclosure:**

```tsx
<button type="button" aria-expanded={open} className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-700">
  Report a problem
</button>
```

- `aria-expanded` toggles when the disclosure opens/closes.
- When expanded, reveals a `<select>` with the seven problem statuses (friendly labels from
  `conditionStatusLabel`):

| `ConditionStatus` | Label |
| --- | --- |
| `broken` | "Broken / not working" |
| `low_pressure` | "Low water pressure" |
| `dirty` | "Dirty" |
| `bad_taste` | "Bad taste" |
| `blocked` | "Blocked / clogged" |
| `seasonal_unavailable` | "Shut off for the season" |
| `hours_limited` | "Only available certain hours" |

- Select: `rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 w-full`.
- A "Submit report" button (`rounded-full bg-[#0C44A0] px-4 py-2 text-sm font-bold text-white hover:bg-[#0A357E]`) confirms the selected status.
- `is_proximate` is always `false` on web (proximity verification is the mobile app's job).
- Both the primary button and the select submit button are disabled while pending.
- Per-user-per-day deduplication is server-enforced; no client-side guard.

#### Note form (`web/components/fountain/NoteForm.tsx`)

A textarea + live character counter + save button for adding or replacing a community note.

```tsx
<div>
  <label htmlFor="note-body" className="text-sm font-medium text-slate-700">
    Your note
  </label>
  <textarea
    id="note-body"
    maxLength={1000}
    rows={4}
    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0C44A0]"
  />
  <p className="mt-1 text-xs text-slate-400 text-right">{charCount}/1000</p>
  <p className="mt-1 text-xs text-slate-500">
    Submitting replaces any note you have previously added.
  </p>
  <button type="submit" className="mt-2 rounded-full bg-[#0C44A0] px-4 py-2 text-sm font-bold text-white hover:bg-[#0A357E] disabled:opacity-50">
    Save note
  </button>
</div>
```

- **Character counter** (`{charCount}/1000`): updates live as the user types; displayed right-aligned in `text-xs text-slate-400`.
- Empty or whitespace-only body is rejected **client-side** before submission (button remains disabled; no server call).
- Copy states explicitly that submitting **replaces** any prior note — the note upsert is a
  per-user per-fountain replace, not an append.
- **Success copy** is neutral: "Your note was saved." — it does **not** promise public visibility,
  because a previously moderation-hidden note stays hidden after an upsert.
- All user-generated text in the form carries `break-words` to prevent long unbroken strings from
  overflowing the narrow panel.
- While pending: textarea and button disabled.

#### Inline form pending / success / error convention

All three Contribute forms (`RatingForm`, `ConditionForm`, `NoteForm`) follow the same state
pattern:

| State | UI |
| ----- | -- |
| **Idle** | Controls enabled; no status message. |
| **Pending** | All controls disabled; submit button text changes (e.g. "Submitting…"). `useTransition` in-flight indicator. |
| **Success** | Controls re-enabled (or form resets); an inline `<p role="status">` confirmation message appears below the button. |
| **Error** | Controls re-enabled; an inline `<p role="status" aria-live="polite">` error message appears below the button. |

**Error message copy by `ContributeError`:**

| Error | Message |
| ----- | ------- |
| `unauthenticated` | "Your session expired — sign in again." |
| `not_found` | "This fountain is no longer available." |
| `validation` | "Invalid input — please check your entry." |
| `server` | "Couldn't save — please try again." |

- Error and success messages use `role="status"` + `aria-live="polite"` so screen readers
  announce them without interrupting the user.
- On a successful write, the client calls `router.refresh()` to re-render the detail with
  updated averages / status / notes (both the standalone route and the intercepted-modal segment).

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

---

## Add-fountain flow (slice 6b-2)

The components below are added in slice 6b-2. They appear as an overlay on the map and
share the existing brand palette. All interactive elements follow the focus-visible /
disabled-opacity-40 conventions already established in the map UI.

### Add-fountain FAB (`web/components/map/AddFountainFab.tsx`)

A floating action button anchored to the bottom-right of the map canvas. Appears when
WebGL2 is available; hidden when the map cannot render (`webglOk === false`).

**Placement:** `absolute bottom-24 right-4 z-40` — sits above the in-view list and below
the site header.

**Variants:**

| State | Rendering |
| ----- | --------- |
| `!webglOk` | Returns `null` — not rendered at all. |
| Signed out (`!isAuthenticated`) | Wrapped in a `<form action={signInWithReturn.bind(null, "/?add=1")}>` so clicking submits the server action (no client JS needed). |
| Signed in (`isAuthenticated`) | Plain `<button type="button" onClick={onEnter}>`. |

**Styles:**

```tsx
className="absolute bottom-24 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#F2C200] px-4 py-3 text-sm font-bold text-[#0A357E] shadow-lg transition hover:bg-[#ffce1f]"
```

- Crown-gold fill (`bg-[#F2C200]`), navy text (`text-[#0A357E]`) — same as the primary
  action button in the contribute section.
- `aria-label="Add a fountain"` on the button (both signed-in and signed-out variants).
- The `+` prefix glyph is `aria-hidden="true"`.

**Accessibility:** Both variants produce an accessible button name via `aria-label`. The
signed-out form wraps the button without altering its accessible role.

---

### Placement panel / bottom sheet (`web/components/map/AddFountainPanel.tsx`)

A `role="dialog"` overlay that guides the user through the three-step add flow. Mounted
alongside the FAB inside the map canvas container; replaces the FAB while open (the FAB is
not hidden, but the panel draws on top via `z-40`).

**Shell:**

```tsx
<div
  role="dialog"
  aria-label="Add a fountain"
  tabIndex={-1}
  className="absolute inset-x-0 bottom-0 z-40 mx-auto max-w-md rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl outline-none sm:bottom-4 sm:left-auto sm:right-4 sm:mx-0 sm:rounded-2xl"
>
```

- Mobile: full-width bottom sheet (`inset-x-0 bottom-0 rounded-t-2xl`).
- Desktop (≥ `sm`): right-anchored card (`sm:left-auto sm:right-4 sm:rounded-2xl`), same
  position as the detail overlay panel.
- `tabIndex={-1}` + `ref.current.focus()` on mount so keyboard users land inside the panel
  immediately.
- `Escape` always calls `onCancel` (listener on `document`, removed on unmount).

**Steps (controlled by `phase`):**

| Phase | Panel content | Primary action |
| ----- | ------------- | -------------- |
| `placing` | Instruction text + optional GPS fallback note + coordinate readout + keyboard controls | "Next: details" (disabled until `pin && placeable`) |
| `details` | Coordinate readout + working-status toggle | "Add fountain" (`onSubmit`) |
| `submitting` | `role="status"` "Adding…" | — |
| `done` | `role="status"` "Fountain added." | — |
| `duplicate` | `role="status"` "A fountain already exists here." + "View it" link | — |
| `error` | `role="status"` error copy + retry or sign-in affordance | "Try again" / "Sign in" |

**Cancel button:** `aria-label="Cancel"`, top-right of the panel header, always visible
while the panel is open.

---

### Bound ring + pin + coordinate readout (`PlacingStep`)

Visual feedback for the user's allowed placement area during the `placing` step.

**Ring:** A dashed `LineString` drawn on the MapLibre canvas by `createPlacementMap`.
Rendered only when the bound is a circle (GPS fix available); not shown for the viewport
fallback. Styled as a semi-transparent dashed blue stroke via a MapLibre `line` layer.

**Pin:** A MapLibre `Marker` (draggable) placed when the user taps the map or uses the
keyboard controls. Shows the snapped coordinate.

**Coordinate readout (`Coord`):**

```tsx
// no pin:
<p className="mt-2 text-xs text-slate-500">Drop a pin to set the location.</p>
// pin set:
<p className="mt-2 text-xs tabular-nums text-slate-500">
  Lat {pin.lat.toFixed(5)} · Lng {pin.lng.toFixed(5)}
</p>
```

- `tabular-nums` keeps the coordinate from reflowing as digits change during drag.

**Out-of-bound note:** The bound ring's visual presence implies the constraint; no
additional "out-of-bound" label is shown beyond the pin being clamped to the ring.

---

### Keyboard placement controls (`PlacingStep`)

A row of accessible buttons that allow placing and nudging the pin without canvas
interaction — required for keyboard-only and assistive-technology users.

**Controls:**

| Control | Button label | `aria-label` | Action |
| ------- | ------------ | ------------ | ------ |
| Place at center | "Place at map center" | same | Calls `onPlaceAtCenter`; drops/moves pin to the map's current center |
| Nudge N | ↑ | "Nudge north" | Calls `onNudge("n")` |
| Nudge S | ↓ | "Nudge south" | Calls `onNudge("s")` |
| Nudge E | → | "Nudge east" | Calls `onNudge("e")` |
| Nudge W | ← | "Nudge west" | Calls `onNudge("w")` |
| Next | "Next: details" | same | Calls `onNext` |

**Disabled state:** All keyboard controls (`Place at map center`, nudge buttons, Next)
are `disabled` when `!placeable` (zoom < `PLACE_MIN_ZOOM` or viewport span >
`FALLBACK_MAX_SPAN_M`). The nudge buttons additionally require `pin` to be non-null.
`disabled:opacity-40` conveys the disabled state visually.

When not yet placeable, a hint "Zoom in to place the fountain." is displayed below the
coordinate readout in `text-xs text-slate-500`.

---

### "We couldn't confirm your location" fallback message

Shown in the `placing` step when `gpsUnavailable === true` (no GPS fix, or accuracy
exceeds `ACCURACY_MAX_M` so the bound falls back to the viewport).

```tsx
<p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
  We couldn&rsquo;t confirm your location — make sure the pin is exactly where the fountain is.
</p>
```

- Amber background (`bg-amber-50 text-amber-800`) — consistent with the advisory tone used
  in `StatusBlock`.
- Renders between the instruction paragraph and the coordinate readout.

---

### Working-status toggle (`DetailsStep`)

A `<fieldset>` / `<legend>` radio group for capturing whether the fountain is currently
working. Shown in the `details` step.

```tsx
<fieldset>
  <legend className="text-sm font-semibold text-slate-700">Is it working?</legend>
  <div className="mt-1 flex gap-4">
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name="working" checked={working} onChange={() => onSetWorking(true)} />
      Yes
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name="working" checked={!working} onChange={() => onSetWorking(false)} />
      No
    </label>
  </div>
</fieldset>
```

- Default: **Yes** (`working === true`).
- The `<legend>` is visually rendered (not `sr-only`) since the question is central to this
  step.
- Standard `type="radio"` inputs — no custom styling beyond the label wrapper.

---

### Duplicate-conflict result (`phase === "duplicate"`)

Shown when the server returns a 409 conflict (a fountain already exists near this
location).

```tsx
<div className="mt-3 space-y-2">
  <p role="status" className="text-sm text-slate-700">A fountain already exists here.</p>
  <Link href={`/fountains/${duplicateId}`} className="inline-block rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">
    View it
  </Link>
</div>
```

- `role="status"` on the message so screen readers announce the outcome.
- "View it" link: gold pill (`bg-[#F2C200] text-[#0A357E]`), same style as the primary
  action button. Uses Next.js `<Link>` for soft navigation to the existing fountain's
  detail page.
- The duplicate fountain ID comes from the typed `DuplicateFountainConflict` error body
  (`error.fountain_id`), validated as a UUID before display.
