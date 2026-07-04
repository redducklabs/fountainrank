import {
  cityPath,
  getCountriesServer,
  getCountryCitiesServer,
  SITEMAP_COUNTRY_CAP,
} from "../../../lib/places";
import { log } from "../../../lib/server/log";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "cities" chunk: every ready (>= K) city under every ready country. Dynamic so it reflects
// live membership and `next build` never fetches the API. Cities are the primary SEO payoff.
export const dynamic = "force-dynamic";

// The /api/v1/places limit cap. If a country ever has more ready cities than this, some are
// omitted — logged, not silent. A soft ceiling near the sitemap 50k-URL limit warns us to split
// this into multiple chunks before it breaks (US/LU are far under both today).
const PER_COUNTRY_CAP = 1000;
const CHUNK_SOFT_LIMIT = 45000;

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  // Fetch ALL ready countries (the API max) so no country's cities are silently dropped; log if we
  // ever hit the cap.
  const { data: countries } = await getCountriesServer(requestId, SITEMAP_COUNTRY_CAP);
  if (countries.length >= SITEMAP_COUNTRY_CAP) {
    log("warn", "cities sitemap hit the country cap; some countries' cities omitted", {
      cap: SITEMAP_COUNTRY_CAP,
    });
  }

  const perCountry = await Promise.all(
    countries.map(async (country) => {
      const { data: cities } = await getCountryCitiesServer(
        country.country_code,
        requestId,
        PER_COUNTRY_CAP,
      );
      if (cities.length >= PER_COUNTRY_CAP) {
        log("warn", "cities sitemap hit the per-country cap; some cities omitted", {
          country: country.country_code,
          cap: PER_COUNTRY_CAP,
        });
      }
      return cities;
    }),
  );

  const cities = perCountry.flat();
  if (cities.length > CHUNK_SOFT_LIMIT) {
    log("warn", "cities sitemap is approaching the 50k-URL limit; split into chunks", {
      urls: cities.length,
    });
  }

  const urls: SitemapUrl[] = cities.map((c) => ({
    loc: `${SITE_URL}${cityPath(c.country_code, c.slug)}`,
    changefreq: "weekly",
    priority: 0.6,
  }));
  return sitemapResponse(buildUrlset(urls));
}
