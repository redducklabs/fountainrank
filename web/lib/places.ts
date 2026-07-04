import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { resolveApiBaseUrl } from "./api";

// A crawlable place (country or city) from GET /api/v1/places (#127).
export type PlaceOut = components["schemas"]["PlaceOut"];

export type PlacesResult = { data: PlaceOut[]; status: number };

// Pure: the public route for a country page. The segment is the ISO-3166-1 alpha-2 code,
// lowercased (the DB stores it lowercased and the canonical URL is lowercase).
export function countryPath(countryCode: string): string {
  return `/drinking-fountains/${countryCode.toLowerCase()}`;
}

// Pure: the public route for a city page (country segment + the city's sticky slug).
export function cityPath(countryCode: string, slug: string): string {
  return `/drinking-fountains/${countryCode.toLowerCase()}/${slug}`;
}

// Server-only fetch of the public place list. This module is client-bundlable, so it never
// reads a token (the endpoint is public/unauthenticated). A network error yields an empty
// list with status 0 (the caller decides between "render empty" and notFound()).
async function getPlaces(
  query: { country?: string; limit?: number; offset?: number },
  requestId?: string,
): Promise<PlacesResult> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/places", { params: { query } });
    return { data: data ?? [], status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: [], status: 0 };
  }
}

// The canonical, indexable countries (fountain_count >= K), most-populous first.
export function getCountriesServer(requestId?: string, limit = 200): Promise<PlacesResult> {
  return getPlaces({ limit }, requestId);
}

// A country's top cities (its canonical children >= K), most-populous first.
export function getCountryCitiesServer(
  country: string,
  requestId?: string,
  limit = 48,
): Promise<PlacesResult> {
  return getPlaces({ country, limit }, requestId);
}
