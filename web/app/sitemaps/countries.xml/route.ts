import { getCountriesServer, countryPath } from "../../../lib/places";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "countries" chunk: only ready, indexable countries (fountain_count >= K — the API already
// applies the gate). Dynamic so the chunk reflects live membership and `next build` never fetches
// the API (the backend isn't running at build). Well under the 50k-URL chunk limit.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const { data: countries } = await getCountriesServer(requestId);
  const urls: SitemapUrl[] = countries.map((c) => ({
    loc: `${SITE_URL}${countryPath(c.country_code)}`,
    changefreq: "weekly",
    priority: 0.7,
  }));
  return sitemapResponse(buildUrlset(urls));
}
