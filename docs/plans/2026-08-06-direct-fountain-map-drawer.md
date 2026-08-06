# Map-Backed SEO Areas and Direct Fountain Drawer

**Goal:** Make area pages the finest indexable SEO grain and present country/region/city URLs as
area-focused maps with fountain pins. A direct or refreshed `/fountains/[id]` still shows its
server-rendered fountain-detail drawer over the live map, focused on and highlighting that fountain.

**Design:** Update the map-browsing and crawlable-SEO specs. Reuse `MapBrowserLoader`, `MapBrowser`,
`DetailOverlay`, and the existing server-rendered content. A bounded initial-focus prop gives a
newly mounted direct-fountain map the route id; the existing public detail resolution supplies its
coordinates and pin-level camera move. `DetailOverlay` gets an optional direct-close destination so
hard-loaded drawers close to `/`, while intercepted drawers retain browser-Back behavior.

Area routes use a public place-map response containing the canonical place, its authoritative
boundary bounding box, the full fountain count, and at most 500 non-hidden overview pins. Country,
region, and city pages seed `MapBrowser` with those pins and fit the bounds; startup geolocation is
disabled for this mode. Seed pins remain visible and clustered below the normal zoom-10 bbox-fetch
threshold. At/above that threshold the existing viewport loader takes over. SSR headings, summaries,
structured data, and crawlable hierarchy links remain in a map-side area panel so search engines and
non-WebGL users retain useful content. Large-area copy discloses the overview cap.

Individual fountain pages retain metadata, canonical, JSON-LD, authentication, notes, photos,
admin controls, and direct-load 404 behavior, but become `noindex, follow` and are removed from the
sitemap. Area pages become the finest indexable grain.

## Tasks

1. Add a bounded public place-map API contract for country/region/city bounds and overview pins,
   selecting the narrower normal or longitude-shifted envelope for antimeridian-safe area bounds,
   using precomputed membership for fountain selection and the stored place boundary only for its
   envelope. Add backend tests and regenerate the tracked API client.
2. Add tests for direct-close behavior and pure map-initialization decisions: query focus precedence,
   direct-route focus, area bounds, seed-pin retention below zoom 10, and geolocation suppression.
3. Extend the map loader/browser with optional initial focus, area bounds, and seed pins while
   preserving the existing homepage and soft-navigation behavior.
4. Change a successful direct fountain route to render the normal map shell with `DetailOverlay`
   and existing SSR detail content. Change metadata to `noindex, follow`, remove fountain sitemap
   chunks/index entries, and keep existing error and 404 semantics.
5. Convert country/region/city success pages to the map shell plus an accessible SSR area panel;
   preserve canonical redirects, indexability gates, structured data, and hierarchy links.
6. Update the SEO runbook and style guide to describe area-first indexation and both map shells.
7. Run backend lint/tests and migration drift checks as applicable; regenerate-check the API client;
   run focused web tests, type-check, lint, formatting check, and build. Component-render tests are
   CI-only on this shared Windows/WSL checkout when the documented duplicate-React issue occurs;
   report that limitation precisely if encountered.

## Acceptance criteria

- A hard load or refresh on a valid `/fountains/[id]` renders the map behind the existing drawer.
- The map resolves, flies to, and highlights the route's fountain.
- Closing the hard-loaded drawer navigates to `/`; closing an intercepted drawer still goes Back.
- The detail is present in server-rendered markup, retains canonical metadata and JSON-LD, emits
  `noindex, follow`, and is absent from the sitemap.
- A missing fountain still produces Next's hard-load 404 behavior.
- Existing direct-page authentication, contribution, notes, photos, and admin behavior is preserved.
- Valid country, region, and city URLs fit the authoritative area bounds and show bounded,
  non-hidden fountain pins; zooming in transitions to existing viewport loading.
- Area headings, summaries, hierarchy links, indexability gates, canonical redirects, and structured
  data remain server-rendered and accessible without WebGL.
- Large areas disclose the overview pin cap rather than implying every fountain is loaded.
