// The canonical `flyto`/`bbox` URL contract (design doc
// docs/specs/2026-07-01-web-search-and-mobile-polish-design.md §4.2/§4.3). The
// header search is global (a non-map page has no map), so on select it encodes
// the target into the URL rather than calling into the map directly - this both
// recenters on the map page and navigates there from any other page. Exactly one
// wire format, no alternatives: `flyto=lng,lat` (required) and
// `bbox=west,south,east,north` (optional), all finite decimal numbers.
//
// URL params are user-controllable, so the validation here is a SECURITY
// boundary, not just UX - it is applied identically on the writer
// (`buildFlyToQuery`) and the reader (`parseFlyToParam`).

import { NEIGHBORHOOD_ZOOM, PLACE_MIN_ZOOM } from "../map/constants";

export type ParsedFlyTo = {
  center: [number, number];
  /** `[west, south, east, north]` - present only when the raw bbox param validated. */
  bbox?: [number, number, number, number];
};

export type CameraAction =
  | {
      kind: "fit";
      bounds: [[number, number], [number, number]];
      maxZoom: number;
      padding: number;
    }
  | { kind: "fly"; center: [number, number]; zoom: number };

export type FlyToTarget = {
  lng: number;
  lat: number;
  bbox?: { west: number; south: number; east: number; north: number };
};

type FlyToParamsInput = URLSearchParams | { flyto?: string | null; bbox?: string | null };

function readParam(input: FlyToParamsInput, key: "flyto" | "bbox"): string | null {
  if (input instanceof URLSearchParams) return input.get(key);
  return input[key] ?? null;
}

/** A finite decimal number - rejects "", whitespace-only, NaN, and ±Infinity. */
function toFiniteNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseCenter(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lng = toFiniteNumber(parts[0]!);
  const lat = toFiniteNumber(parts[1]!);
  if (lng === null || lat === null) return null;
  if (lng < -180 || lng > 180) return null;
  if (lat < -90 || lat > 90) return null;
  return [lng, lat];
}

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 4) return null;
  const west = toFiniteNumber(parts[0]!);
  const south = toFiniteNumber(parts[1]!);
  const east = toFiniteNumber(parts[2]!);
  const north = toFiniteNumber(parts[3]!);
  if (west === null || south === null || east === null || north === null) return null;
  if (west < -180 || west > 180 || east < -180 || east > 180) return null;
  if (south < -90 || south > 90 || north < -90 || north > 90) return null;
  if (south >= north) return null;
  if (west >= east) return null;
  return [west, south, east, north];
}

/**
 * Parses the `flyto`/`bbox` query params. An invalid/absent **center** yields
 * `null` (do nothing but clear); an invalid **bbox** is silently dropped (falls
 * back to a center-only fly) - it never invalidates an otherwise-valid center.
 * Accepts either a real `URLSearchParams` (e.g. Next's `useSearchParams()`) or a
 * plain `{ flyto?, bbox? }` object for tests/callers that already have the raw
 * strings.
 */
export function parseFlyToParam(input: FlyToParamsInput): ParsedFlyTo | null {
  const center = parseCenter(readParam(input, "flyto"));
  if (!center) return null;

  const result: ParsedFlyTo = { center };
  const bbox = parseBbox(readParam(input, "bbox"));
  if (bbox) result.bbox = bbox;
  return result;
}

/**
 * The `flyto=…(&bbox=…)` query string the header search writes on select, e.g.
 * `router.push("/?" + buildFlyToQuery(target))`. Literal commas (not
 * `URLSearchParams`-encoded `%2C`) to match the canonical wire format exactly.
 */
export function buildFlyToQuery(target: FlyToTarget): string {
  const parts = [`flyto=${target.lng},${target.lat}`];
  if (target.bbox) {
    const { west, south, east, north } = target.bbox;
    parts.push(`bbox=${west},${south},${east},${north}`);
  }
  return parts.join("&");
}

/**
 * Chooses the map's camera move for a parsed `flyto`/`bbox` pair - the
 * unit-tested seam between URL parsing and the actual `mapRef` call
 * (`MapBrowser` executes the returned action; it does not decide between them).
 * bbox present -> fit the map to the extent, capped at `PLACE_MIN_ZOOM` so an
 * address zooms to the fountain-visible level while a country's huge bbox stays
 * wide (fitBounds naturally won't exceed the cap). bbox absent -> fly to the
 * point at `NEIGHBORHOOD_ZOOM`.
 */
export function deriveCameraAction(parsed: ParsedFlyTo): CameraAction {
  if (parsed.bbox) {
    const [west, south, east, north] = parsed.bbox;
    return {
      kind: "fit",
      bounds: [
        [west, south],
        [east, north],
      ],
      maxZoom: PLACE_MIN_ZOOM,
      padding: 48,
    };
  }
  return { kind: "fly", center: parsed.center, zoom: NEIGHBORHOOD_ZOOM };
}
