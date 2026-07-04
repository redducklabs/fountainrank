import { SITE_URL } from "../../lib/seo/site";
import { buildSitemapIndex, sitemapResponse } from "../../lib/seo/sitemap";

// The sitemap INDEX, served at /sitemap.xml (robots.ts points here). Next's generateSitemaps
// does not produce an index, so we serve one explicitly that references the chunk sitemaps.
// Static content (chunk URLs are fixed); the chunks themselves carry the live data.
export function GET(): Response {
  const chunks = [`${SITE_URL}/sitemaps/core.xml`, `${SITE_URL}/sitemaps/countries.xml`];
  return sitemapResponse(buildSitemapIndex(chunks));
}
