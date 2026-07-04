import { getCountriesServer, countryPath, SITEMAP_COUNTRY_CAP } from "../../../lib/places";
import { log } from "../../../lib/server/log";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "countries" chunk: only ready, indexable countries (fountain_count >= K — the API already
// applies the gate). Dynamic so the chunk reflects live membership and `next build` never fetches
// the API (the backend isn't running at build). Well under the 50k-URL chunk limit.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  // Fetch ALL ready countries (the API max, comfortably above the ~195 real countries) so the
  // sitemap never silently drops any. Log if we ever hit the cap rather than truncating quietly.
  const { data: countries } = await getCountriesServer(requestId, SITEMAP_COUNTRY_CAP);
  if (countries.length >= SITEMAP_COUNTRY_CAP) {
    log("warn", "countries sitemap hit the country cap; some countries omitted", {
      cap: SITEMAP_COUNTRY_CAP,
    });
  }
  const urls: SitemapUrl[] = countries.map((c) => ({
    loc: `${SITE_URL}${countryPath(c.country_code)}`,
    changefreq: "weekly",
    priority: 0.7,
  }));
  return sitemapResponse(buildUrlset(urls));
}
