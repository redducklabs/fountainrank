import { logMapError } from "./log";

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

export function styleUrlFor(theme: "light" | "dark"): string {
  if (theme === "light") return BASEMAP.styleUrl;
  try {
    const u = new URL(BASEMAP.styleUrl);
    if (u.pathname.endsWith("/style.light.json")) {
      u.pathname = u.pathname.replace(/style\.light\.json$/, "style.dark.json");
      return u.toString(); // query (?v=) preserved
    }
  } catch {
    /* fall through to fallback */
  }
  // Non-matching config (custom/local style): keep light AND surface a diagnostic so a
  // "dark requested but not derivable" state is visible, not a silent light basemap under
  // a dark UI. The deploy gate (Task 11) prevents relying on this in production.
  logMapError("dark-style-derivation-fallback", { styleUrl: BASEMAP.styleUrl });
  return BASEMAP.styleUrl;
}

// Pair each pin/pill file URL with its theme-suffixed image NAME. MapBrowser addImage's
// the light or dark asset under the matching suffixed name so the layer factories can
// reference `pin-standard` / `pin-standard-dark` etc. by name.
export function themedPinAssets(theme: "light" | "dark"): { name: string; url: string }[] {
  const suffix = theme === "dark" ? "-dark" : "";
  return (Object.keys(PIN_ASSETS) as (keyof typeof PIN_ASSETS)[]).map((base) => ({
    name: `${base}${suffix}`,
    url: `/pins/${base}${suffix}.png`,
  }));
}

export function themedPillBg(theme: "light" | "dark"): { name: string; url: string } {
  const suffix = theme === "dark" ? "-dark" : "";
  return { name: `pill-bg${suffix}`, url: `/pins/pill-bg${suffix}.png` };
}
