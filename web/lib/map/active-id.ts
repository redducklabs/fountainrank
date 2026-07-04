// Which fountain the map highlights. Kept MapLibre-free so it's unit-testable without pulling
// MapBrowser's maplibre-gl/CSS/asset graph into jsdom.

/** The fountain id embedded in a `/fountains/<id>` path, or "" for any other path. */
export const activeIdFromPath = (p: string | null) =>
  p?.match(/^\/fountains\/([^/?#]+)/)?.[1] ?? "";

/**
 * The active (highlighted) fountain id: the `?focus=<id>` deep-link param when present
 * (used by "See on Map"), otherwise the id from the current `/fountains/<id>` path.
 */
export const resolveActiveId = (focus: string | null, pathname: string | null) =>
  focus ?? activeIdFromPath(pathname);
