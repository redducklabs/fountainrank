import {
  getCountriesServer,
  getCountryRegionsServer,
  regionPath,
  SITEMAP_COUNTRY_CAP,
} from "../../../lib/places";
import { log } from "../../../lib/server/log";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "regions" chunk: canonical region pages under ready countries. Two-level countries simply
// return no regions. Dynamic so it reflects live membership and never fetches the API at build.
export const dynamic = "force-dynamic";

const PER_COUNTRY_CAP = 1000;
const CHUNK_SOFT_LIMIT = 45000;

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const { data: countries } = await getCountriesServer(requestId, SITEMAP_COUNTRY_CAP);
  if (countries.length >= SITEMAP_COUNTRY_CAP) {
    log("warn", "regions sitemap hit the country cap; some countries' regions omitted", {
      cap: SITEMAP_COUNTRY_CAP,
    });
  }

  const perCountry = await Promise.all(
    countries.map(async (country) => {
      const { data: regions } = await getCountryRegionsServer(
        country.country_code,
        requestId,
        PER_COUNTRY_CAP,
      );
      if (regions.length >= PER_COUNTRY_CAP) {
        log("warn", "regions sitemap hit the per-country cap; some regions omitted", {
          country: country.country_code,
          cap: PER_COUNTRY_CAP,
        });
      }
      return regions;
    }),
  );

  const regions = perCountry.flat();
  if (regions.length > CHUNK_SOFT_LIMIT) {
    log("warn", "regions sitemap is approaching the 50k-URL limit; split into chunks", {
      urls: regions.length,
    });
  }

  const urls: SitemapUrl[] = regions.map((region) => ({
    loc: `${SITE_URL}${regionPath(region.country_code, region.slug)}`,
    changefreq: "weekly",
    priority: 0.6,
  }));
  return sitemapResponse(buildUrlset(urls));
}
