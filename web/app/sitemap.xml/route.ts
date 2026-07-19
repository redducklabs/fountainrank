import {
  getIndexableFountainsServer,
  getSitemapCitiesServer,
  SITEMAP_CITY_CAP,
  SITEMAP_FOUNTAIN_CAP,
} from "../../lib/places";
import { log } from "../../lib/server/log";
import { SITE_URL } from "../../lib/seo/site";
import { buildSitemapIndex, sitemapResponse } from "../../lib/seo/sitemap";

// The sitemap INDEX, served at /sitemap.xml (robots.ts points here). Next's generateSitemaps
// does not produce an index, so we serve one explicitly that references the chunk sitemaps.
// Dynamic because the fountain + city sitemap chunk counts come from the live backend total_count.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  // Both counts come from the same backend; fetch them together. A count of 1 is enough to read
  // total_count while transferring almost nothing.
  const [fountains, cities] = await Promise.all([
    getIndexableFountainsServer(requestId, 1, 0),
    getSitemapCitiesServer(requestId, 1, 0),
  ]);
  if (!fountains.data || !cities.data) {
    log("error", "sitemap index: chunk-count fetch failed", {
      fountainStatus: fountains.status,
      cityStatus: cities.status,
    });
    return new Response("", {
      status: 503,
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const fountainChunkCount = Math.ceil(fountains.data.total_count / SITEMAP_FOUNTAIN_CAP);
  const fountainChunks = Array.from(
    { length: fountainChunkCount },
    (_, i) => `${SITE_URL}/sitemaps/fountains/${i}.xml`,
  );
  const cityChunkCount = Math.ceil(cities.data.total_count / SITEMAP_CITY_CAP);
  const cityChunks = Array.from(
    { length: cityChunkCount },
    (_, i) => `${SITE_URL}/sitemaps/cities/${i}.xml`,
  );
  const chunks = [
    `${SITE_URL}/sitemaps/core.xml`,
    `${SITE_URL}/sitemaps/countries.xml`,
    `${SITE_URL}/sitemaps/regions.xml`,
    ...cityChunks,
    `${SITE_URL}/sitemaps/attributes.xml`,
    ...fountainChunks,
  ];
  return sitemapResponse(buildSitemapIndex(chunks));
}
