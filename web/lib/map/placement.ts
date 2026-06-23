import {
  ACCURACY_MAX_M,
  BOUND_RADIUS_MIN_M,
  FALLBACK_MAX_SPAN_M,
  PLACE_MIN_ZOOM,
} from "./constants";

export type LngLat = { lng: number; lat: number };
export type ViewportBounds = { west: number; south: number; east: number; north: number };
export type Bound =
  | { kind: "circle"; center: LngLat; radiusM: number }
  | { kind: "viewport"; bounds: ViewportBounds };
export type GpsFix = { ok: true; lat: number; lng: number; accuracy: number } | { ok: false };

const EARTH_R = 6371008.8; // mean Earth radius (m)
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Proximity circle when we have a usable fix; otherwise a viewport (precision-only) bound (spec §6).
export function boundFromFix(fix: GpsFix, viewport: ViewportBounds): Bound {
  if (fix.ok && fix.accuracy <= ACCURACY_MAX_M) {
    return {
      kind: "circle",
      center: { lng: fix.lng, lat: fix.lat },
      radiusM: Math.max(BOUND_RADIUS_MIN_M, fix.accuracy),
    };
  }
  return { kind: "viewport", bounds: viewport };
}

// Pull a candidate point to the bound. Circle: interpolate toward center to the ring edge (a good
// approximation at the small radii used here, ≤ ~1 km). Viewport: clamp lng/lat into the rectangle.
export function clampToBound(point: LngLat, bound: Bound): LngLat {
  if (bound.kind === "circle") {
    const d = haversineMeters(bound.center, point);
    if (d <= bound.radiusM) return point;
    const t = bound.radiusM / d;
    return {
      lng: bound.center.lng + (point.lng - bound.center.lng) * t,
      lat: bound.center.lat + (point.lat - bound.center.lat) * t,
    };
  }
  const { west, south, east, north } = bound.bounds;
  return {
    lng: Math.min(east, Math.max(west, point.lng)),
    lat: Math.min(north, Math.max(south, point.lat)),
  };
}

export function inBound(point: LngLat, bound: Bound): boolean {
  if (bound.kind === "circle") {
    return haversineMeters(bound.center, point) <= bound.radiusM + 0.5;
  }
  const { west, south, east, north } = bound.bounds;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

function viewportDiagonalM(b: ViewportBounds): number {
  return haversineMeters({ lng: b.west, lat: b.north }, { lng: b.east, lat: b.south });
}

// Placement-precision gate (spec §6): both modes require zoom >= PLACE_MIN_ZOOM; the fallback
// viewport additionally caps the visible diagonal at FALLBACK_MAX_SPAN_M (screen-size-independent).
export function canPlace(zoom: number, bound: Bound): boolean {
  if (zoom < PLACE_MIN_ZOOM) return false;
  if (bound.kind === "viewport" && viewportDiagonalM(bound.bounds) > FALLBACK_MAX_SPAN_M) {
    return false;
  }
  return true;
}

// A dashed ring polyline for a circle bound (empty for a viewport bound). Pure -> testable.
export function ringFeatureCollection(bound: Bound | null): GeoJSON.FeatureCollection {
  if (!bound || bound.kind !== "circle") return { type: "FeatureCollection", features: [] };
  const { center, radiusM } = bound;
  const dLat = radiusM / 111320;
  const dLngBase = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const coords: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([center.lng + dLngBase * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
    ],
  };
}
