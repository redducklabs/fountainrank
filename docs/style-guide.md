# FountainRank Style Guide

The single source of truth for FountainRank's visual language. Read this before
creating any new UI element, and document new components here as they are added
(house rule from `CLAUDE.md`).

Styling is done with **Tailwind CSS v4** utility classes. `web/app/globals.css` defines a
semantic **token layer** — `:root`/`.dark` custom properties mapped to Tailwind v4 utilities
via `@theme inline` — seeded from `web/lib/theme/palette.ts` (the single source of truth;
the mirror is enforced by `palette.test.ts`). Surfaces are built from token utilities
(`bg-surface`, `text-foreground`, `text-brand-ink`, `border-border`, `bg-brand`, …) that flip
automatically when the `.dark` class is present on `<html>`; arbitrary hex utilities (e.g.
`bg-[#0A357E]`) are no longer used for brand/neutral colors. See "Dark mode & theme tokens"
below for the full token table and how the theme is selected.

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

## Dark mode & theme tokens

The app supports **System / Light / Dark** appearance (#18). The token layer lives in
`web/app/globals.css` (`:root` for light, `.dark` for dark, mirrored into Tailwind v4
utilities via `@theme inline`), seeded from the single source of truth
`web/lib/theme/palette.ts`. `palette.test.ts` asserts the CSS mirrors `palette.ts` exactly
and that every WCAG AA contrast pairing below holds in both themes — tune values in
`palette.ts` first, CSS follows.

### Semantic token table

| Token               | Light     | Dark      | Usage                                                                              |
| ------------------- | --------- | --------- | ----------------------------------------------------------------------------------- |
| `background`        | `#FFFFFF` | `#0B1220` | Page background (`bg-background`).                                                 |
| `surface`           | `#F8FAFC` | `#111A2E` | Card/panel background one step off `background` (`bg-surface`).                    |
| `surface-raised`    | `#FFFFFF` | `#16213A` | Elevated surface — dropdowns, modals (`bg-surface-raised`).                        |
| `foreground`        | `#0F172A` | `#E6EDF7` | Primary body text (`text-foreground`).                                             |
| `muted`             | `#475569` | `#9FB0C7` | Secondary/de-emphasized text (`text-muted`).                                       |
| `border`            | `#E2E8F0` | `#26324A` | Hairline borders and dividers (`border-border`).                                   |
| `brand`             | `#0A357E` | `#0A357E` | Brand **background** band — hero gradient top, solid brand fills (`bg-brand`).     |
| `brand-mid`         | `#0C44A0` | `#2A5CC0` | Brand gradient middle stop (`via-brand-mid`).                                      |
| `brand-royal`       | `#0E4DA4` | `#2A5CC0` | Brand gradient bottom stop / primary brand-blue fills (`to-brand-royal`).          |
| `brand-ink`         | `#0A357E` | `#8AB4F8` | Brand-colored **text** on a content surface (`text-brand-ink`) — see below.        |
| `accent-gold`       | `#F2C200` | `#F2C200` | Crown-gold accent / CTA fill (`bg-accent-gold`) — unchanged across themes.         |
| `accent-gold-hover` | `#FFCE1F` | `#FFCE1F` | Gold hover state (`hover:bg-accent-gold-hover`).                                   |
| `accent-subtle`     | `#E7F0FF` | `#1E2E4A` | Subtle brand-tinted fill — possible-points preview, positive attribute chips.      |
| `water`             | `#5FC5F0` | `#5FC5F0` | Water-cyan decorative accent (glows, celebration droplets).                        |
| `danger`            | `#B91C1C` | `#F87171` | Destructive/error text and borders (`text-danger`) — brightened in dark mode.      |
| `on-brand`          | `#FFFFFF` | `#FFFFFF` | Text/icons placed on a `brand`/`brand-mid`/`brand-royal` background.               |
| `map-canvas`        | `#E9EFE7` | `#0B1220` | MapLibre canvas / loading placeholder background behind the map.                  |
| `star-empty`        | `#CBD5E1` | `#3A4A66` | Empty (unfilled) star fill in the read-only `Stars` rating component.             |

### `brand` vs `brand-ink`

`brand`/`brand-mid`/`brand-royal` are **background** tones for the brand band (hero gradient,
solid brand fills) — they stay a navy family in both themes so white `on-brand` text keeps
AA contrast on them. `brand-ink` is the paired **text** tone for brand-colored headings/links
sitting directly on a content surface (`text-brand-ink` over `background`/`surface`/
`surface-raised`) — the same navy in light mode, but a light blue (`#8AB4F8`) in dark mode,
because navy text cannot meet AA on the dark surfaces.

**Exception:** gold CTA buttons (`bg-accent-gold` + `text-brand`, e.g. Sign-in) intentionally
keep the fixed navy `text-brand` in both themes — gold's brightness doesn't change with
theme, so navy remains the correct (AA) choice there; swapping those to `brand-ink` would
collapse the ratio to roughly 1.2:1 on the light-blue dark value.

### Map paint tokens (`web/lib/map/colors.ts`)

MapLibre paint is applied in JS (not CSS custom properties), so the map's colors are a
separate `MAP_COLORS` constant keyed by resolved theme (`mapColorsFor("light" | "dark")`):

| Field          | Light       | Dark             | Paint target                                    |
| -------------- | ----------- | ---------------- | ------------------------------------------------ |
| `cluster`      | `#0C44A0`   | `#4C82F0`        | `clusters` circle-color                         |
| `clusterStroke`| `#FFFFFF`   | `#0B1220`        | `clusters` circle-stroke-color                  |
| `clusterCount` | `#FFFFFF`   | `#FFFFFF`        | `cluster-count` text-color                      |
| `pillText`     | `#0A357E`   | `#E7F0FF`        | `pins-pill` text-color                          |
| `pillBg`       | `pill-bg`   | `pill-bg-dark`   | `pins-pill` icon-image name (themed sprite)     |
| `halo`         | `#0C44A0`   | `#5FC5F0`        | `selected-halo` circle-color                    |
| `selectedPin`  | `pin-selected` | `pin-selected-dark` | `selected-pin` icon-image name           |
| `ring`         | `#0A357E`   | `#4C82F0`        | Placement-map add-bound ring line-color         |
| `marker`       | `#0A357E`   | `#4C82F0`        | Placement-map draggable marker color            |

Dark values are brightened relative to their light counterparts so pins, labels, and the
selection halo hold contrast against the dark basemap land.

### Theme selection

- **Provider:** `web/app/providers.tsx` wraps the app in `next-themes`' `ThemeProvider`
  (`attribute="class"`, `defaultTheme="system"`, `enableSystem`). `next-themes` injects a
  pre-hydration `<script>` that sets the `.dark` class on `<html>` before first paint, so
  there is no light→dark flash.
- **Class-based variant:** `globals.css` overrides Tailwind v4's default
  `prefers-color-scheme` behavior with `@custom-variant dark (&:where(.dark, .dark *));` so
  every `dark:` utility keys off the `.dark` class rather than the OS media query directly.
- **Default & persistence:** defaults to **System** (follows the OS); the user's explicit
  choice is persisted to `localStorage` by `next-themes` and restored on the next visit.
- **Control:** the `ThemeToggle` component (below) is the only UI for changing it.

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

### SEO place pages (`web/app/drinking-fountains/[country]/page.tsx`, `[country]/[city]/page.tsx`)

Crawlable, server-rendered directory pages for organic search (#127) — the **country** page
(top cities) and the **city** page (ranked fountain list). They share one template.

- **Shell:** the slim `SiteHeader variant="bar"` + a white, constrained column
  (`mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10`) — the same reading shell as the
  leaderboard and fountain-detail pages.
- Small brand-blue (`text-[#0C44A0]`) back link at the top (country → "← Back to the map";
  city → "← All of {CC}").
- **Title:** `h1` in `text-2xl font-black text-[#0A357E]` ("Drinking fountains in {place}"),
  followed by a one-line lead in `text-slate-600` stating the fountain count (city pages add
  "Showing the top N" when the list is capped).
- **List rows:** under an optional `h2` (`text-lg font-bold text-[#0A357E]`), a
  `divide-y divide-slate-100` list. Country "Top cities" rows are a brand-blue underlined `Link`
  to the city page + a right-aligned `text-sm text-slate-500` count. City fountain rows are a
  full-width `Link` to `/fountains/[id]` — fountains have no names, so the label is
  "Drinking fountain" (+ "· Out of order" when not working) with a right-aligned rating
  (`formatAverage` + rating count).
- **Indexability:** the **country** page renders only at/above the gate (`K`) — anything else is
  `notFound()` (404). The **city** page renders even below the gate but is `noindex` (the backend
  returns an `indexable` flag — the single source of `K`); a missing city is `notFound()`. Both set
  a unique title/description + `alternates.canonical` (the sticky slug); a non-canonical city URL
  (e.g. wrong case) `permanentRedirect`s (301) to the canonical.

### SEO attribute pages (`web/components/AttributePage.tsx`)

Crawlable global pages for an attribute filter (#127 Slice 4) — **bottle fillers**
(`/drinking-fountains/bottle-fillers`) and **wheelchair-accessible**
(`/wheelchair-accessible-drinking-fountains`). Structurally identical, so they share one
`AttributePage` component + `buildAttributeMetadata`; each route is a thin file supplying a config
(attribute key, canonical path, heading, copy). The URLs are intentionally different shapes to match
the target search phrase; `bottle-fillers` is a **static** segment so it wins over the sibling
`/drinking-fountains/[country]` dynamic route.

- **Shell / title / rows:** identical to the SEO place pages — the same white `max-w-2xl` reading
  shell, "← Back to the map" link, `h1` in `text-2xl font-black text-[#0A357E]` (the page heading),
  a `text-slate-600` lead with the live count, and the same `/fountains/[id]` ranked list rows
  ("Drinking fountain" + `formatAverage`). Empty state: "No public fountains match this yet".
- **Indexability:** the page always renders (200); the backend's `indexable` verdict (the single
  source of `K_attr`) drives `noindex` — below the gate, zero matches, or a backend error are all
  `noindex` (`{ index: false, follow: true }`) and omitted from the sitemap. Unique
  title/description + `alternates.canonical`.

### Near-me hub (`web/app/drinking-fountains-near-me/page.tsx`)

A static hub (`/drinking-fountains-near-me`, #127 Slice 4) — always indexable, no per-place
thin-content risk. Same reading shell. A prominent solid brand-blue CTA
(`rounded-lg bg-[#0C44A0] px-4 py-2 font-bold text-white`, "Open the map near you") deep-links into
the map (which geolocates the visitor), followed by "Popular cities" (the busiest country's top
cities) and a "Browse by country" wrap list — crawlable internal links. Degrades to just the CTA
when no places are loaded.

### Fountain-detail SEO metadata (`web/app/fountains/[id]/page.tsx`)

The individual fountain detail page (#127 Slice 5) gains `generateMetadata` + a city-aware `h1`,
both driven by the **public** `GET /api/v1/fountains/{id}/place` endpoint only — never the
viewer/admin detail path, so a signed-in or admin viewer can't change the SEO output.

- **Title / canonical:** `Drinking fountain in {city}` (or `Public drinking fountain` when no city
  resolves) + `alternates.canonical = /fountains/[id]`, plus a matching description + OpenGraph.
- **Indexability:** the backend's single §7 predicate (a city resolves, not hidden, and rated OR
  working-and-not-broken) drives `noindex` — below the predicate is `{ index: false, follow: true }`
  (rendered but out of the index); a hidden / unknown / backend-down page is `{ index: false,
follow: false }`. Indexable fountains are listed in `/sitemaps/fountains.xml`.
- **`h1`:** the shared `FountainDetail` takes an optional `locationLabel` so the heading reads
  "Public drinking fountain in {city}" on the public page; it falls back to "Public drinking
  fountain" when no city resolves or on the admin path (which doesn't fetch the public place).

### Fountain detail drawer (`web/components/fountain/DetailOverlay.tsx`)

The intercepted map detail route (`web/app/@modal/(.)fountains/[id]/page.tsx`) uses a full-height
drawer over the map, not a centered modal. The drawer is `h-dvh`, slides in/out with a short
transform transition, and closes from Escape, the close button, or a click/tap on the map backdrop.
On desktop it anchors to the right at a readable fixed width; on narrow screens it occupies the full
viewport width so the same drawer structure carries to mobile web.

The drawer body starts with prominent top tabs (`FountainDetailTabs`): **Info** for the primary
status, rating summary, rating controls, add-photo control, directions, and sharing; **Details** for
attributes, placement context, notes, admin controls, and secondary contribution forms; **Photos**
for the gallery plus another add-photo control. Tab panels own their scrolling so the tabs and close
button stay available throughout long content. When at least one photo exists, the **Info** tab leads
with a full-width tappable **photo hero** (the newest photo) that switches to the **Photos** tab — see
*Photo hero* under *Fountain photos*. The tabs component exposes its `setActive` via a small React
context (`useFountainDetailTabs`) so content inside a panel (the hero) can switch tabs.

**Mobile parity (`mobile/components/fountain/FountainDetailTabs.tsx`).** The native detail screen
mirrors the same three tabs with a segmented control below the screen header. It owns the active-tab
state and exposes `setActive` through the same context shape (so the Info hero can open Photos). All
three tab bodies stay mounted — inactive ones are hidden with `display: "none"` so in-progress form
input and each tab's scroll position survive a switch — and each body owns its own `ScrollView`
carrying the shared pull-to-refresh. Tab buttons use `accessibilityRole="button"` with
`accessibilityState={{ selected }}` and a `"<label> tab"` accessibility label (RN `tab`/`tablist`
roles are intentionally **not** used for portability); the selected tab shows a brand-blue bottom
underline and label. Each tab's contribution controls are wrapped in their own auth-gated
`ContributePanel`, mirroring web's per-tab `ContributeSection` (Info: rate + add photo; Details:
attributes + condition + note; Photos: add photo).

### Auth buttons (`web/components/SignInButton.tsx`, `SignOutButton.tsx`)

Pill-shaped buttons that submit a Next.js server action (`<form action={...}>`).

- **Sign in (primary):** solid crown-gold fill (`bg-[#F2C200]`), navy text
  (`text-[#0A357E]`), `hover:bg-[#ffce1f]`, gold focus ring.
- **Sign out (secondary):** transparent with a `border-white/40` outline, white text,
  `hover:bg-white/10`, white focus ring — for use on the brand gradient.
- Both are `rounded-full`, `px-6 py-2.5`, `text-sm font-semibold`, and carry a visible
  `focus-visible` outline for keyboard users.

### Theme toggle (`web/components/ThemeToggle.tsx`)

A 3-state **System / Light / Dark** control (#18) that lets a visitor override the
OS-driven theme; the choice is persisted (`next-themes` writes it to `localStorage`) and
survives reloads. See "Dark mode & theme tokens" above for the token layer this drives.

**Placement:** the right-hand cluster of `SiteHeader` (between the points badge and
`AuthControl`, on every full-page route) and again in the signed-in body of `/account`
(labelled "Appearance"). The account page renders **two independent instances** at once.

**Structure:** a native radio group — one `<input type="radio">` per option
(System/Light/Dark) inside a `<fieldset>` with a screen-reader-only `<legend>Theme</legend>`.
The radios' shared `name` is a **per-instance `useId()`** value rather than a fixed string,
so the header instance and the account-page instance don't merge into a single native radio
group (which would break each other's selection and keyboard navigation). Each radio is
visually hidden (`sr-only`) behind its glyph (🖥 / ☀ / 🌙); the wrapping `<label>` renders
the glyph and reacts to the hidden radio's state via `has-[:checked]` / `has-[:focus-visible]`.

**Hydration safety:** `theme` from `next-themes` is not reliable until after mount, so the
component reads mounted-state via `useSyncExternalStore` (server snapshot `false`, client
snapshot `true`) — **not** a mount `useEffect` + `setState`, which the project's
`react-hooks/set-state-in-effect` lint rule forbids. Before mount it renders a same-size,
non-interactive, `aria-hidden` placeholder (`height: 32, width: 96`) so there is no layout
shift and no hydration mismatch; it swaps to the real control immediately after mount.

**Style:** translucent-white pill on the brand gradient (`border-white/30 bg-white/10`) —
the same family as the header search box and the analytics-consent Decline button — legible
on the header's blue background without competing with gold primary actions.

**States:**

| State                    | Styling                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| Default                  | `hover:bg-white/10`                                              |
| Checked (active option)  | `has-[:checked]:bg-white/25 has-[:checked]:font-semibold`         |
| Keyboard focus           | `has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70`  |

**Accessibility:** native `<input type="radio">`s in a `<fieldset>`/`<legend>` give the
browser's built-in radiogroup semantics and keyboard behavior (arrow keys move the selection,
Tab enters/exits the group) for free; each option's radio carries its own `aria-label`
("System"/"Light"/"Dark") so the glyph-only visible label still has an accessible name; the
focus-visible ring is always shown for keyboard users.

```tsx
<fieldset className="inline-flex items-center rounded-full border border-white/30 bg-white/10 p-0.5 text-white">
  <legend className="sr-only">Theme</legend>
  <label className="flex h-7 w-8 cursor-pointer items-center justify-center rounded-full text-sm transition hover:bg-white/10 has-[:checked]:bg-white/25 has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70">
    <input
      type="radio"
      name={groupName}
      value="dark"
      checked={theme === "dark"}
      onChange={() => setTheme("dark")}
      aria-label="Dark"
      className="sr-only"
    />
    <span aria-hidden="true">🌙</span>
  </label>
  {/* …System (🖥), Light (☀) siblings, same shape… */}
</fieldset>
```

### Account panel (`web/app/account/page.tsx`)

The authenticated utility page (the BFF round-trip surface), on the brand gradient
(`min-h-dvh`, centered). States: signed-out (heading + copy + Sign in); signed-in
(heading + a `name`/`email` definition list + the **Display name field** + Sign out); a
profile-load error (heading + Sign out); and the **first-sign-in name gate** (below) when
the account still resolves to "Anonymous" (`needs_name`). Not linked from the marketing hero;
reached via the footer "Sign in" link (or the header "Finish setup" prompt).

### Display name field + first-sign-in name gate (`web/components/account/DisplayNameForm.tsx`, `mobile/components/account/DisplayNameForm.tsx`)

A single **"Display name"** field — one form, two variants — used on the account surface of both
clients. It saves the user's chosen name (stored backend-side as a `nickname` override) via
`PATCH /api/v1/me`; on success it refreshes so the resolved name (and `needs_name`) update.

- **Change-name variant (`required={false}`):** a labelled text input pre-filled with the current
  display name (the IdP name if present, else blank), `maxLength={80}`, with a **Save** button. Shown
  in the normal signed-in account view alongside the profile.
- **First-sign-in gate variant (`required`):** shown on its own (no other account body, no dismiss —
  only Sign out escapes) when the resolved public name is "Anonymous". Adds a heading ("Choose a
  display name") + one line of helper copy, a blank input, and a **Continue** button. This is the
  hard gate: a name-less account is routed here after sign-in and cannot contribute until a name is
  set (the backend also rejects contribution writes with `409 display_name_required`).
- **Styling:** web uses the gradient-surface tokens (white label, `bg-white/10` input, crown-gold
  `bg-[#F2C200]` navy-text button); mobile uses the theme tokens (`colors.surface` input,
  `colors.brandYellow` button) matching the account tab.
- **States:** default; **saving** (button reads "Saving…", input disabled); **validation error**
  ("Please enter 1–80 characters." — also enforced server-side); **server error**. The button is
  disabled while saving or when the trimmed value is empty.
- **Accessibility:** the input is label-associated ("Display name"); the button exposes a disabled
  state; status/error text is announced (`role="status"`, `aria-live="polite"` on web).
- **Mobile root gate (`mobile/app/(tabs)/_layout.tsx`):** because sign-in can begin from the map, a
  mounted watcher routes an authenticated, still-name-less user to the Profile tab's gate variant.

### Admin moderation controls (`web/components/admin/FountainAdminControls.tsx`)

Inline-only admin panel rendered on fountain detail pages for `viewer.isAdmin`.

- Placement: below community notes and above contribution controls, separated by a simple
  top border (`border-t border-slate-200 pt-4`) rather than a nested page card.
- Edit form: compact gray field group (`rounded-lg border border-slate-200 bg-slate-50 p-3`)
  with native number inputs for latitude/longitude, a select for working state, and textareas
  for placement note/comments.
- Actions: primary save uses brand navy fill; hide/unhide uses a navy outline; destructive
  delete is a two-step confirm with red outline first and solid red confirm.
- Note moderation: repeated note rows use small bordered items with compact outline buttons;
  hidden state is shown in muted note metadata.

### Analytics consent banner (`web/components/analytics/ConsentBanner.tsx`)

A fixed bottom bar that asks the visitor to accept or decline analytics before any Google Analytics
is loaded (consent-gated, path-only GA4 — see
`docs/specs/2026-06-30-ga4-web-analytics-design.md`). Mounted site-wide from the root layout via the
`AnalyticsConsent` coordinator, which owns the consent state and only renders the banner while the
choice is still pending **and** the app is in production on the canonical host.

**Placement & style:**

```tsx
<div
  role="region"
  aria-label="Analytics consent"
  className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0A357E] px-4 py-3 text-white shadow-[0_-4px_16px_rgba(0,0,0,0.25)]"
>
  <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-sm leading-relaxed text-white/90">
      {" "}
      …copy… <Link href="/privacy">Privacy Policy</Link>.{" "}
    </p>
    <div className="flex shrink-0 items-center gap-2">
      <button type="button">Decline</button> {/* white-outline secondary */}
      <button type="button">Accept</button> {/* crown-gold primary */}
    </div>
  </div>
</div>
```

- Full-width navy bar pinned to the bottom (`fixed inset-x-0 bottom-0 z-50`, `bg-[#0A357E]`, white
  text, top border + upward shadow so it reads as an overlay on both the map and the white legal
  pages).
- **Accept (primary):** crown-gold pill (`bg-[#F2C200]` navy text, `hover:bg-[#ffce1f]`, gold focus
  ring) — same primary affordance as the Sign-in button.
- **Decline (secondary):** transparent white-outline pill (`border-white/40`, white text,
  `hover:bg-white/10`, white focus ring) — same secondary treatment as Sign-out.
- A short line of copy plus a `next/link` to `/privacy`.

**States** (the banner itself is stateless; visibility is controlled by `AnalyticsConsent`):

| State           | Behaviour                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Shown           | Choice is undecided (prod + canonical host). Banner visible; GA not loaded.                                                        |
| Accepted→hidden | Accept persists `granted`; banner unmounts; GA loads. **Fail-closed:** if the write throws, the banner stays and GA does not load. |
| Declined→hidden | Decline persists `denied`; banner unmounts; nothing loads, no GA cookies.                                                          |

**Accessibility:** `role="region"` + `aria-label="Analytics consent"`; both actions are real
`<button type="button">`s (keyboard-focusable with visible `focus-visible` rings); the bar does not
trap focus or block the page — it is dismissed only by choosing Accept or Decline.

---

### Fountain share button (`web/components/fountain/ShareButton.tsx`, `mobile/components/fountain/FountainDetail.tsx`)

Lets a viewer share a fountain's public URL from its detail page (#168).

- **Web:** a pill button (`rounded-full border border-[#cdd6e6] bg-white text-[#0A357E]`). On tap it
  uses the Web Share sheet when available (mobile browsers); on desktop it copies the canonical
  fountain URL to the clipboard and **shows feedback** — the label swaps to "Link copied!" for ~2s
  (or "Couldn't copy" on failure), so it never looks inert. `aria-live="polite"` announces the
  change; a user-cancelled native share sheet (`AbortError`) stays silent.
- **Mobile:** a secondary pill next to **Directions** in the detail actions row
  (`colors.surface` fill, `colors.border` outline, `colors.brandBlue` text — the same shape as the
  gold **Directions** button, in the secondary treatment). It invokes the native `Share.share` sheet
  with the fountain's **web** URL (`<webBaseUrl>/fountains/<id>`); the payload is platform-aware —
  `{ url }` on iOS, `{ message }` on Android (whose sheet ignores `url`). `accessibilityRole="button"`
  - `accessibilityLabel="Share this fountain"`.

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
| Top row    | Wordmark + points/profile | Full-width `flex items-center justify-between`; right controls align to page edge |
| Hero copy  | `<h1>` + supporting `<p>` | `max-w-2xl`, `mt-5 sm:mt-6`                                                       |
| `<main>`   | Map region                | `relative flex-1` — grows to fill remaining viewport                              |
| `<footer>` | Reversed gradient footer  | `from-[#0E4DA4] to-[#0A357E]`, copyright + Privacy / Terms / Sign-in links        |

**Hero band details:**

- Wordmark: `next/image`, `w-[min(48vw,320px)] sm:w-[min(60vw,320px)]`, `drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]`, `priority`.
- Sign-in link: gold pill (`bg-[#F2C200] text-[#0A357E] rounded-full`), `hover:bg-[#ffce1f]`, `focus-visible:outline-[#F2C200]`, `shrink-0` so it never wraps under the logo.
- Headline: `text-2xl font-bold leading-tight text-balance sm:text-3xl md:text-4xl`.
- Supporting copy: `text-sm sm:text-base leading-relaxed text-white/80 text-balance`.

**Map region (`<main>`):** `relative flex-1` — the map canvas fills this area completely. `MapBrowserLoader` lazy-loads `MapBrowser` (no SSR) and renders a green-tinted placeholder (`bg-[#e9efe7]`) while the JS bundle loads.

**Footer:** `text-xs text-white/60`; links have `hover:text-white hover:underline underline-offset-4`. Optional mobile-store links render as compact black translucent badges when their public store URLs are configured.

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

### Draft pin (mobile add-fountain)

While the mobile app is in add mode, the pin the user is placing is drawn by a separate
`draft-fountain` source/layer in `mobile/components/map/FountainMap.tsx`, distinct from the
saved-fountain pins so the in-progress placement reads as provisional:

- **Asset:** reuses `pin-standard` (raster icons can't be tinted via `icon-color`).
- **Distinction:** larger and translucent — `icon-size: 0.72` (vs `0.5` for saved pins) and
  `paint: { "icon-opacity": 0.6 }`. The size + transparency together signal "not yet saved."
- **Visibility:** rendered **only** in add mode (the screen passes `draftPin` only while
  `addMode`), so the no-`onPress` draft layer never sits over a real pin and swallows taps
  after a successful add.
- **Future option:** a dedicated grayscale `pin-draft.png` could replace the opacity treatment
  if a stronger visual distinction is wanted.

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

- The header row is full-width, not a centered max-width container: the profile/avatar/auth control
  sits at the far right edge of the header, with the authenticated points badge immediately to its
  left.
- The points badge is part of the header chrome, not a map overlay, so it never collides with
  MapLibre's top-right zoom/geolocate controls.
- On narrow web widths authenticated users still get a compact visible points badge so the
  leaderboard remains reachable; signed-out users do not get an empty points shell.
- **`HeaderSearch` (see below) is ever-present** between the logo and the points/auth cluster, in
  both the `hero` and `bar` variants — a non-map page has no map of its own, so selecting a result
  always navigates to `/` with the recenter target encoded in the URL (design doc §4.2).

**Responsive layout (design doc §4.1):** the header row is `flex flex-wrap items-center
justify-between`. On `md:` and wider, all three clusters share one line — logo (fixed width, left),
search (`md:flex-1 md:max-w-md`, grows to fill the middle, capped), points/auth (fixed width,
`ml-auto`, right). Below `md:`, the search wrapper is `order-3 w-full` — it can never share a line
with the other two (100% flex-basis), so it always wraps onto its **own full-width row below** the
logo/points row, and it is ordered _after_ both (`order-3` vs their default `order-0`) so it never
displaces or gets squeezed between them. The hero tagline `<p>` is a sibling block rendered after
the whole row `<div>`, so it always sits below the row regardless of how many lines the row itself
wraps to — the search row never pushes it out.

### Header search (`web/components/HeaderSearch.tsx`)

The always-visible address/city search box in `SiteHeader`, recentering/zooming the web map on
select (design doc §4.1–§4.3). A client component: an input plus a results dropdown, debounced
(~300 ms, min 3 characters) against the public `GET /api/v1/geocode` proxy via
`lib/search/geocode-client.ts` (no `Authorization` header — the endpoint is public and the
LocationIQ key stays server-side). Mirrors mobile's `SearchOverlay` (same states, same attribution,
same pure `lib/search/state.ts` reducer) adapted from a full-screen overlay to an inline dropdown.

**Input:**

```tsx
<label htmlFor="header-search-input" className="sr-only">
  Search address or city
</label>
<input
  id="header-search-input"
  placeholder="Search address or city"
  role="combobox"
  aria-expanded={showDropdown}
  aria-controls="header-search-listbox"
  aria-autocomplete="list"
  className="w-full rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white placeholder-white/60 outline-none transition focus-visible:border-white focus-visible:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60"
/>
```

The visible `placeholder` and the `sr-only`-labelled `<label>` carry the same "Search address or
city" copy so the accessible name matches what sighted users see.

Translucent-white pill on the brand gradient (same `border-white/40`-family treatment as the
Decline button in the analytics consent banner) — legible on the header's blue background without
competing with the gold primary actions.

**Dropdown (`role="listbox"`, `id="header-search-listbox"`):** an absolutely-positioned panel
(`absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200
bg-white text-left shadow-lg`) — `max-h-80 overflow-auto` caps the panel height and scrolls a long
result list — the same white-card-on-blue-header treatment as the `AuthControl` user menu. Each
result row is a `role="option"` button (`block w-full px-4 py-2 text-left text-sm text-slate-700
hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none`, plus a trailing `bg-slate-50`
when it is the keyboard-highlighted option) showing the result's `label`. Only rendered while the
dropdown is open **and** the search status is not `idle` (i.e. the query has reached the 3-character
minimum) — mirrors mobile: nothing renders below the minimum length, not even an empty panel.

**States** (driven by `lib/search/state.ts`'s `SearchStatus`, identical set to mobile's
`SearchOverlay`):

| State                  | Rendering                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle` (below 3 chars) | Dropdown not rendered at all.                                                                                                                               |
| `loading`              | `role="status"` "Searching…", muted text.                                                                                                                   |
| `empty` (no matches)   | "No matches", muted text.                                                                                                                                   |
| `error`/`unavailable`  | `role="alert"` "Search is unavailable right now", red text — the single v1 error state, covering every documented failure mode (503/502/429/network) alike. |
| `results`              | The result rows, followed by the persistent attribution line (below).                                                                                       |

**Attribution:** shown as the last row whenever results render (never during loading/empty/error) —
"Search by LocationIQ · © OpenStreetMap contributors", the link (`https://locationiq.com/attribution`)
opens in a new tab. Identical copy and link target to mobile (design doc §12).

```tsx
<p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
  <a
    href="https://locationiq.com/attribution"
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold text-[#0C44A0] underline"
  >
    Search by LocationIQ
  </a>
  {" · © OpenStreetMap contributors"}
</p>
```

**Keyboard / dismissal:**

- **Arrow Up/Down** moves a highlighted option (`aria-selected` + `aria-activedescendant` on the
  input); **Enter** selects the highlighted option; **Escape** closes the dropdown without clearing
  the typed query.
- **Click-away:** a document-level `mousedown` listener (identical pattern to `AuthControl`'s user
  menu) closes the dropdown when the click lands outside the search box.
- **Blur/Tab-away:** an `onBlur` on the search box's container checks `relatedTarget` — if focus is
  moving to an element still inside the box (e.g. a result row being clicked), the dropdown stays
  open long enough for the click to register; otherwise it closes. This covers the keyboard-only
  "Tab past the search box" case the mousedown listener can't see.
- Selecting a result (click or Enter) closes the dropdown and calls
  `router.push("/?" + buildFlyToQuery(...))` — see the URL contract in `lib/search/flyto.ts` and
  design doc §4.2/§4.3.

**Responsive layout:** see the "Responsive layout" note under Slim site header above — inline
between logo and points/auth on `md:`+, its own full-width row below them on narrower screens.

### Points badge

Used on the authenticated web and mobile map/home surfaces.

- High-emphasis score treatment: brand-blue background (`#0A357E`), gold border/text
  (`#F2C200`), compact `8px` radius, tabular numeric points.
- Label reads `Points`; the numeric total is the visual focus.
- On entry/update, the badge may pulse or count up once. Respect reduced-motion preferences and
  keep the numeric value visible without animation.
- **Interactive (link/button to the leaderboard, #117).** The badge navigates to the leaderboard
  (web: a real header `<Link>` to `/leaderboard`; mobile: a `Pressable` that pushes `/leaderboard`
  with the map center).
  It is keyboard-focusable with a visible focus ring and a hover affordance, and exposes an
  accessible label like _"View leaderboard — N points"_. When rendered inside a
  `pointer-events-none` overlay (e.g. the contribution overlay), the badge re-enables pointer
  events on itself.

### Leaderboard (`/leaderboard` — `web/app/leaderboard/page.tsx`, `mobile/app/(tabs)/leaderboard.tsx`)

The rankings screen reached from the points badge. Same model on web and mobile (#117).

- **Header:** title `Leaderboard` + a subtitle reflecting the scope ("everywhere" vs "near this
  part of the map"). Web shows a `← Back to the map` link; mobile uses the native stack back.
- **Scope toggle:** a pill segmented control **Global / Near here**. "Near here" only appears when a
  map center is available. Active segment = brand-blue fill (`#0A357E`), white text; inactive =
  muted text. (Web implements each segment as a query-param `<Link>`; mobile as a `Pressable` over
  local state.)
- **Category chips:** a horizontally-scrollable row — `Total` (default) · `Fountains` · `Ratings` ·
  `Verifications` · `Conditions` · `Attributes` · `Notes`. Active chip = brand-blue fill; inactive
  = `surface` fill with `border` outline (matches the map filter chips).
- **List row:** `#rank` (muted, tabular) · display name (truncates) · a right-aligned metric block.
  The metric's big number is the **category count** in category mode (caption = the category noun +
  the user's total points, e.g. `fountains added · 1,234 pts`) or the **total points** on the
  Total board (caption `pts`). `points` is always labelled total points, never "category points".
- **Category leader (crown):** the rank-1 row in the active category/sort is marked with a
  crown-gold (`#F2C200`) crown immediately left of the display name — the MDI `crown` glyph on both
  platforms (web: inline `<svg>`; mobile: `@expo/vector-icons` `MaterialCommunityIcons name="crown"`),
  each carrying the accessible label `Category leader`. It moves with the sort, so only the current
  view's #1 is crowned; ties that share rank 1 are each crowned.
- **You-highlight + sticky "You" overlay:** the signed-in caller's in-list row gets a light-blue
  fill (`#EAF1FF`) + `You` tag (web adds a brand-blue ring). Their rank stays visible even when that
  row is scrolled off-screen — or when they rank below the fetched rows and have no in-list row at
  all — via a **sticky bottom overlay** reading `You — #N` (or _Not yet ranked_ when they have no
  qualifying points in the active scope/category). The overlay hides the moment their real row is on
  screen, reflects the active scope/category, and is never shown to signed-out visitors. Web: a
  `fixed` bottom bar toggled by an `IntersectionObserver` on the in-list row; mobile: an `absolute`
  bottom overlay toggled by the `FlatList` viewability callback, with extra list bottom padding so
  the last rows clear it.
- **Empty state:** `No contributors yet.`

### Possible-points preview

Used in add/rate/condition/note/detail contribution flows.

- Container: light blue fill (`blue-50` / `#EFF6FF`), brand-blue 2px border, `8px` radius.
- Title format: `+N possible points`, bold brand-blue text.
- Supporting lines list each award source in smaller semibold text. Conditional bonus lines append
  `(conditional)`.
- The preview is informational only; form validity still comes from the contribution fields.

### Points-ineligible inline warning (`web/components/fountain/ConditionForm.tsx`, `mobile/components/fountain/ConditionContributionForm.tsx`)

Shown in the condition-report ("Is it working?") flow when the signed-in viewer already earned
points for updating this fountain within the last 24h (#124), so a new condition report will not
earn points. It **replaces** the Possible-points preview for that flow while the limit is active.

- Trigger: `FountainDetail.condition_points_eligible_at` is a future timestamp (per-viewer;
  `null` = eligible now / anonymous). The clients compute this via `conditionPointsBlocked()` in
  `@fountainrank/contributions`.
- Web: an amber inline note — `rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs
  font-semibold text-amber-800` — reading "You've earned points for updating this fountain
  recently — you can still update its status, but it won't earn points again for <duration>."
- The `<duration>` ("about 5 hours" / "about 20 minutes") comes from `conditionPointsEligibleInText()`
  in `@fountainrank/contributions`, computed from `condition_points_eligible_at` — so the warning
  tells the user *when* points return, not just that they're paused.
- Mobile: the same copy in an amber `Text` (`limitNote`: background `#FEF3C7`, text `#92400E`,
  rounded padded), swapped in where the `PointsPreview` would render.
- **Warn, don't block:** this is advisory only — the submit control stays **enabled**; the user can
  still record the status (the data always persists), it simply earns no points this time.
- Accessibility: it is informational text (not an error) and must never be the only signal; it does
  not disable any control.
- It is a **best-effort pre-submit hint** (it can be stale across tabs/devices). The authoritative
  awarded count comes from `condition_points_awarded` on the POST response, which drives the
  post-submit success copy (0 → "already counted recently"; N → "you earned N points").

### Contribution celebration

A short water-squirt/droplet animation shown after successful contribution writes on web and
mobile.

- Droplets use Water cyan (`#5FC5F0`) with a white edge and animate upward from the lower center of
  the active surface.
- The animation is decorative (`aria-hidden` on web) and must not be the only success signal.
- Respect reduced-motion settings: suppress the droplet motion while still showing the normal
  success message and refreshed points total.

### Mobile placement toast

Used for add-fountain placement errors, especially out-of-area taps.

- Error toast: red-tinted surface (`#FEE2E2`) with danger border (`#B91C1C`), `8px` radius, bold
  readable body text.
- Appears near the top of the map, auto-dismisses, and announces through accessibility APIs.
- Use for actionable placement feedback; keep inline panel messages for form submission errors.

**Variants** — controlled by a `variant: "hero" | "bar"` prop:

| Variant | Use                                                                    | Extra content                                                       |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `hero`  | Map page (`/`)                                                         | One-line tagline "Find a drinking fountain near you." below the bar |
| `bar`   | All other full-page routes (`/account`, `/admin`, fountain standalone) | Bar only — no tagline                                               |

**Structure:**

```
<header class="bg-gradient-to-b from-[#0A357E] to-[#0E4DA4] px-6 py-3 text-white">
  <div class="flex w-full flex-wrap items-center justify-between gap-3">
    <!-- Wordmark link (left, fixed width) -->
    <a href="/" aria-label="FountainRank home" class="shrink-0">
      <img src="/fountainrank-logo.png" alt="FountainRank" class="h-9 w-auto" />
    </a>
    <!-- HeaderSearch (center on md:+, own row below on narrower screens) -->
    <div class="order-3 w-full md:order-none md:w-auto md:max-w-md md:flex-1">
      <HeaderSearch />
    </div>
    <!-- Points badge (when authenticated) + AuthControl (right, fixed width) -->
    <div class="ml-auto flex shrink-0 items-center gap-3">
      <HeaderPoints initialTotalPoints={totalPoints} />
      <AuthControl viewer={viewer} />
    </div>
  </div>
  <!-- hero variant only -->
  <p class="mt-2 text-sm font-semibold sm:text-base">
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

A client component placed in the top-right of `SiteHeader`. Renders one of three affordances
depending on the viewer state produced by `getViewer()`. When the signed-in account still resolves
to "Anonymous" (`viewer.needsName`), it shows a gold **"Finish setup"** pill linking to `/account`
(the name gate) instead of the avatar menu — and never renders the (empty) name, so the raw Logto
subject is never exposed.

#### Sign-in button (signed-out state)

Displayed when `viewer.state === "anonymous"`. A gold pill button inside a `<form>` that
triggers `signInWithReturn` (a server action that stores the current path in a cookie and
redirects to Logto, returning the user to the page they signed in from).

```tsx
<form action={signInWithReturn.bind(null, returnTo)}>
  <button
    type="submit"
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#F2C200] px-5 py-2 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f]"
  >
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
  {avatarUrl ? (
    <img src={avatarUrl} alt="" width={36} height={36} className="h-9 w-9 object-cover" />
  ) : (
    <span aria-hidden="true">{initial}</span>
  )}
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

| Item                                          | Condition                       | Target          |
| --------------------------------------------- | ------------------------------- | --------------- |
| Display name (non-interactive header)         | Always (authed)                 | —               |
| "Couldn't load your account."                 | `viewer.state === "error"` only | —               |
| **Your account** (`role="menuitem"`)          | Always                          | `/account`      |
| **Admin** (`role="menuitem"`)                 | `viewer.isAdmin === true` only  | `/admin`        |
| Divider (`border-t border-slate-100`)         | Always                          | —               |
| **Sign out** (`role="menuitem"`, form submit) | Always                          | `signOutAction` |

**Behavior:**

- Opens on avatar button click; `aria-expanded` toggles.
- Closes on: outside click, `Escape` key, or menu item activation.
- On open: focus moves to the first `role="menuitem"` element.
- On close (Escape or outside-click): focus returns to the avatar button.
- Admin item is **rendered only when `viewer.isAdmin`** — hiding it is cosmetic; `/admin` re-checks
  server-side and fails closed regardless.
- Error state (`viewer.state === "error"`) shows a degraded menu: name header omitted, amber
  "couldn't load" note shown, **no Admin item**, Account + Sign out remain.

### Homepage footer + store links

The map page `<footer>` carries the low-emphasis utility links plus optional mobile-store links.

```
© {year} FountainRank · <a>Privacy</a> · <a>Terms</a> · [store badges when configured]
```

- Footer text: `text-xs text-white/60`; links use `hover:text-white hover:underline underline-offset-4`.
- `MobileStoreLinks` reads `NEXT_PUBLIC_APP_STORE_URL` and `NEXT_PUBLIC_GOOGLE_PLAY_URL`; each missing
  URL hides that store badge so the footer never renders dead placeholders before listings are live.
- Store badges use official wording (`Download on the App Store`, `Get it on Google Play`) in compact
  rounded dark badges with accessible external-link labels and `rel="noopener noreferrer"`.

### `/admin` placeholder page (`web/app/admin/page.tsx`)

A server-gated page that **fails closed**: any non-admin visitor never sees admin content.

**Gate logic:**

| `getViewer()` result        | Outcome                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anonymous`                 | Renders a "Sign in to access the admin tools." prompt + Sign-in button (form submitting `signInWithReturn("/admin")`). Does NOT redirect or mutate cookies during render. |
| `authed` + `isAdmin: false` | `notFound()` — 404, does not reveal the route exists.                                                                                                                     |
| `error`                     | Renders "Couldn't verify admin access — please try again." No admin content, no 404.                                                                                      |
| `authed` + `isAdmin: true`  | Renders the stub page (see below).                                                                                                                                        |

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
below) in place of the old standalone status chip; the **attribute consensus** group; a
single creator comment/context block (legacy `placement_note` text is used only when
`comments` is empty); the **community notes** section; and the **Contribute section** at the
bottom (auth-gated write controls).

| Element                | Styling                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading                | `text-lg font-bold text-[#0A357E]`                                                                                                                                                                                                                                                                                  |
| Status chip            | Pill badge: working → `bg-emerald-100 text-emerald-800`; out of order → `bg-red-100 text-red-800`. `rounded-full px-2.5 py-0.5 text-xs font-bold`.                                                                                                                                                                  |
| Overall rating         | Large score `text-3xl font-extrabold text-[#0A357E]` (`formatAverage()`) beside a read-only **`Stars`** row (size 18) + vote count `text-xs text-slate-500`. Unrated → empty `Stars` row + "Not yet rated". See _Read-only stars_ below.                                                                            |
| Per-dimension list     | `<dl>` (`space-y-2 border-t border-slate-100 pt-3`); each row: dimension name `text-sm font-medium text-slate-700`, a read-only **`Stars`** row (size 14) + numeric value `font-semibold tabular-nums text-[#0A357E]` + `(votes)`, and a full-width **meter** below. Unrated dimension → "Not yet rated", no meter. |
| Notes / comments       | `rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`.                                                                                                                                                                                                                                        |
| Meta line              | Added / last-rated dates, `text-xs text-slate-400`.                                                                                                                                                                                                                                                                 |
| Directions button      | Gold pill: `rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]`. Links to Google Maps directions.                                                                                                                                                                                                 |
| Share button           | Outlined pill: `rounded-full border border-[#cdd6e6] bg-white px-4 py-2 text-sm font-bold text-[#0A357E]`. Uses `navigator.share` when available; falls back to `navigator.clipboard`.                                                                                                                              |
| **Contribute section** | Bottom of panel; heading `text-base font-semibold text-[#0A357E]`; signed-out prompt or three grouped forms (see below).                                                                                                                                                                                            |

#### Read-only stars, dimension meter & hero (`Stars.tsx`)

The read-only **`Stars`** component (web `web/components/fountain/Stars.tsx`, mobile
`mobile/components/fountain/Stars.tsx`) renders a 0–5 rating as five stars — **gold `#F2C200`**
filled, **slate `#CBD5E1`** empty — rounded to the nearest half star.

- **Web:** five inline SVG stars; a half star is a 50/50 `linearGradient` (gold→slate), driven by
  `starFills(value)` (each star `full`/`half`/`empty`, exposed via `data-fill` for tests).
- **Mobile:** a slate base `★★★★★` row with a gold `★★★★★` overlay clipped to `width: (roundHalf/5)%`
  (fractional fill, same nearest-half rounding as web). No SVG, no extra dependency.
- **A11y:** the row is decorative — web `role="img"` + numeric `aria-label` (e.g. "Rated 3.5 out of
  5", or a custom `label` like "Clarity rated 4.0 out of 5"); RN `accessibilityRole="image"` +
  `accessibilityLabel`. The numeric value is always shown alongside the stars.

**Hero block:** big overall score (web `text-3xl font-extrabold text-[#0A357E]`, RN `fontSize: 34`)
beside a size-18/20 `Stars` row and the vote count; unrated shows an empty `Stars` row + "Not yet
rated" (`text-sm/typography.body font-semibold` muted).

**Dimension meter:** a full-width track (`h-1.5 rounded-full bg-slate-100`; RN `height: 6`,
`backgroundColor: colors.border`) with a **royal-blue `#0E4DA4`** fill of `width = score/5`.
Decorative (`aria-hidden`); the numeric value carries the meaning. Omitted for unrated dimensions.

#### Status block (`StatusBlock.tsx`)

A small stack under the detail heading: a status **chip**, an optional **advisory line**, and a
**trust line**.

- **Chip** — driven by the fountain's `current_status` for the corroborated categories, and by the
  `is_working` baseline otherwise:
  | `current_status`                                            | Label                                 | Tone                                        |
  | ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
  | `ok`                                                        | "Verified working"                    | emerald (`bg-emerald-100 text-emerald-800`) |
  | `degraded`                                                  | "Working — issues reported"           | amber (`bg-amber-100 text-amber-800`)       |
  | `not_working`                                               | "Not working"                         | red (`bg-red-100 text-red-800`)             |
  | `reported_issue`                                            | baseline ("Working" / "Out of order") | emerald / red                               |
  | `null` / unexpected                                         | baseline ("Working" / "Out of order") | emerald / red                               |
  | Chip shape: `rounded-full px-2.5 py-0.5 text-xs font-bold`. |
- **Advisory line** — only for `reported_issue` (a non-flipping advisory): `text-xs text-amber-700`
  with a decorative `aria-hidden` ⚠, "Issue reported recently — not yet confirmed". The baseline
  chip is preserved so the working/out-of-order distinction is never lost.
- **Trust line** — `text-xs text-slate-400`: "Last verified {relative}" (relative time, with a
  precise day-resolution date in the `title`) when `last_verified_at` is set, else "Not yet
  verified by anyone".

#### Attribute consensus (`AttributeList.tsx` + `AttributeChips.tsx`)

Observed attributes grouped by category (group heading: `text-xs font-semibold uppercase
tracking-wide text-slate-500`; category labels physical→"Features", accessibility→"Accessibility",
access→"Access"; unknown categories title-cased). Each attribute renders as a **chip**
(`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium`, wrapped in a
`flex flex-wrap gap-1.5` row) carrying a `data-variant` from `attributeChipVariant()`:

| Variant    | When                                                | Glyph | Style                                                  |
| ---------- | --------------------------------------------------- | ----- | ------------------------------------------------------ |
| `positive` | high-confidence "Yes" (feature present)             | ✓     | `bg-[#E7F0FF] text-[#0A357E] ring-1 ring-[#0E4DA4]/20` |
| `negative` | high-confidence "No"                                | ✕     | `bg-slate-100 text-slate-500 ring-1 ring-slate-200`    |
| `neutral`  | high-confidence specific value; label `name: value` | •     | same blue-tint as `positive`                           |
| `mixed`    | contested consensus                                 | ~     | `bg-amber-50 text-amber-700 ring-1 ring-amber-200`     |
| `muted`    | low-confidence consensus or all-unknown             | •     | `bg-slate-50 text-slate-400 ring-1 ring-slate-200`     |

**Confidence wins:** `attributeChipVariant()` returns `muted` for any low-confidence consensus or
all-unknown attribute (tone `muted`) so it is never promoted to a confident `positive`/`negative`
chip — only high/medium-confidence values map by polarity. The chip label is the attribute **name**
for confident booleans (the glyph conveys yes/no); `neutral` and `muted` chips append `: value` so
the de-emphasized value stays legible. The confidence **hint** from `attributeDisplay()`
(low-confidence `(N reports)`, mixed `latest: …`) is preserved as trailing `text-[10px] opacity-70`
text. No raw vote tallies. Mobile mirrors this with RN `View` chips (`CHIP_BG`/`CHIP_FG`/`GLYPH`
maps keyed by the same variant). The `attributeChipVariant` + `starFills` helpers live in
`lib/map/format.ts` (duplicated web/mobile) and are unit-tested.

#### Community notes (`NotesList.tsx`)

A "Community notes" section (heading styled as the attribute group heading). Each note is a card
(`rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700`) with the body, then a
`text-xs text-slate-400` byline "— {author_display_name} · {relative time}" plus "· edited" when the
note was edited. The section is omitted entirely when there are no notes. The author is always the
backend's safe public `author_display_name`. User-generated free text (note body and
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
    <button
      type="submit"
      className="mt-3 rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
    >
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
      <span className="sr-only">
        {dimension.name}: {n} star{n > 1 ? "s" : ""}
      </span>
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
<button
  type="button"
  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
>
  I checked — it's working
</button>
```

Submits `{ status: "working", is_proximate: false }` immediately on click (no disclosure needed).

**Secondary action — "Report a problem" disclosure:**

```tsx
<button
  type="button"
  aria-expanded={open}
  className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-700"
>
  Report a problem
</button>
```

- `aria-expanded` toggles when the disclosure opens/closes.
- When expanded, reveals a `<select>` with the seven problem statuses (friendly labels from
  `conditionStatusLabel`):

| `ConditionStatus`      | Label                          |
| ---------------------- | ------------------------------ |
| `broken`               | "Broken / not working"         |
| `low_pressure`         | "Low water pressure"           |
| `dirty`                | "Dirty"                        |
| `bad_taste`            | "Bad taste"                    |
| `blocked`              | "Blocked / clogged"            |
| `seasonal_unavailable` | "Shut off for the season"      |
| `hours_limited`        | "Only available certain hours" |

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
  <button
    type="submit"
    className="mt-2 rounded-full bg-[#0C44A0] px-4 py-2 text-sm font-bold text-white hover:bg-[#0A357E] disabled:opacity-50"
  >
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

| State       | UI                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| **Idle**    | Controls enabled; no status message.                                                                               |
| **Pending** | All controls disabled; submit button text changes (e.g. "Submitting…"). `useTransition` in-flight indicator.       |
| **Success** | Controls re-enabled (or form resets); an inline `<p role="status">` confirmation message appears below the button. |
| **Error**   | Controls re-enabled; an inline `<p role="status" aria-live="polite">` error message appears below the button.      |

**Error message copy by `ContributeError`:**

| Error             | Message                                    |
| ----------------- | ------------------------------------------ |
| `unauthenticated` | "Your session expired — sign in again."    |
| `not_found`       | "This fountain is no longer available."    |
| `validation`      | "Invalid input — please check your entry." |
| `server`          | "Couldn't save — please try again."        |

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

| State                           | Rendering                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `!webglOk`                      | Returns `null` — not rendered at all.                                                                                              |
| Signed out (`!isAuthenticated`) | Wrapped in a `<form action={signInWithReturn.bind(null, "/?add=1")}>` so clicking submits the server action (no client JS needed). |
| Signed in (`isAuthenticated`)   | Plain `<button type="button" onClick={onEnter}>`.                                                                                  |

**Styles:**

```tsx
className =
  "absolute bottom-24 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#F2C200] px-4 py-3 text-sm font-bold text-[#0A357E] shadow-lg transition hover:bg-[#ffce1f]";
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

| Phase        | Panel content                                                                          | Primary action                                      |
| ------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `placing`    | Instruction text + optional GPS fallback note + coordinate readout + keyboard controls | "Next: details" (disabled until `pin && placeable`) |
| `details`    | Coordinate readout + working-status toggle                                             | "Add fountain" (`onSubmit`)                         |
| `submitting` | `role="status"` "Adding…"                                                              | —                                                   |
| `done`       | `role="status"` "Fountain added."                                                      | —                                                   |
| `duplicate`  | `role="status"` "A fountain already exists here." + "View it" link                     | —                                                   |
| `error`      | `role="status"` error copy + retry or sign-in affordance                               | "Try again" / "Sign in"                             |

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

| Control         | Button label          | `aria-label`  | Action                                                               |
| --------------- | --------------------- | ------------- | -------------------------------------------------------------------- |
| Place at center | "Place at map center" | same          | Calls `onPlaceAtCenter`; drops/moves pin to the map's current center |
| Nudge N         | ↑                     | "Nudge north" | Calls `onNudge("n")`                                                 |
| Nudge S         | ↓                     | "Nudge south" | Calls `onNudge("s")`                                                 |
| Nudge E         | →                     | "Nudge east"  | Calls `onNudge("e")`                                                 |
| Nudge W         | ←                     | "Nudge west"  | Calls `onNudge("w")`                                                 |
| Next            | "Next: details"       | same          | Calls `onNext`                                                       |

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
  <p role="status" className="text-sm text-slate-700">
    A fountain already exists here.
  </p>
  <Link
    href={`/fountains/${duplicateId}`}
    className="inline-block rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
  >
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

---

## PR-2 add-fountain optional fields (slice 6b-2)

### Star-group (`StarGroup`)

A reusable 1–5 star radio group extracted from `RatingForm` into
`web/components/fountain/StarGroup.tsx`. Used both in the existing rating form and in
the add-fountain optional-fields details step.

```tsx
<fieldset className="flex items-center justify-between py-1">
  <legend className="text-sm">{name}</legend>
  <span className="flex gap-1">
    {[1, 2, 3, 4, 5].map((n) => {
      const inputId = `dim-${id}-star-${n}`;
      return (
        <span key={n} className="inline-flex">
          <input
            type="radio"
            id={inputId}
            name={`dim-${id}`}
            value={n}
            checked={value === n}
            aria-label={`${name}: ${n} star${n > 1 ? "s" : ""}`}
            onChange={() => onChange(n)}
            className="peer sr-only"
          />
          <label
            htmlFor={inputId}
            aria-hidden="true"
            className={`cursor-pointer text-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#0A357E] ${
              value >= n ? "text-[#F2C200]" : "text-slate-300"
            }`}
          >
            ★
          </label>
        </span>
      );
    })}
  </span>
</fieldset>
```

- Radio inputs are visually hidden (`sr-only`) — the `★` label is the visible affordance.
- Each radio carries `aria-label="{name}: {n} star(s)"` for screen readers.
- Input IDs are `dim-{id}-star-{n}`; the radio group name is `dim-{id}`.
- Gold fill (`text-[#F2C200]`) for selected-and-below; slate for unselected.
- Focus ring on the visible label via `peer-focus-visible:outline`.
- `value === 0` (no selection) shows all stars in slate.

---

### Attribute Yes/No/Unknown controls (`AttributeObservationFields`)

Boolean attributes render as three inline radio buttons (Yes / No / Unknown); enum
attributes render as a `<select>`. Grouped by `category` in a `<fieldset>` with a
small-caps `<legend>`.

**Boolean radio row:**

```tsx
<span className="flex gap-2 text-xs">
  {["yes", "no", "unknown"].map((opt) => (
    <label key={opt} className="flex items-center gap-1">
      <input
        type="radio"
        name={`attr-${c.id}`}
        aria-label={`${c.name}: ${opt}`}
        checked={v === opt}
        onChange={() => onChange(c.id, opt)}
      />
      {opt}
    </label>
  ))}
</span>
```

**Enum select:**

```tsx
<select
  aria-label={c.name}
  value={v}
  onChange={(e) => onChange(c.id, e.target.value)}
  className="rounded border border-slate-300 px-2 py-1 text-sm"
>
  {c.options.map((opt) => (
    <option key={opt} value={opt}>
      {opt}
    </option>
  ))}
</select>
```

- Default value for all controls is `"unknown"` (not pre-committed).
- Unknown observations are excluded from the submitted payload (never sent to the API).
- The category `<legend>` uses `text-xs font-semibold uppercase text-slate-500`.
- Section heading: `"Details (optional)"`, `text-sm font-semibold text-slate-700`.
- Graceful-skip: if the API returns an empty list the section is hidden (`return null`).

---

### Comment textarea and More Details (add-fountain details step)

The add-fountain details step exposes basic details first: working status, rating
dimensions, one optional `Comment` field, live points preview, and submit/back actions.
Secondary structured observations sit behind a `More Details` button.

**Comment textarea** (cap: 1000 characters):

```tsx
<label className="mt-3 block">
  <span className="text-sm font-semibold text-slate-700">Comment (optional)</span>
  <textarea
    maxLength={1000}
    value={comments}
    onChange={(e) => onComments(e.target.value)}
    rows={3}
    className="mt-1 w-full rounded border border-slate-300 p-2 text-sm"
    placeholder="Describe the fountain…"
  />
  <span className="text-xs text-slate-400">{comments.length}/1000</span>
</label>
```

- Comment is the only user-facing free-text field in add/contribution flows.
- Whitespace-only values are treated as empty and omitted from the API payload.
- `More Details` is a bordered secondary action. It reveals access, indoor/outdoor,
  venue, bottle-filler, wheelchair, and other structured attribute controls.
- Points preview is a compact bordered surface showing the possible point total and
  each selected contribution line; conditional bonuses are labelled as conditional.

---

### Rating fields section (`RatingFields`)

Renders one `StarGroup` per `RatingTypeOut` in the add-fountain details step.

```tsx
<div className="mt-3 space-y-1">
  <p className="text-sm font-semibold text-slate-700">Rate it (optional)</p>
  {types.map((t) => (
    <StarGroup
      key={t.id}
      id={t.id}
      name={t.name}
      value={value[t.id] ?? 0}
      onChange={(s) => onChange(t.id, s)}
    />
  ))}
</div>
```

- Section heading: `"Rate it (optional)"`, `text-sm font-semibold text-slate-700`.
- Graceful-skip: if the API returns no rating types the section is hidden (`return null`).
- Unrated dimensions (`value === 0`) are excluded from the submitted payload.

---

## Fountain photos (PR 2)

Spec for the photo carousel, report dialog, list-row thumbnail, admin moderation queue, and
pending-report badge (`docs/specs/2026-07-04-fountain-photos-design.md` §11–13). Drafted
**before** the components (W2b) per the style-guide house rule, then reconciled (W9) against
the shipped W3–W8 implementation — the markup/classes below are what actually ships, not the
pre-UI draft. Reuses the existing detail-panel, form, and admin-controls tokens above — no
new design language.

### Photo hero (`web/components/fountain/PhotoHero.tsx`, `mobile/components/fountain/PhotoHero.tsx`)

The single newest photo, shown full-width at the **top of the Info tab** on both web and mobile when
at least one photo exists — the only photo shown on Info; the full set lives on the Photos tab. It is
a button/`Pressable` (`accessibilityRole="button"`, accessible label `"See all N photos"`, pluralized)
that switches to the **Photos** tab via the `FountainDetailTabs` context, so the whole gallery is one
tap away. It reuses the carousel's 4:3 aspect and the same API-relative URL resolution: on web the
`<img>` `src` is `resolveApiBaseUrl()` prefixed onto `photos[0].url` (never the raw path — that would
point at the Next.js origin in split-origin deploys); on mobile an `expo-image` `Image` with
`resolvePhotoUrl(apiBaseUrl, photos[0].url)`. Renders nothing when there are no photos.

### Photo carousel (`web/components/fountain/PhotoCarousel.tsx`)

A client component slotted near the top of `FountainDetail` (above the status block, via the
`PhotoGallery` bridge — see below), showing a fountain's photos with overlaid left/right
navigation. `PhotoOut.url`/`thumbnail_url` are the gated read paths (`/api/v1/photos/{id}` /
`.../thumb`), API-relative rather than a durable object URL; the web app and API are served
from different origins, so a local `resolvePhotoUrl()` helper prefixes the path with
`resolveApiBaseUrl()` before it goes into `<img src>` — the same pattern `MapBrowser` and
`FountainListRow` use.

**Image area:**

```tsx
<div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-100">
  <img
    src={resolvePhotoUrl(current.url)}
    alt=""
    loading="lazy"
    className="h-full w-full object-cover"
  />
  {/* left/right arrows, index dots, report/delete buttons — see below */}
</div>
```

- Fixed `aspect-[4/3]` frame (`bg-slate-100` while the image loads) so the panel doesn't
  jump as photos change; `object-cover` fills the frame without distortion.
- Photo `alt=""` (decorative) — the meaningful content is the fountain itself, not the
  image; the current index is announced separately (see indicator below).

**Overlaid arrow buttons** — absolutely positioned, vertically centered on the image's left
and right edges, one per side, hidden when there is only one photo:

```tsx
<button
  type="button"
  aria-label="Previous photo"
  className="absolute inset-y-0 left-0 flex items-center px-2 text-white outline-none"
>
  <span
    aria-hidden="true"
    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-lg hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
  >
    ‹
  </span>
</button>
<button
  type="button"
  aria-label="Next photo"
  className="absolute inset-y-0 right-0 flex items-center px-2 text-white outline-none"
>
  <span
    aria-hidden="true"
    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-lg hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
  >
    ›
  </span>
</button>
```

- **Position:** `absolute inset-y-0 left-0` / `right-0` on the `<button>` itself (full
  image height, vertically centered content via `flex items-center`), with the visible
  32px circular glyph (`h-8 w-8 rounded-full`) inset by the button's `px-2` padding so it
  never touches the image edge.
- **Color:** translucent black chip (`bg-black/40`, `hover:bg-black/60`) with white glyph —
  legible over any photo without needing a light/dark variant per image.
- **Focus ring:** `focus-visible:ring-2 focus-visible:ring-white` on the glyph (white reads
  on any photo background; the outer button itself has `outline-none` so only the visible
  ring shows).
- **Glyph:** `‹`/`›` are `aria-hidden`; the accessible name comes from the button's
  `aria-label` ("Previous photo" / "Next photo").
- **Wrapping:** Next from the last photo wraps to the first (and vice versa) — same
  behavior on click and keyboard (Left/Right arrow keys when the carousel has focus).

**Index / dot indicator:**

```tsx
<div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden="true">
  {photos.map((p, i) => (
    <span
      key={p.id}
      data-dot
      className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-white" : "bg-white/40"}`}
    />
  ))}
</div>
<p className="sr-only" aria-live="polite">
  Photo {index + 1} of {photos.length}
</p>
```

- Dots are decorative (`aria-hidden`); a `sr-only` live region announces "Photo N of M" for
  screen-reader users, updating as the index changes.
- Active dot: solid white (`bg-white`); inactive: translucent white (`bg-white/40`) — reads
  over any photo without a separate background chip. Keyed on `photo.id` (not array index)
  and marked with a `data-dot` attribute for test targeting.

**Report / Delete buttons** — both bottom-right, same translucent-chip family as the
arrows, stacked so they never overlap:

```tsx
{
  onReport && (
    <button
      type="button"
      aria-label="Report this photo"
      onClick={() => onReport(current)}
      className="absolute bottom-2 right-2 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
    >
      Report
    </button>
  );
}

{
  current.is_own && onDelete && (
    <button
      type="button"
      aria-label="Delete this photo"
      onClick={() => onDelete(current)}
      className={`absolute bottom-2 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white ${
        onReport ? "right-20" : "right-2"
      }`}
    >
      Delete
    </button>
  );
}
```

- **Report** — renders whenever the caller passes an `onReport` handler (gated upstream on
  `isAuthenticated` by `PhotoGallery`, the client bridge between `PhotoCarousel` and the
  report/delete server actions); always pinned `bottom-2 right-2`.
- **Delete** — per-photo, not per-carousel: it only renders for the **current** photo when
  `current.is_own` is true (the viewer uploaded it) _and_ an `onDelete` handler was passed.
  Its horizontal offset depends on whether Report is also showing for this viewer: `right-20`
  when both buttons are present (so Delete clears the wider Report chip), `right-2` when
  Delete is the only button (e.g. an unauthenticated context wouldn't reach here, but a
  future caller that omits `onReport` still lands correctly against the edge). Both buttons
  share the same visual chip — same size, color, hover, and focus ring as the arrow glyphs.
- Neither button is shown for photos the viewer doesn't own/can't act on — no disabled
  placeholder chip.
- **Delete confirmation:** `PhotoGallery` gates the actual `deleteOwnPhoto` call behind a
  native `window.confirm("Delete this photo? This can't be undone.")` — no custom confirm
  dialog for this destructive action (unlike the two-step button pattern used elsewhere in
  this document); declining the browser confirm is a no-op.

**Empty state:** when a fountain has no photos, the carousel **renders nothing** (`return
null`) — no placeholder frame, no "no photos" message, consistent with the other
graceful-skip sections in this document (rating fields, attribute controls).

### Content report dialog (`web/components/fountain/ReportContentDialog.tsx`)

Lets a signed-in user flag any reportable content — a **photo**, a **note**, or the
**fountain** itself (#11). Generalizes the former photo-only `ReportPhotoDialog`: it is
parameterized by `{ contentType: 'photo' | 'note' | 'fountain'; fountainId; contentId;
categories }` and calls the generalized `reportContent` server action, which POSTs the nested
report endpoint matching `contentType`. The caller owns the "which item is being reported" and
"already reported this session" state and mounts the dialog on demand (the photo carousel's
Report button for photos; the `ReportControl` affordance below for notes/fountains); the
dialog itself follows the existing modal shell used by the detail overlay and add-fountain
panel.

```tsx
<div
  role="dialog"
  aria-label={DIALOG_TITLE[contentType]} // "Report photo" | "Report note" | "Report this fountain"
  tabIndex={-1}
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 outline-none"
  onClick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div className="w-full max-w-sm rounded-lg bg-surface-raised p-4 shadow-xl">
    <h2 className="text-base font-semibold text-brand-ink">{DIALOG_TITLE[contentType]}</h2>

    {/* alreadyReported branch — see below — replaces everything from here down */}

    <label htmlFor="report-category" className="mt-3 block text-sm font-medium text-foreground">
      Reason
    </label>
    <select
      id="report-category"
      value={category}
      disabled={pending || submitted}
      className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
    >
      {/* one <option> per value in the `categories` prop, labelled via REPORT_CATEGORY_LABELS */}
      {categories.map((c) => (
        <option key={c} value={c}>
          {REPORT_CATEGORY_LABELS[c]}
        </option>
      ))}
    </select>

    <label htmlFor="report-note" className="mt-3 block text-sm font-medium text-foreground">
      Note (optional)
    </label>
    <textarea
      id="report-note"
      maxLength={500}
      rows={3}
      disabled={pending || submitted}
      className="mt-1 w-full rounded border border-border px-3 py-2 text-sm break-words text-foreground"
    />

    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        disabled={pending}
        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted hover:bg-surface"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={pending || submitted}
        className="rounded-full bg-brand-mid px-4 py-2 text-sm font-bold text-white hover:bg-brand disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </div>

    {msg && (
      <p
        role="status"
        aria-live="polite"
        className={`mt-2 text-sm ${msg.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-danger"}`}
      >
        {msg.text}
      </p>
    )}
  </div>
</div>
```

- Same centered-overlay shell family as the fountain-detail dialog/panel (`role="dialog"`,
  backdrop `bg-black/30`, `tabIndex={-1}` + focus-on-mount, `Escape` dismisses). Clicking the
  backdrop (a click whose `target === currentTarget`) also dismisses, same as `DetailOverlay`;
  clicks inside the card do not bubble to the backdrop handler because the inner `<div>`
  is a separate element. Uses the semantic dark-mode tokens (`bg-surface-raised`,
  `text-brand-ink`, `border-border`, `text-foreground`/`text-muted`) shared with the rest of
  the detail UI.
- **`contentType`** — drives the heading/`aria-label` (`Report photo` / `Report note` /
  `Report this fountain`) and the success/already-reported copy noun, and selects which nested
  endpoint `reportContent` POSTs. `contentId` is the reported item's id; for a **fountain**
  report `contentId === fountainId` (that endpoint has no separate id path param).
- **`categories`** — the per-type allowed set (spec §6), supplied by the caller from the
  shared `REPORT_CATEGORIES` map and rendered in order; each `<option>` label comes from
  `REPORT_CATEGORY_LABELS`. The select defaults to the first entry. Per type:
  - **photo** — Inappropriate / Not a fountain / Spam / Other.
  - **note** — Spam / Abuse / Inappropriate / Inaccurate / Other.
  - **fountain** — Not a fountain / Spam / Inappropriate / Inaccurate / Other.
- **`alreadyReported`** — the caller tracks reported ids client-side (session-only; there is
  no "did I already report this" read endpoint) and passes it when reopening the dialog for an
  item already reported this session. When true, the dialog **replaces the whole form** with a
  read-only notice ("You've already reported this {photo|note|fountain}. Thanks — our
  moderators will take a look.") and a single "Close" button — no category/note fields render
  and no request is made.
- **Note `<textarea>`** — optional, `maxLength={500}`, `break-words` (user-generated text
  convention); disabled while pending or after a successful submit. No live character counter
  needed at this length (unlike the 1000-char note form).
- **Submit** — royal-blue pill (`bg-brand-mid`, same as the Condition/Note form submit
  buttons), disabled while pending or after a successful submit; label swaps to "Submitting…"
  while pending.
- **States:** idle → pending (fields + Submit `disabled`, "Submitting…") → success (fields
  stay disabled, an inline `role="status"` success message appears below the form, and the
  item id is added to the caller's reported-ids set — the dialog does **not** auto-close; the
  viewer dismisses it via Cancel/backdrop/Escape) → error (fields re-enable, inline
  `role="status"` error message, same convention as the other Contribute forms). A reopen for
  an already-reported item short-circuits straight to the `alreadyReported` branch.
- Auth-gated: the Report control only renders for a signed-in viewer (signed-out visitors see
  no report affordance, matching the rest of Contribute).

### Report control (note & fountain) (`web/components/fountain/ReportControl.tsx`)

The trigger affordance that opens the content report dialog for a **note** or a **fountain**
(#11) — the photo path keeps its own carousel-overlay Report chip (above). A small
low-emphasis text button that owns the dialog open/`reported` state for its single item:

```tsx
<button
  type="button"
  onClick={() => setOpen(true)}
  className="text-xs font-semibold text-muted hover:text-foreground"
>
  Report
</button>
```

- **Placement:** on each community-note row (`NotesList`), inline at the end of the note's
  meta line; and once on the fountain detail (`FountainDetail`, Details tab) as
  "Report this fountain". Both render **only for a signed-in viewer** (auth-gated by the
  parent, exactly like the photo Report control and the rest of Contribute).
- **Styling:** deliberately quiet — `text-xs font-semibold text-muted hover:text-foreground`
  (a text button, not a pill) so a report affordance never competes with the primary content
  or the Contribute actions. The caller may pass a `className` override.
- **Behavior:** clicking mounts `ReportContentDialog` with the row's `contentType`/`contentId`
  and the per-type `categories`; on a successful submit the control flips its own
  `alreadyReported` so a reopen shows the read-only notice for the rest of the session.

### List-row thumbnail (`web/components/fountain/FountainListRow.tsx`)

Extends the existing city fountain-list row (rendered on the SEO city page, see "SEO place
pages" above) with a small leading photo thumbnail and an optional photo-count label,
driven by the new `CityFountainPin.thumbnail_url` / `photo_count` fields.

```tsx
<li className="flex items-center gap-3 py-3">
  {thumbnail_url ? (
    <img
      src={thumbnail_url}
      alt=""
      loading="lazy"
      className="h-12 w-12 shrink-0 rounded-md object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300"
    >
      {/* neutral placeholder glyph */}
    </span>
  )}
  <div className="min-w-0 flex-1">{/* existing row content: label, stars, See on Map */}</div>
</li>
```

- **Size / shape:** `h-12 w-12` (48px), `rounded-md` (matches the softer card radius used
  elsewhere, distinct from the fully-round pills), `shrink-0` so a long fountain label never
  compresses it.
- **Fit:** `object-cover` so non-square source thumbnails (backend-generated, max long edge
  400px) fill the box without distortion.
- **Loading:** `loading="lazy"` — city lists can be long; only thumbnails near the viewport
  fetch eagerly.
- **Placeholder (no photo):** a neutral `bg-slate-100` box with a muted `text-slate-300`
  glyph, `aria-hidden` — same neutral-empty-state tone as the map's placeholder frame; no
  broken-image icon is ever shown.
- **Photo count label:** when `photo_count > 0`, an "N photos" caption
  (`text-xs text-slate-400`) sits under the thumbnail or inline after the row label —
  small, low-emphasis, never competing with the rating/See-on-Map metadata.
- **Alt text:** the thumbnail image itself carries `alt=""` (decorative — the row's own link
  text already names the fountain); it is not a substitute for descriptive content.

### Admin moderation queue row (`web/app/admin/reports/page.tsx`)

The reported-photos list on the new `/admin/reports` page (admin-gated, linked from the
account page's "Reports" link for admins). Follows the same card-row density and button
hierarchy as `FountainAdminControls`.

The row markup lives in `page.tsx` (thumbnail + chips + notes); the action buttons are a
separate client component, `ReportedPhotoActions`, so only that slice needs to be
interactive.

```tsx
<li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-start">
  <img
    src={resolvePhotoUrl(photo.thumbnail_url)}
    alt=""
    loading="lazy"
    className="h-16 w-16 shrink-0 rounded-md object-cover"
  />
  <div className="min-w-0 flex-1">
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
        {report_count} report{report_count > 1 ? "s" : ""}
      </span>
      {is_hidden && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
          Hidden
        </span>
      )}
      {categories.map((c) => (
        <span
          key={c}
          className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
        >
          {c}
        </span>
      ))}
    </div>
    {notes.length > 0 && (
      <ul className="mt-2 space-y-1 text-xs text-slate-500">
        {notes.map((n, i) => (
          <li key={i} className="truncate break-words">
            {n}
          </li>
        ))}
      </ul>
    )}
  </div>
  <div className="flex shrink-0 flex-col items-end gap-1">
    <div className="flex gap-2">
      <button
        disabled={pending}
        className="rounded-full border border-[#0A357E] px-3 py-1.5 text-xs font-semibold text-[#0A357E] hover:bg-[#0A357E]/5 disabled:opacity-60"
      >
        {isHidden ? "Unhide" : "Hide"}
      </button>
      <button
        disabled={pending}
        className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
      >
        Reject
      </button>
      {confirmDelete ? (
        <>
          <button
            disabled={pending}
            className="rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            Confirm delete
          </button>
          <button
            disabled={pending}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-60"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          disabled={pending}
          className="rounded-full border border-red-600 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          Delete
        </button>
      )}
    </div>
    {message && <p className="text-xs text-red-700">{message}</p>}
  </div>
</li>
```

- **Thumbnail:** `h-16 w-16 rounded-md object-cover` — one size step up from the list-row
  thumbnail (this is a dense admin surface with fewer rows per screen, not a long scan
  list). Same API-relative `resolvePhotoUrl()` prefixing as the carousel/list-row.
- **Report count chip:** `rounded-full bg-red-100 text-red-800` — same danger-tone chip
  family as the "Out of order" status chip, sized down (`text-xs`) for a metadata row.
- **Hidden chip:** `rounded-full bg-amber-100 text-amber-800`, shown only while
  `photo.is_hidden` is true, sitting between the report-count chip and the category chips —
  the row's at-a-glance signal that a photo is already actioned, without leaving the queue
  (it stays listed, with reports still attached, until Rejected or Deleted).
- **Category chips:** neutral gray pills (`bg-slate-200 text-slate-600`), one per distinct
  reported category (`inappropriate` / `not_a_fountain` / `spam` / `other`), plain lowercase
  values (no title-casing needed at this density).
- **Notes:** up to 3 most-recent report notes, each already truncated to 200 chars
  server-side; rendered `truncate break-words text-xs text-slate-500` so a single note never
  wraps the row taller than the thumbnail; the `<ul>` is omitted entirely when there are no
  notes. Notes are shown to admins only and are never logged (see Logging & Observability in
  `CLAUDE.md`).
- **Actions**, same three-tier hierarchy as `FountainAdminControls`, rendered by
  `ReportedPhotoActions` in a `flex-col items-end` stack (buttons row, then an optional error
  line below):
  - **Hide / Unhide** — navy outline (`border-[#0A357E] text-[#0A357E]`), a single toggle
    button whose label and call flip with the photo's current `is_hidden` state (Hide when
    visible, Unhide when hidden) — the non-destructive corrective action.
  - **Reject** — neutral slate outline, dismisses the reports without hiding the photo
    (false-positive report).
  - **Delete** — red outline, **two-step confirm** before the destructive call fires: first
    click swaps the single button for a solid red "Confirm delete" _plus_ a slate "Cancel"
    button (matching the two-step delete pattern already documented under Admin moderation
    controls); Cancel reverts to the single outlined "Delete" button without calling the API;
    the object/row is only removed on "Confirm delete".
- Each row's buttons are `disabled` while their own mutation is pending; on success the page
  is refreshed (`router.refresh()`) so the row updates (chip cleared, row removed, or Hidden
  chip toggled) from fresh server data — no optimistic row removal. On failure, a
  role-appropriate message (e.g. "This account does not have admin access.", "This photo no
  longer exists.") renders as `text-xs text-red-700` under the button row.

### Unified moderation queue — note & fountain rows (#12)

As of #12 the `/admin/reports` page is the **Moderation queue**: one combined list, fed by
`GET /api/v1/admin/reports`, whose rows are heterogeneous — `content_type` is `photo`, `note`,
or `fountain`. The **photo row** is exactly the row documented above. Note and fountain rows
reuse the same card-row density, the same report-count / `Hidden` / category chips, the same
truncated reporter-notes `<ul>`, and the same button hierarchy — they only differ in the
leading "what was reported" block (no thumbnail) and in which actions are offered. All three
rows link to the reported item's fountain (`/fountains/{fountain_id}`). A `content_type`
query-param filter is available for triage.

The action buttons for every type are rendered by one client component,
`ReportedContentActions`, which switches on `content_type`; Reject calls the generalized
`POST /api/v1/admin/reports/dismiss` for all types.

- **Note row** — no thumbnail. The leading block is the reported note's own body as a
  truncated **excerpt** (`text-sm text-slate-700`, ≤200 chars, server-side) with the author's
  display name beneath (`text-xs text-slate-500`). Chips + reporter-notes list as the photo row.
  Actions: **Hide / Unhide** (navy outline) · **Reject** (slate outline). **No Delete** — hiding
  a note *is* its removal (the row stays with a `Hidden` chip; the note is retained + auditable).
- **Fountain row** — no thumbnail. The leading block is the fountain's **label**
  (`placement_note`, or "Fountain" when it has none; `text-sm font-semibold`) plus a
  `View fountain` link. Chips + reporter-notes list as the photo row. Actions: **Hide / Unhide** ·
  **Reject** · **Delete** (red outline, same two-step confirm as the photo row — a fountain
  hard-delete is destructive, reversing points and removing children).
- The photo row keeps its thumbnail + **Hide / Unhide · Reject · Delete** exactly as documented
  in the section above.

### Pending-report badge (`web/components/admin/ReportBadge.tsx`, `mobile/components/nav/ProfileTabIcon.tsx`)

A small count badge overlaid on the header profile avatar (web) / profile tab icon
(mobile), shown only to admins, when `GET /api/v1/admin/reports/summary` reports
`pending_count > 0` (as of #12 this counts distinct pending **items across all report types** —
photo, note, and fountain — not photos only). On web, the markup below is its own component
(`ReportBadge`),
rendered inside `AuthControl`'s existing `<span className="relative inline-block">` avatar
wrapper — server-seeded with the initial count, then polled client-side on a ~60s interval
via the `fetchPendingReportCount` server action (keeps the Logto access token server-side).
Never shown to non-admins; renders nothing at count 0 (not an empty badge).

```tsx
<span className="relative inline-block">
  {/* existing avatar button */}
  <span
    aria-hidden="true"
    className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
  >
    {pending_count > 9 ? "9+" : pending_count}
  </span>
  <span className="sr-only">, {pending_count} pending reports</span>
</span>
```

- **Color:** solid red (`bg-red-600` / white text) — the same danger tone as the two-step
  delete confirm and the "Out of order" chip, reserved for attention-worthy admin state.
- **Position:** top-right corner overlay (`absolute -right-1 -top-1`), same corner
  convention as a standard notification badge; does not shift the avatar's own layout.
- **Min size:** `h-4 min-w-4` (16px) circle that grows to fit two digits without clipping;
  `px-1` gives single- and double-digit counts equal breathing room.
- **Count formatting:** the raw count for 1–9; **`9+`** for any value above 9 — the badge
  never needs to fit more than two glyphs.
- **Accessibility:** the numeral badge itself is `aria-hidden` (decorative glyph); a
  `sr-only` suffix appended to the avatar button's accessible name announces the pending
  count (e.g. "Open account menu, 3 pending reports") so screen-reader users get the
  same information sighted admins see from the badge. Mobile: the tab icon badge is a
  sibling `View` positioned the same way, with the count folded into the tab's
  `accessibilityLabel`.
- Hidden entirely (no empty badge, no `0`) when `pending_count === 0` or the viewer is
  not an admin.

---

## Mobile (React Native)

The mobile app (Expo / React Native) has its own component system (slice 6e-2).
It does **not** use the web Tailwind classes above; styling is React Native
`StyleSheet` with shared tokens in `mobile/theme.ts`.

### Design tokens (`mobile/theme.ts`)

- `colors` — brand `brandBlue` `#0A357E` / `brandYellow` `#F2C200`
  (`brandYellowHover` `#FFCE1F`), `text` / `textMuted`, `background` / `surface`
  / `border`, `danger`, `onBrand`. Matches the web brand palette.
- `spacing` — `xs 4 · sm 8 · md 16 · lg 24 · xl 32`.
- `typography` — `title` / `heading` / `body` / `meta`.

### Layout

- **`ScreenContainer`** — safe-area-aware screen frame (`react-native-safe-area-context`)
  with standard padding. Wrap every screen's content in it. Headerless screens
  (the root invalid-config branch) pass `includeTopInset`.

### State components (`mobile/components/states/`)

Reusable async states, usable on small screens:

- **`LoadingState`** — spinner + label (default "Loading...").
- **`EmptyState`** — muted centered label for an empty result set.
- **`ErrorState`** — error label + optional "Try again" retry button.
- **`OfflineState`** — offline message + optional "Retry" button.
- **`QueryStateView`** — picks the right state component from a query result via
  the pure `resolveViewState` helper (`lib/view-state.ts`), rendering its
  children only in the `ready` state. "Offline" is a network failure with no HTTP
  status; "error" is an HTTP error (`ApiError`).

### Navigation (`mobile/app/(tabs)/_layout.tsx`)

Expo Router: a **5-item** bottom-tab group (`(tabs)`), in registration order **Map · Search ·
Add · Rankings · Profile**, with stack-pushed detail (`fountains/[id]`) and `diagnostics`.
Sign-in affordances stay hidden/disabled until `isAuthConfigured` is true (auth-unavailable
mode, spec §21).

- **Map tab:** the native tab screen (`index`), icon `map`.
- **Search tab:** a **standard tab** — a normal `tabBarIcon: ({color,size}) => <Ionicons
name="search" …>` (identical pattern to Map/Rankings/Profile) plus a
  `listeners.tabPress` handler that calls `event.preventDefault()` then navigates to `/` and
  fires `requestMapSearch()` (`mobile/lib/navigation/map-search.ts`), which opens the
  **search overlay** on the map screen (see below) instead of switching to a placeholder
  screen. Because it is a native `tabBarIcon`, it receives `color`/`size` from the tab bar and
  tracks `tabBarActiveTintColor`/`tabBarInactiveTintColor` automatically — no manual color
  tracking needed. (A prior custom-`tabBarButton` version of this tab discarded the renderer's
  computed props and silently failed to render on-device; do not reintroduce a custom
  `tabBarButton` for Search.)
- **Add tab:** the centered FAB — literal middle of 5 items, so it is centered by construction.
  It is the **only custom `tabBarButton`** in this tab bar: a differentiated circular `+` action
  (54px circle, gold fill `colors.brandYellow`, 2px navy border, `marginTop: -18` lift above the
  bar) that dispatches into the map add flow (`requestMapAddMode()`) instead of navigating to a
  placeholder screen. It renders its own glyph (`add`, fixed `colors.brandBlue`) and label
  rather than receiving `color` via a native `tabBarIcon` prop.
- **Rankings tab:** opens the `/leaderboard` tab route, icon `trophy-outline`.
- **Profile tab:** the user-facing label for the existing account/profile route; icon is the
  **avatar tab icon** (see below), not a static glyph.

**Active / inactive tints:** `tabBarActiveTintColor: colors.brandBlue`,
`tabBarInactiveTintColor: TAB_INACTIVE_COLOR` (`#64748B`). Map, Search, Rankings, and Profile
are all native `tabBarIcon`s, so they pick up these tints automatically. The Add tab is the sole
exception: its custom `tabBarButton` renders a fixed-color FAB (gold circle, navy `+` and label)
that does not vary with focus/tint state, by design (it must stay visually prominent as a
lifted action button, not read as just another tab).

**Safe-area contract (spec §5.2):** the tab bar reads `useSafeAreaInsets()` and computes
`bottomPad = Math.max(insets.bottom, ANDROID_MIN_PAD)` (`ANDROID_MIN_PAD = 8`) so Android
3-button nav — which often reports `insets.bottom === 0` — never jams the bar against the
system chrome. The bar uses a **fixed `height = BAR_CONTENT_H (56) + bottomPad`** (not
`minHeight`) and `paddingBottom: bottomPad`. The custom Add `tabBarButton` container receives
the **same** `paddingBottom: bottomPad` so its content sits on the same baseline as the native
tab icons/labels; the Add FAB's `marginTop: -18` lift is preserved relative to that shared
baseline. With five labeled items, `tabBarLabelStyle` drops to `fontSize: 10` so
"Rankings"/"Profile" render single-line without truncating.

#### Avatar tab icon (`mobile/components/nav/ProfileTabIcon.tsx`)

Replaces the static `person-circle` glyph on the Profile tab with the signed-in user's photo.

- **With a photo:** a circular `<Image>` sized to the tab icon (24px), wrapped in a ring view
  that gains a 2px brand-blue border only when `focused` — this is the tab's active-state
  affordance in place of the usual tint color change.
- **Fallback (`person-circle` Ionicon):** shown whenever there is no `avatar_url` (anonymous,
  no photo, still loading, or query error) **and** whenever the image itself fails to load
  (`onError` tracks the failed URL so a broken remote image never leaves a blank/broken box).
  Tinted `colors.brandBlue` when focused, `TAB_INACTIVE_COLOR` otherwise — matching the native
  tabs' tint behavior.
- **Cache-only read, no stray network request:** the icon subscribes to the shared `["me"]`
  React Query cache with `queryFn: skipToken` (the v5 idiom for a permanently-disabled query,
  not `enabled: false`, so `useBaseQuery` doesn't dev-warn about a missing `queryFn` on every
  re-render of this persistent tab-bar component). It never fetches on its own — it only
  re-renders once `NameGate` (mounted alongside the tab navigator) populates or updates the same
  cache entry.

### Account auth (slice 6e-5)

The Profile tab is a utility surface, not a marketing page. It uses
`ScreenContainer`, the shared typography scale, and compact full-width controls.

- **Public-read mode:** when native auth is unconfigured, show one muted body
  note explaining that browsing is public and sign-in is unavailable in this
  build. Do not show disabled fake sign-in controls.
- **Signed out / reauth required:** show concise copy and a crown-gold primary
  button (`colors.brandYellow`, navy text, 8px radius, min height 48). While the
  browser auth session is opening, disable the button and change the label to an
  in-progress state. Cancellation is a non-error note; SDK/auth errors use the
  danger color.
- **Signed in:** show a 64px circular avatar when `avatar_url` exists; otherwise
  show a 64px brand-blue fallback circle with the profile initial. Display the
  backend `display_name`, a non-synthetic email when available, and a compact
  admin label when `is_admin` is true. Do not render raw user ids.
- **Profile error:** show retry and sign-out controls. A 401/session-expired
  state becomes the signed-out reauth-required state, not an offline/network
  message.
- **Accessibility and fit:** buttons use `accessibilityRole="button"` and
  disabled state where applicable. Text must wrap inside the screen on small
  devices; profile text uses `flex: 1` and `minWidth: 0` so long names/emails do
  not push controls off-screen.

### Map (slice 6e-3)

The Map tab (`mobile/app/(tabs)/index.tsx`) is a **full-bleed** MapLibre map (no
`ScreenContainer` padding) with floating overlays. When `isMapConfigured` is
false it falls back to a centered "map unavailable" `ScreenContainer` state. Pin
mapping, icon/pill selection, bounds, and filter→query logic are pure helpers in
`lib/map/` (unit-tested); the components below are the untested shell.

- **`FountainMap`** (`mobile/components/map/FountainMap.tsx`) — the MapLibre
  (`@maplibre/maplibre-react-native`) map: Protomaps basemap, a clustered
  `GeoJSONSource`, and four `Layer`s (cluster circle, cluster count, pins,
  rating pill). MapLibre logo hidden; attribution kept. Tapping a cluster
  expands it (`flyTo` the cluster-expansion zoom); tapping a pin navigates to the
  detail route.
- **Fountain pins** — icon by state (mirrors web): `pin-broken` when not working
  (or `current_status === "not_working"`), `pin-gold` when working and
  `ranking_score` strictly exceeds 4, else `pin-standard`. Bottom-anchored,
  `icon-size` 0.5. Assets in `mobile/assets/pins/`.
- **Rating pill** — a brand-blue text label (`★ 4.2`) with a white text-halo,
  shown only at zoom ≥ 13 and only for rated fountains (the layer filters out
  null pills). No 9-patch background (deferred from the web pill for simplicity).
- **`MapFilters`** (`mobile/components/map/MapFilters.tsx`) — a horizontal
  scrollable row of pill **chips**: "Working now", "Bottle filler", "Wheelchair"
  (toggles), and a minimum-rating chip cycling "Any rating" → "3★+" → "4★+".
  Active chip = brand-blue fill with `onBrand` text; inactive = `surface` fill
  with a `border` outline. `accessibilityRole="button"` + `selected` state.
- **Map top bar** — the Map tab hides the default native header and renders an in-map brand bar
  under the status bar. It uses brand blue with a gold bottom rule, the FountainRank name on the
  left, and the signed-in points chip on the right. The filter chips sit below this bar, and the
  native compass is offset below both pieces of top chrome.
- **Locate button** — a 44×44 circular `surface` `Pressable` (◎ glyph,
  brand-blue) at the bottom-right, shown only once foreground location is
  granted; recenters the camera on the user. Denial hides it (non-blocking).
- **Map overlay banner** — a centered pill at the bottom showing a single status
  derived from `resolveViewState` plus map-specific notes: a spinner on first
  load; "Zoom in to see fountains" below the fetch zoom; "You appear to be
  offline" / "Couldn't load fountains" (both tap-to-retry); "No fountains in this
  area"; or "Showing the first 500 — zoom in for more" when capped. Hidden when
  idle/ready.

### Fountain detail (slice 6e-4)

The fountain detail route (`mobile/app/fountains/[id].tsx`, stack-pushed from a
map pin) is a **read-only** mirror of the web detail's informational content.
Display/transform logic is pure and unit-tested (`lib/map/format.ts`,
`lib/detail/attributes.ts`, `lib/detail/notes.ts`); the components below are the
untested shell. Contribution affordances (rate / report condition / add note)
are deferred to 6e-5/6e-6.

- **Detail screen** — a `ScreenContainer` + `ScrollView` with **pull-to-refresh**
  (`RefreshControl`, brand-blue tint) that refetches both reads. The **detail**
  read gates the screen via `QueryStateView` (first-load spinner; offline/error
  with retry that refetches both). An absent/invalid route id **or** a 404
  renders a non-retryable "Fountain not found" state (no blank screen). The
  **notes** read is best-effort: its data renders when present, and a failure
  shows a small non-blocking error row rather than silently looking like "no
  notes". Header title "Fountain"; the back button returns to the still-mounted
  Map screen (map context preserved).
- **`StatusBlock`** (`mobile/components/fountain/StatusBlock.tsx`) — a toned
  status chip (`statusDisplay`): `ok` emerald `#D1FAE5`/`#065F46`, `warn` amber
  `#FEF3C7`/`#92400E`, `bad` red `#FEE2E2`/`#991B1B`. Optional `⚠`-prefixed
  advisory (e.g. `reported_issue`). A muted last-verified line shows relative
  time ("Last verified 3 days ago") with the exact date preserved in an
  `accessibilityLabel` (RN has no hover title); "Not yet verified by anyone"
  when absent.
- **`AttributeList`** (`mobile/components/fountain/AttributeList.tsx`) — access /
  feature attributes grouped by category (pure `groupAttributes`, first-seen
  order) under uppercase muted headers (`formatCategory`). Each row: muted name
  on the left; the consensus value on the right, toned by `attributeDisplay`
  (`normal` text, `muted` textMuted, `mixed` amber `#92400E`) with an optional
  muted hint (e.g. "(2 reports)", "latest: Yes"). Renders nothing when empty.
- **`NotesList`** (`mobile/components/fountain/NotesList.tsx`) — community-note
  cards (`surface` fill, `border`, radius 12): note body, then a muted byline
  "— {author} · {relative time}" with " · edited" when `isNoteEdited` (pure).
  Renders nothing when empty.
- **`FountainDetail`** (`mobile/components/fountain/FountainDetail.tsx`) — the
  composed body: title "Public drinking fountain" + `StatusBlock`; a large
  brand-blue rating average + muted vote count
  (`formatAverage`/`formatVotes`); a per-dimension list (`formatDimension`,
  shown only when dimensions exist); `AttributeList`; the adder's comment/context
  card ("From the person who added this fountain", using legacy placement text only
  when comments are empty); the notes section (or its
  error row); a muted "Added … · Last rated …" footer (`formatDate`); and a
  brand-yellow **Directions** pill (`Linking.openURL` to a Google Maps
  directions URL, with an `Alert` on the rare failure — never a silent swallow).

### Existing-fountain contributions (slice 6e-6)

Contribution UI is mounted inside the stack-pushed fountain detail route, below
the read-only community content and above the footer/directions action. It stays
compact and task-focused; no marketing copy, no nested cards, and no write
control is shown as usable unless `auth.status === "authenticated"`.

- **`ContributePanel`** — top-level auth gate. In `unconfigured` mode it shows a
  muted public-read note with no fake disabled sign-in button. In signed-out or
  reauth states it shows concise copy and a crown-gold sign-in button. Loading
  and signing-in states are non-submittable. Authenticated state renders the
  forms.
- **Rating form** — per-dimension 1-5 star controls from
  `detail.dimensions`. Unset dimensions submit nothing; at least one selected
  dimension is required. Submit button is brand-blue with disabled opacity.
- **Condition form** — direct "working" confirmation plus problem chips for the
  deployed condition statuses. Reports use `is_proximate: false` until a later
  device/proximity flow explicitly verifies the user is at the fountain.
- **Attribute form** — uses the public `/api/v1/attribute-types` catalog, not
  `detail.attributes` consensus rows. Boolean attributes render `Yes` / `No` /
  `Unknown`; enum attributes render each allowed value plus `Unknown`. Catalog
  loading/error/empty states are honest and non-submittable.
- **Note form** — create-only note entry with `maxLength={1000}` and a character
  count. There is no edit/delete UI because the API is list/create only.
- **Reward animation** — successful point-awarding writes use the shared full-screen
  `WaterCelebration` overlay. It shows a brand-blue/gold burst with the known or derived `+N points`
  amount, then clears without trapping touches. Reduced-motion users get a static success/points
  confirmation with no droplet motion.
- **Feedback and diagnostics** — every mutation shows pending/success/error
  state in the UI. Mobile contribution payloads, note bodies, tokens, and raw
  profile data are not logged; mobile diagnosability for this slice is through
  user-visible states and local helper tests.

### Add fountain (slice 6e-7)

The Add tab is a task-first native create flow. It uses `ScreenContainer` +
`ScrollView`, compact headings, 8px-radius controls, and the existing mobile
theme tokens. No write controls are shown as usable unless
`auth.status === "authenticated"`; unconfigured/signed-out/reauth states use the
same honest gate pattern as existing-fountain contributions.

- **Placement map** — a 320px-tall bordered MapLibre frame with the Protomaps
  basemap, the existing standard pin asset for the candidate location, and a
  brand-blue dashed ring when a usable GPS accuracy bound exists. The map keeps
  attribution visible and hides the MapLibre logo, matching the browse map.
- **Placement controls** — current-location and place-at-center buttons, plus
  north/west/east/south nudge buttons. They are 44px-min-height Pressables with
  `accessibilityRole="button"` and disabled state. The flow is completable
  without relying solely on a map tap.
- **Placement guidance** — muted body copy below the map communicates the active
  gate: zoom in, place near confirmed location, or exact-placement fallback when
  location cannot be confirmed. A compact coordinate readout appears only after
  a pin is chosen.
- **Working status** — two segmented choices, Yes and No. Selected state uses
  brand-blue fill with `onBrand` text; unselected uses `surface` with a `border`
  outline.
- **Initial ratings** — add-time rating dimensions come from
  `/api/v1/rating-types`, not detail dimensions. Star controls mirror the
  existing contribution star style: 36px tap targets, crown-gold selected stars,
  muted border-color unselected stars.
- **More Details attributes** — add-time attribute options come from
  `/api/v1/attribute-types`, grouped by category and sorted by `sort_order`.
  Boolean rows render Yes / No / Unknown; enum rows render allowed values plus
  Unknown. Unknown is the default and is omitted from the create payload.
- **Text inputs** — Comment is multiline and trimmed before submission without a
  mobile-only max cap. Placement note is not shown or submitted by updated clients.
- **Points preview** — add and contribution forms show a live possible-points card
  before submit. Actual totals refresh from backend contribution stats after writes.
- **Duplicate result** — a compact state box shows that a fountain already
  exists and offers a primary View existing fountain action plus a secondary Add
  another location action. The route action is only available after a valid
  duplicate fountain id is present.
- **Feedback** — success/error text uses `accessibilityLiveRegion="polite"` and
  the same non-Android explicit accessibility announcement pattern as
  existing-fountain contributions. Form state is preserved on validation,
  network, auth, and server errors.

### Search overlay (`mobile/components/map/SearchOverlay.tsx`)

Opened by the bottom nav's **Search** tab button (see Navigation above), which navigates to the
map and fires `requestMapSearch()`; the map screen (`(tabs)/index.tsx`) subscribes and mounts the
overlay on top of the map canvas. The component is purely presentational — it renders the view
state produced by the pure `lib/map-search/state.ts` reducer and calls back into the screen for
every effect (query edits, selecting a result, closing); it owns no network/debounce/abort logic
itself.

**Shell:**

- A full-screen semi-transparent **scrim** (`rgba(15, 23, 42, 0.55)`) behind the panel.
- A **panel** anchored to the top of the map, `paddingTop: topInset + spacing.sm` so the input
  clears the status bar/notch, with rounded bottom corners (`borderBottomLeftRadius`/
  `borderBottomRightRadius: 16`) on a `colors.background` fill.
- **Header row:** a text input (`accessibilityLabel="Search address or city"`, placeholder
  "Search address or city", `autoFocus`, `autoCorrect={false}`, `returnKeyType="search"`, 44px
  min height) plus a 44×44 **close button** (`×` glyph, `accessibilityRole="button"`,
  `accessibilityLabel="Close search"`). A bottom border separates the header from the results
  body. Android hardware-back and the close button both dismiss the overlay (screen-owned).

**States** (`SearchState.status` from `lib/map-search/state.ts`, rendered via the existing
`components/states/*` primitives where they fit):

| Status    | Rendering                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle`    | Nothing shown — no recent-search history in v1; empty until the query reaches the minimum length.                                                                  |
| `loading` | `LoadingState label="Searching..."` — spinner + label, centered in the body.                                                                                       |
| `empty`   | `EmptyState label="No matches"` — centered muted label (no-results case).                                                                                          |
| `error`   | `ErrorState label="Search is unavailable right now"` — covers provider/network failures (§8 `503 geocoding_unavailable` / `geocoding_disabled`, throttling, etc.). |
| `results` | A `FlatList` of tappable result rows, each ≥ 44px tall, showing the result's label (`numberOfLines={2}`), with the **attribution block** as `ListFooterComponent`. |

**Result row:** `Pressable` (`accessibilityRole="button"`, bottom-border divider,
`colors.surface` on press) showing the label in `typography.body`; selecting a row calls
`onSelect`, which the screen uses to dismiss the overlay and fly the map camera to the chosen
coordinate.

**Attribution block (spec §12 — persistent, not deferred):** rendered as the results list's
footer whenever the `results` state is shown, so it is visible any time actual geocoding results
are on screen:

> **Search by LocationIQ** · © OpenStreetMap contributors

- "Search by LocationIQ" is a tappable link (`accessibilityRole="link"`, brand-blue, bold,
  underlined) that opens `https://locationiq.com/attribution` via `Linking.openURL`, falling
  back to an `Alert` ("Couldn't open link") if no browser handler is available — never a silent
  failure.
- "· © OpenStreetMap contributors" is plain muted text (`typography.meta`, `colors.textMuted`),
  matching the ODbL credit convention already used for the map basemap.
- If the geocoding provider is ever swapped to MapTiler, only this line's copy/link changes
  (`© MapTiler · © OpenStreetMap contributors`); the placement/visibility contract stays fixed.

**Accessibility:** the input, close button, result rows, and attribution link all carry explicit
`accessibilityLabel`/`accessibilityRole` (never a bare icon-only control without a label); the
list uses `keyboardShouldPersistTaps="handled"` so tapping a result while the keyboard is open
does not require a second tap.
