// One swappable basemap config (dark-mode-ready, spec §5.4); URL from NEXT_PUBLIC_* env.
// MapBrowser loads only `styleUrl` (the hosted Light style JSON); that style's source is a
// go-pmtiles TileJSON (fountainrank.com/tiles/planet.json) which MapLibre fetches natively.
export const BASEMAP = {
  flavor: "light" as const,
  styleUrl: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? "",
};
export const PIN_ASSETS: Record<
  "pin-standard" | "pin-selected" | "pin-gold" | "pin-broken" | "pin-unrated",
  string
> = {
  "pin-standard": "/pins/pin-standard.png",
  "pin-selected": "/pins/pin-selected.png",
  "pin-gold": "/pins/pin-gold.png",
  "pin-broken": "/pins/pin-broken.png",
  "pin-unrated": "/pins/pin-unrated.png",
};
// Stretchable rating-pill background, loaded with 9-patch stretch metadata (icon-text-fit).
export const PILL_BG_ASSET = "/pins/pill-bg.png";
