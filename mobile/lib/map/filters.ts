import type { paths } from "@fountainrank/api-client";

import type { BboxParams } from "./bounds";

/** Typed query parameters for GET /api/v1/fountains/bbox (generated contract). */
type BboxQuery = NonNullable<paths["/api/v1/fountains/bbox"]["get"]["parameters"]["query"]>;

/** Basic public-discovery filters (spec Phase 3.7). A small, owner-facing subset
 *  of the API's filter parameters; the typed query stays compatible with the full
 *  generated set, so more filters can be added later without a contract change. */
export type FountainFilters = {
  workingNow: boolean;
  bottleFiller: boolean;
  wheelchairReachable: boolean;
  minRating: number | null;
};

export const DEFAULT_FILTERS: FountainFilters = {
  workingNow: false,
  bottleFiller: false,
  wheelchairReachable: false,
  minRating: null,
};

/** Merge the viewport bbox with only the *active* filters (omit false/null so the
 *  backend is not over-constrained). The result is the `query` for client.GET. */
export function buildBboxQuery(params: BboxParams, filters: FountainFilters): BboxQuery {
  const query: BboxQuery = { ...params };
  if (filters.workingNow) query.working_now = true;
  if (filters.bottleFiller) query.bottle_filler = true;
  if (filters.wheelchairReachable) query.wheelchair_reachable = true;
  if (filters.minRating != null) query.min_rating = filters.minRating;
  return query;
}

/** Stable TanStack Query key for a viewport + filter combination. */
export function fountainsQueryKey(params: BboxParams, filters: FountainFilters): unknown[] {
  return ["fountains", "bbox", params, filters];
}

export function hasActiveFilters(filters: FountainFilters): boolean {
  return (
    filters.workingNow ||
    filters.bottleFiller ||
    filters.wheelchairReachable ||
    filters.minRating != null
  );
}
