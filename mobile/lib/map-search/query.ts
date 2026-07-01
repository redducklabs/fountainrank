// Typed geocode query for the search overlay (spec §7.2, backend §8.1). Builds
// the `GET /api/v1/geocode` call and maps the typed response to the app's own
// list model - the provider (LocationIQ) is invisible past this module. No
// React - the overlay (Task 11) owns dispatch/AbortController and feeds the
// result of `searchGeocode`/`mapGeocodeError` into `map-search/state.ts`.

import type { components } from "@fountainrank/api-client";

import { ApiError, unwrap, type MobileApiClient } from "../api";
import type { SearchErrorReason, SearchResultItem } from "./state";

export type GeocodeResult = components["schemas"]["GeocodeResult"];

/** Mirrors the backend's own default (spec §8.1: `limit: int = 5`). */
export const DEFAULT_GEOCODE_LIMIT = 5;

export type GeocodeSearchParams = {
  q: string;
  limit?: number;
  /** Optional viewport-bias hint (spec §7.1) - only applied server-side when both are present. */
  lat?: number;
  lng?: number;
};

/**
 * Map the typed `GeocodeResult[]` (`{ label, latitude, longitude }`) to the
 * app's list model, deriving a stable `id` from the coordinate pair plus the
 * result's index - two results sharing identical coordinates (e.g. two POIs
 * at the same address) still get distinct ids.
 */
export function mapGeocodeResults(results: GeocodeResult[]): SearchResultItem[] {
  return results.map((result, index) => ({
    id: `${result.latitude},${result.longitude},${index}`,
    label: result.label,
    latitude: result.latitude,
    longitude: result.longitude,
  }));
}

/**
 * Every documented failure mode - `503 geocoding_disabled`/`geocoding_unavailable`,
 * `502 geocoding_upstream`, `429` (throttled), and a network/offline failure with
 * no HTTP status at all - maps to the SAME view-state reason. v1 has exactly one
 * error UI ("Search is unavailable right now", spec §7.1); this function is the
 * single place that decision lives, so a future distinct reason is a one-line
 * change here rather than a scattered set of status checks in the overlay.
 */
export function mapGeocodeError(error: unknown): SearchErrorReason {
  if (error instanceof ApiError) {
    // 503 (disabled/quota-exhausted), 502 (upstream), 429 (throttled) all
    // degrade to the same "unavailable" UI (spec §7.1) - there is no
    // differentiated messaging in v1.
    return "unavailable";
  }
  // No HTTP status at all - a network/offline failure - same UI as above.
  return "unavailable";
}

/**
 * Builds and issues the typed `GET /api/v1/geocode` call, unwraps the response
 * with the shared `unwrap` helper (throws `ApiError(status)` on a non-2xx
 * response, same as every other mobile query), and maps the result set to the
 * list model. Callers catch the rejection and pass it to `mapGeocodeError` to
 * get the view-state reason - kept separate so query-building/mapping and
 * error-classification are each independently testable.
 */
export async function searchGeocode(
  client: MobileApiClient,
  params: GeocodeSearchParams,
): Promise<SearchResultItem[]> {
  const result = await client.GET("/api/v1/geocode", {
    params: {
      query: {
        q: params.q,
        limit: params.limit ?? DEFAULT_GEOCODE_LIMIT,
        lat: params.lat,
        lng: params.lng,
      },
    },
  });
  const data = unwrap(result);
  return mapGeocodeResults(data.results);
}
