import { MAX_BBOX_RESULTS, MIN_ZOOM } from "./constants";

export type RawBounds = { west: number; south: number; east: number; north: number };
export type BboxParams = { min_lat: number; min_lng: number; max_lat: number; max_lng: number };

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

export function normalizeBounds(
  b: RawBounds,
): { skip: true } | { skip: false; params: BboxParams } {
  const min_lat = clampLat(b.south),
    max_lat = clampLat(b.north);
  const min_lng = wrapLng(b.west),
    max_lng = wrapLng(b.east);
  if (min_lng > max_lng || min_lat > max_lat) return { skip: true }; // antimeridian/degenerate -> skip
  return { skip: false, params: { min_lat, min_lng, max_lat, max_lng } };
}

export const shouldLoadPins = (zoom: number) => zoom >= MIN_ZOOM;
export const isAtCap = (count: number) => count >= MAX_BBOX_RESULTS;
