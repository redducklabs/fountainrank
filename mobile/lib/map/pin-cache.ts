import type { components } from "@fountainrank/api-client";

import type { BboxParams } from "./bounds";
import { hasActiveFilters, type FountainFilters } from "./filters";

type FountainPin = components["schemas"]["FountainPin"];
type FountainDetail = components["schemas"]["FountainDetail"];

/** The cached shape of a successful bbox query — mirrors the `pinsQuery` queryFn result. */
export type BboxResult = { pins: FountainPin[]; truncated: boolean };

/**
 * Build the map-pin shape from the full detail the POST already returned (spec §3.2 step 2).
 * Field-for-field; `distance_m` has no detail source (it is a per-viewport computed field) and
 * is omitted — it is optional on `FountainPin`.
 */
export function fountainPinFromDetail(detail: FountainDetail): FountainPin {
  return {
    id: detail.id,
    location: detail.location,
    is_working: detail.is_working,
    average_rating: detail.average_rating,
    rating_count: detail.rating_count,
    ranking_score: detail.ranking_score,
    current_status: detail.current_status,
    last_verified_at: detail.last_verified_at,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A cached pin element the helper can safely read: a non-null object with a string `id` (the only
 * field read from an EXISTING cached pin, in the same-id `findIndex`). Guards the successful-create
 * path against a corrupt cache entry like `{ pins: [null] }` — a malformed element must leave the
 * whole entry untouched, never throw from `onSuccess`.
 */
function isPinLike(value: unknown): value is FountainPin {
  return (
    value != null && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
  );
}

/** A structurally valid bbox params object: exactly four FINITE numbers. */
function asBboxParams(value: unknown): BboxParams | null {
  if (value == null || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (
    isFiniteNumber(p.min_lat) &&
    isFiniteNumber(p.min_lng) &&
    isFiniteNumber(p.max_lat) &&
    isFiniteNumber(p.max_lng)
  ) {
    return { min_lat: p.min_lat, min_lng: p.min_lng, max_lat: p.max_lat, max_lng: p.max_lng };
  }
  return null;
}

/** A structurally valid discovery-filters object. */
function asFountainFilters(value: unknown): FountainFilters | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const f = value as Record<string, unknown>;
  if (
    typeof f.workingNow === "boolean" &&
    typeof f.bottleFiller === "boolean" &&
    typeof f.wheelchairReachable === "boolean" &&
    (f.minRating === null || isFiniteNumber(f.minRating))
  ) {
    return {
      workingNow: f.workingNow,
      bottleFiller: f.bottleFiller,
      wheelchairReachable: f.wheelchairReachable,
      minRating: f.minRating as number | null,
    };
  }
  return null;
}

/** A structurally valid cached bbox result — including EVERY pin element (a malformed one leaves the
 *  entry untouched rather than crashing the same-id lookup). */
function asBboxResult(value: unknown): BboxResult | null {
  if (value == null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (Array.isArray(r.pins) && typeof r.truncated === "boolean" && r.pins.every(isPinLike)) {
    return { pins: r.pins as FountainPin[], truncated: r.truncated };
  }
  return null;
}

/**
 * Parse a query key that is EXACTLY the four-part bbox shape
 * `["fountains", "bbox", params, filters]` with structurally valid `params`/`filters`.
 * Anything else — the `["fountains", "bbox", "idle"]` placeholder, a wrong prefix, a malformed
 * params/filters — returns `null` so the entry is left untouched.
 */
function parseBboxKey(
  key: readonly unknown[],
): { params: BboxParams; filters: FountainFilters } | null {
  if (key.length !== 4 || key[0] !== "fountains" || key[1] !== "bbox") return null;
  const params = asBboxParams(key[2]);
  const filters = asFountainFilters(key[3]);
  if (!params || !filters) return null;
  return { params, filters };
}

/**
 * Pure bbox-cache seed (spec §3.2 step 2): given the `getQueriesData` entries for the
 * `["fountains","bbox"]` prefix and the created pin, return ONLY the entries that change, each
 * with a new immutable `BboxResult`, for the caller to `setQueryData`. Untouched entries are not
 * returned, so they keep their reference identity (no needless re-render).
 *
 * Rules:
 * - only the exact four-part bbox key with valid params/filters and a valid result is considered;
 * - a non-finite pin coordinate is a global no-op (returns `[]`);
 * - an entry with ACTIVE filters is skipped (the pin lacks consensus-attribute data to evaluate
 *   the filters client-side; those entries are invalidated instead — a wrong pin on a filtered map
 *   is wrong feedback);
 * - the pin is inserted when its coordinates fall INSIDE the params bounds INCLUSIVELY (matching
 *   the backend's `ST_MakeEnvelope`/`ST_Intersects` boundary);
 * - a same-id pin already present is REPLACED in place (the POST response is the authoritative
 *   freshest record); otherwise the pin is appended;
 * - `truncated` is preserved as-is.
 */
export function insertPinIntoBboxCaches(
  entries: readonly (readonly [readonly unknown[], unknown])[],
  pin: FountainPin,
): [readonly unknown[], BboxResult][] {
  const lat = pin.location?.latitude;
  const lng = pin.location?.longitude;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return [];

  const updates: [readonly unknown[], BboxResult][] = [];
  for (const [key, data] of entries) {
    const parsed = parseBboxKey(key);
    if (!parsed) continue;
    const result = asBboxResult(data);
    if (!result) continue;
    if (hasActiveFilters(parsed.filters)) continue;
    const { min_lat, min_lng, max_lat, max_lng } = parsed.params;
    const inside = lat >= min_lat && lat <= max_lat && lng >= min_lng && lng <= max_lng;
    if (!inside) continue;
    const index = result.pins.findIndex((existing) => existing.id === pin.id);
    const pins =
      index >= 0
        ? result.pins.map((existing, i) => (i === index ? pin : existing))
        : [...result.pins, pin];
    updates.push([key, { pins, truncated: result.truncated }]);
  }
  return updates;
}
