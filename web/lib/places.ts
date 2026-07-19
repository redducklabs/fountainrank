import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { resolveApiBaseUrl } from "./api";

// A crawlable place (country or city) from GET /api/v1/places (#127).
export type PlaceOut = components["schemas"]["PlaceOut"];

export type PlacesResult = { data: PlaceOut[]; status: number };

// The backend /api/v1/places `limit` hard cap (server enforces le=1000). Sitemap builders fetch at
// this cap so they never silently drop rows, and log if a single call ever returns a full page
// (a signal to paginate). Comfortably above the ~195 real countries.
export const SITEMAP_COUNTRY_CAP = 1000;

// Pure: the public route for a country page. The segment is the ISO-3166-1 alpha-2 code,
// lowercased (the DB stores it lowercased and the canonical URL is lowercase).
export function countryPath(countryCode: string): string {
  return `/drinking-fountains/${countryCode.toLowerCase()}`;
}

// Pure: the public route for a region page.
export function regionPath(countryCode: string, regionSlug: string): string {
  return `/drinking-fountains/${countryCode.toLowerCase()}/${regionSlug}`;
}

// Pure: the public route for a city page. Region-tier cities include their parent region slug;
// two-level countries omit it.
export function cityPath(countryCode: string, slug: string, regionSlug?: string | null): string {
  const cc = countryCode.toLowerCase();
  return regionSlug
    ? `/drinking-fountains/${cc}/${regionSlug}/${slug}`
    : `/drinking-fountains/${cc}/${slug}`;
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

// Countries with fountains for the browse hub, most-populous first. Each row carries the backend's
// `indexable` verdict for sitemap/page consumers.
export function getCountriesServer(requestId?: string, limit = 200): Promise<PlacesResult> {
  return getPlaces({ limit }, requestId);
}

// A country's top cities (its canonical children >= K), most-populous first.
export function getCountryCitiesServer(
  country: string,
  requestId?: string,
  limit = 48,
): Promise<PlacesResult> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  return client
    .GET("/api/v1/places/{country}/cities", {
      params: { path: { country }, query: { limit } },
    })
    .then(({ data, response }) => ({ data: data ?? [], status: response?.status ?? 0 }))
    .catch(() => ({ data: [], status: 0 }));
}

export function getCountryRegionsServer(
  country: string,
  requestId?: string,
  limit = 48,
): Promise<PlacesResult> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  return client
    .GET("/api/v1/places/{country}/regions", {
      params: { path: { country }, query: { limit } },
    })
    .then(({ data, response }) => ({ data: data ?? [], status: response?.status ?? 0 }))
    .catch(() => ({ data: [], status: 0 }));
}

export function getRegionCitiesServer(
  country: string,
  region: string,
  requestId?: string,
  limit = 48,
): Promise<PlacesResult> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  return client
    .GET("/api/v1/places/{country}/regions/{region}/cities", {
      params: { path: { country, region }, query: { limit } },
    })
    .then(({ data, response }) => ({ data: data ?? [], status: response?.status ?? 0 }))
    .catch(() => ({ data: [], status: 0 }));
}

// A canonical city + its ranked fountains (#127 Slice 3). `indexable` is the backend's thin-content
// verdict (fountain_count >= K); the page sets `noindex` from it. status 404 => no such city.
export type CityFountainsOut = components["schemas"]["CityFountainsOut"];
export type PlaceResolveOut = components["schemas"]["PlaceResolveOut"];

export async function resolvePlaceServer(
  country: string,
  slug: string,
  requestId?: string,
): Promise<{ data: PlaceResolveOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/places/{country}/resolve/{slug}", {
      params: { path: { country, slug } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    return { data: undefined, status: 0 };
  }
}

export async function getCityFountainsServer(
  country: string,
  city: string,
  requestId?: string,
  limit = 100,
): Promise<{ data: CityFountainsOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/places/{country}/{city}/fountains", {
      params: { path: { country, city }, query: { limit } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}

export async function getNestedCityFountainsServer(
  country: string,
  region: string,
  city: string,
  requestId?: string,
  limit = 100,
): Promise<{ data: CityFountainsOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET(
      "/api/v1/places/{country}/regions/{region}/cities/{city}/fountains",
      {
        params: { path: { country, region, city }, query: { limit } },
      },
    );
    return { data, status: response?.status ?? 0 };
  } catch {
    return { data: undefined, status: 0 };
  }
}

export async function getRegionFountainsServer(
  country: string,
  region: string,
  requestId?: string,
  limit = 100,
): Promise<{ data: CityFountainsOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET(
      "/api/v1/places/{country}/regions/{region}/fountains",
      {
        params: { path: { country, region }, query: { limit } },
      },
    );
    return { data, status: response?.status ?? 0 };
  } catch {
    return { data: undefined, status: 0 };
  }
}

