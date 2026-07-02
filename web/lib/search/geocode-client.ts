// Public geocode client for the web header search (design doc
// docs/specs/2026-07-01-web-search-and-mobile-polish-design.md §4.1). Calls the
// PUBLIC `GET /api/v1/geocode` proxy directly from the browser with NO
// `Authorization` header and NO token provider - the endpoint is public and the
// provider (LocationIQ) API key stays server-side in the backend proxy. This is a
// deliberate boundary: unlike `web/lib/server/api.ts` (which attaches the
// viewer's bearer token for authenticated reads), `geocodeClient` below is built
// from the bare `makeClient(resolveApiBaseUrl())` with no `headers`/token option,
// so a signed-in user's token can never leak onto a LocationIQ search call.
// Mirrors mobile/lib/map-search/query.ts (same mapping/error-classification
// shape), adapted to web's client conventions (see web/lib/catalog.ts).

import type { ApiClient, components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";

import { resolveApiBaseUrl } from "../api";
import type { SearchErrorReason, SearchResultItem } from "./state";

export type GeocodeResult = components["schemas"]["GeocodeResult"];

/** Mirrors the backend's own default (limit: int = 5). */
export const DEFAULT_GEOCODE_LIMIT = 5;

export type GeocodeSearchParams = {
  q: string;
  limit?: number;
  /** Optional viewport-bias hint - only applied server-side when both are present. */
  lat?: number;
  lng?: number;
};

/** Carries the HTTP status of a non-2xx `/api/v1/geocode` response. */
export class GeocodeApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`geocode request failed (status ${status})`);
    this.name = "GeocodeApiError";
    this.status = status;
  }
}

/**
 * Builds a fresh, UNAUTHENTICATED client for the public geocode endpoint - no
 * `headers` option, no token provider. A new client per call (rather than a
 * module-level singleton) matches the rest of web/lib's public-read helpers
 * (e.g. `catalog.ts`) and keeps `resolveApiBaseUrl()`'s env read live.
 */
export function geocodeClient(): ApiClient {
  return makeClient(resolveApiBaseUrl());
}

/**
 * Map the typed `GeocodeResult[]` (`{ label, latitude, longitude, bounding_box }`)
 * to the app's list model, deriving a stable `id` from the coordinate pair plus
 * the result's index - two results sharing identical coordinates (e.g. two POIs
 * at the same address) still get distinct ids. `bounding_box` is mapped to
 * `boundingBox` and omitted entirely when the backend returned `null`/absent
 * (spec §2: not every provider hit has a valid extent).
 */
export function mapGeocodeResults(results: GeocodeResult[]): SearchResultItem[] {
  return results.map((result, index) => {
    const item: SearchResultItem = {
      id: `${result.latitude},${result.longitude},${index}`,
      label: result.label,
      latitude: result.latitude,
      longitude: result.longitude,
    };
    if (result.bounding_box) {
      item.boundingBox = {
        south: result.bounding_box.south,
        west: result.bounding_box.west,
        north: result.bounding_box.north,
        east: result.bounding_box.east,
      };
    }
    return item;
  });
}

/**
 * Every documented failure mode - `503 geocoding_disabled`/`geocoding_unavailable`,
 * `502 geocoding_upstream`, `429` (throttled), and a network/offline failure with
 * no HTTP status at all - maps to the SAME view-state reason. v1 has exactly one
 * error UI ("Search is unavailable right now"); this function is the single place
 * that decision lives, so a future distinct reason is a one-line change here
 * rather than a scattered set of status checks in the component.
 */
export function mapGeocodeError(error: unknown): SearchErrorReason {
  void error;
  return "unavailable";
}

/**
 * Builds and issues the typed `GET /api/v1/geocode` call via the unauthenticated
 * `geocodeClient()`, throws `GeocodeApiError(status)` on a non-2xx response (or a
 * missing body), and otherwise maps the result set to the list model. Callers
 * catch the rejection and pass it to `mapGeocodeError` to get the view-state
 * reason. `signal` lets the caller cancel a superseded debounced request at the
 * network layer (not just via the `state.ts` seq-guard).
 */
export async function searchGeocode(
  params: GeocodeSearchParams,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const client = geocodeClient();
  const { data, error, response } = await client.GET("/api/v1/geocode", {
    params: {
      query: {
        q: params.q,
        limit: params.limit ?? DEFAULT_GEOCODE_LIMIT,
        lat: params.lat,
        lng: params.lng,
      },
    },
    signal,
  });
  if (error !== undefined || !data) {
    throw new GeocodeApiError(response?.status ?? 0);
  }
  return mapGeocodeResults(data.results);
}
