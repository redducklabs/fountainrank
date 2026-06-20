// One swappable basemap config (dark-mode-ready, spec §5.4); URLs from NEXT_PUBLIC_* env.
// MapBrowser loads only `styleUrl`; the hosted Light style JSON embeds its source as
// `pmtiles://<pmtilesUrl>`. `pmtilesUrl` is the value the upload runbook (Task 20) writes
// into that style JSON's source — kept here so the two stay in one place.
export const BASEMAP = {
  flavor: "light" as const,
  styleUrl: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? "",
  pmtilesUrl: process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL ?? "",
};
export const PIN_ASSETS: Record<
  "pin-standard" | "pin-selected" | "pin-gold" | "pin-broken",
  string
> = {
  "pin-standard": "/pins/pin-standard.png",
  "pin-selected": "/pins/pin-selected.png",
  "pin-gold": "/pins/pin-gold.png",
  "pin-broken": "/pins/pin-broken.png",
};
// Stretchable rating-pill background, loaded with 9-patch stretch metadata (icon-text-fit).
export const PILL_BG_ASSET = "/pins/pill-bg.png";