// --- Attribute pages (#127 Slice 4, spec §4.5) -----------------------------------------------

// The two crawlable attribute keys. Mirrors the backend `SeoAttribute` Literal (and the union the
// generated client already enforces on the `attribute` query param) — a superset here would be a
// compile error at the getFountainsByAttributeServer call site below.
export type SeoAttributeKey = "bottle_filler" | "wheelchair_reachable";

// A global attribute page's ranked fountains. `indexable` is the backend's thin-content verdict
// (total_count >= K_attr); the page sets `noindex` from it without knowing the threshold.
export type AttributeFountainsOut = components["schemas"]["AttributeFountainsOut"];

// The attribute pages that appear in the sitemap, each with the API key that gates its indexability.
// Their URLs are intentionally different shapes (one nested under /drinking-fountains, one top-level)
// for the target search phrases, so they are separate static routes rather than one dynamic segment.
export const ATTRIBUTE_PAGES: { path: string; attribute: SeoAttributeKey }[] = [
  { path: "/drinking-fountains/bottle-fillers", attribute: "bottle_filler" },
  { path: "/wheelchair-accessible-drinking-fountains", attribute: "wheelchair_reachable" },
];

// The static near-me hub page (always indexable — it links out to the map + top places).
export const NEAR_ME_PATH = "/drinking-fountains-near-me";

// Server-only fetch of a global attribute page's ranked fountains. A network error yields
// `undefined` with status 0 (the page renders an error state rather than a false 404/noindex).
export async function getFountainsByAttributeServer(
  attribute: SeoAttributeKey,
  requestId?: string,
  limit = 100,
): Promise<{ data: AttributeFountainsOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/by-attribute", {
      params: { query: { attribute, limit } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}

// --- Fountain detail metadata + fountains sitemap (#127 Slice 5, spec §5/§6/§7) --------------

// Pure: the public route for a single fountain's detail page (its own canonical URL).
export function fountainPath(id: string): string {
  return `/fountains/${id}`;
}

// One fountain's PUBLIC place membership + the backend's §7 indexability verdict. `city`/`country`
// are the precomputed places (or null when unmatched); `indexable` is the single server-side
// predicate, so the page sets `noindex` from it without re-deriving the rule. The detail page's
// generateMetadata + h1 use ONLY this public data — never the viewer/admin detail path (spec §7).
export type FountainPlaceOut = components["schemas"]["FountainPlaceOut"];

export async function getFountainPlaceServer(
  id: string,
  requestId?: string,
): Promise<{ data: FountainPlaceOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}/place", {
      params: { path: { fountain_id: id } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}

// The indexable fountain ids for the fountains sitemap chunk (spec §6/§7).
export type FountainSitemapOut = components["schemas"]["FountainSitemapOut"];

// The backend /api/v1/fountains/sitemap `limit` hard cap (server enforces le=50000). Each sitemap
// chunk fetches exactly one capped page; the sitemap index sizes chunk URLs from `total_count`.
export const SITEMAP_FOUNTAIN_CAP = 50000;

// Server-only fetch of the indexable fountain ids. A network error yields `undefined` with status 0
// (the sitemap builder then emits an empty urlset rather than a partial/false one).
export async function getIndexableFountainsServer(
  requestId?: string,
  limit = SITEMAP_FOUNTAIN_CAP,
  offset = 0,
): Promise<{ data: FountainSitemapOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/sitemap", {
      params: { query: { limit, offset } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}

// --- Cities sitemap (flat, chunked enumeration) — spec §6/§7 ---------------------------------

// One indexable city's canonical-URL parts. `region_slug` is the parent region's slug for a
// region-tier country (nested `/[country]/[region]/[city]`) or null for a two-level country.
export type CitySitemapItem = components["schemas"]["CitySitemapItem"];
export type CitySitemapOut = components["schemas"]["CitySitemapOut"];

// The backend /api/v1/places/cities/sitemap `limit` hard cap (server enforces le=50000). Each cities
// sitemap chunk fetches exactly one capped page; the sitemap index sizes chunk URLs from
// `total_count`. Mirrors SITEMAP_FOUNTAIN_CAP so the two chunked sitemaps behave identically.
export const SITEMAP_CITY_CAP = 50000;

// Server-only fetch of the indexable cities' URL parts (canonical, city-routes-ready, >= K). A
// network error yields `undefined` with status 0 (the sitemap builder then emits a transient 503
// rather than a partial/false sitemap). This single flat, offset-paginated query replaces the old
// per-country -> per-region -> per-region-cities fan-out.
export async function getSitemapCitiesServer(
  requestId?: string,
  limit = SITEMAP_CITY_CAP,
  offset = 0,
): Promise<{ data: CitySitemapOut | undefined; status: number }> {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/places/cities/sitemap", {
      params: { query: { limit, offset } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}
