import {
  cityPath,
  getCountriesServer,
  getCountryCitiesServer,
  getCountryRegionsServer,
  getRegionCitiesServer,
  SITEMAP_COUNTRY_CAP,
} from "../../../lib/places";
import { log } from "../../../lib/server/log";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "cities" chunk: every ready (>= K) city under every ready country. Countries with regions use
// nested /<country>/<region>/<city> URLs; two-level countries keep the legacy /<country>/<city>
// shape. Dynamic so it reflects live membership and `next build` never fetches the API.
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

  const readyCountries = countries.filter((country) => country.indexable);
  const perCountryUrls = await Promise.all(
    readyCountries.map(async (country) => {
      const { data: regions } = await getCountryRegionsServer(
        country.country_code,
        requestId,
        PER_COUNTRY_CAP,
      );
      if (regions.length >= PER_COUNTRY_CAP) {
        log("warn", "cities sitemap hit the per-country region cap; some regions omitted", {
          country: country.country_code,
          cap: PER_COUNTRY_CAP,
        });
      }
      if (regions.length > 0) {
        const perRegion = await Promise.all(
          regions.map(async (region) => {
            const { data: cities } = await getRegionCitiesServer(
              country.country_code,
              region.slug,
              requestId,
              PER_COUNTRY_CAP,
            );
            if (cities.length >= PER_COUNTRY_CAP) {
              log("warn", "cities sitemap hit the per-region cap; some cities omitted", {
                country: country.country_code,
                region: region.slug,
                cap: PER_COUNTRY_CAP,
              });
            }
            return cities
              .filter((c) => c.indexable)
              .map((c) => ({
                loc: `${SITE_URL}${cityPath(c.country_code, c.slug, region.slug)}`,
                changefreq: "weekly" as const,
                priority: 0.6,
              }));
          }),
        );
        return perRegion.flat();
      }

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
      return cities
        .filter((c) => c.indexable)
        .map((c) => ({
          loc: `${SITE_URL}${cityPath(c.country_code, c.slug)}`,
          changefreq: "weekly" as const,
          priority: 0.6,
        }));
    }),
  );

  const urls: SitemapUrl[] = perCountryUrls.flat();
  if (urls.length > CHUNK_SOFT_LIMIT) {
    log("warn", "cities sitemap is approaching the 50k-URL limit; split into chunks", {
      urls: urls.length,
    });
  }

  return sitemapResponse(buildUrlset(urls));
}
