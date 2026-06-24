import {
  ACCURACY_MAX_M,
  BOUND_RADIUS_MIN_M,
  FALLBACK_MAX_SPAN_M,
  NUDGE_STEP_M,
  PLACE_MIN_ZOOM,
} from "../map/constants";

export type LngLat = { lng: number; lat: number };
export type ViewportBounds = { west: number; south: number; east: number; north: number };
export type Bound =
  | { kind: "circle"; center: LngLat; radiusM: number }
  | { kind: "viewport"; bounds: ViewportBounds };
export type GpsFix =
  | { ok: true; latitude: number; longitude: number; accuracy: number | null }
  | { ok: false };

const EARTH_R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function boundFromFix(fix: GpsFix, viewport: ViewportBounds): Bound {
  if (fix.ok && fix.accuracy != null && fix.accuracy <= ACCURACY_MAX_M) {
    return {
      kind: "circle",
      center: { lng: fix.longitude, lat: fix.latitude },
      radiusM: Math.max(BOUND_RADIUS_MIN_M, fix.accuracy),
    };
  }
  return { kind: "viewport", bounds: viewport };
}

export function clampToBound(point: LngLat, bound: Bound): LngLat {
  if (bound.kind === "circle") {
    const distance = haversineMeters(bound.center, point);
    if (distance <= bound.radiusM) return point;
    const ratio = bound.radiusM / distance;
    return {
      lng: bound.center.lng + (point.lng - bound.center.lng) * ratio,
      lat: bound.center.lat + (point.lat - bound.center.lat) * ratio,
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

export function viewportDiagonalMeters(bounds: ViewportBounds): number {
  return haversineMeters(
    { lng: bounds.west, lat: bounds.north },
    { lng: bounds.east, lat: bounds.south },
  );
}

export function canPlace(zoom: number, bound: Bound | null): boolean {
  if (!bound || zoom < PLACE_MIN_ZOOM) return false;
  if (bound.kind === "viewport" && viewportDiagonalMeters(bound.bounds) > FALLBACK_MAX_SPAN_M) {
    return false;
  }
  return true;
}

export function nudgePoint(point: LngLat, direction: "n" | "s" | "e" | "w"): LngLat {
  const dLat = NUDGE_STEP_M / 111320;
  const dLng = NUDGE_STEP_M / (111320 * Math.cos((point.lat * Math.PI) / 180));
  if (direction === "n") return { lng: point.lng, lat: point.lat + dLat };
  if (direction === "s") return { lng: point.lng, lat: point.lat - dLat };
  if (direction === "e") return { lng: point.lng + dLng, lat: point.lat };
  return { lng: point.lng - dLng, lat: point.lat };
}

export function ringFeatureCollection(bound: Bound | null): GeoJSON.FeatureCollection {
  if (!bound || bound.kind !== "circle") return { type: "FeatureCollection", features: [] };
  const { center, radiusM } = bound;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    coordinates.push([center.lng + dLng * Math.cos(angle), center.lat + dLat * Math.sin(angle)]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }],
  };
}

export function pinFeatureCollection(point: LngLat | null): GeoJSON.FeatureCollection {
  if (!point) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      },
    ],
  };
}
