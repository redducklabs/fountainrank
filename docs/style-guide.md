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
