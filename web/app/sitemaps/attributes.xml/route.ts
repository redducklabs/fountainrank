import { ATTRIBUTE_PAGES, NEAR_ME_PATH, getFountainsByAttributeServer } from "../../../lib/places";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "attributes" chunk: the global attribute pages that are currently indexable (>= K_attr, the
// backend's `indexable` verdict) plus the always-indexable near-me hub. A below-gate or unreachable
// attribute page is `noindex`, so it is omitted here too — the sitemap never advertises a noindex
// URL. Dynamic so the set reflects live attribute coverage and `next build` never fetches the API.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const urls: SitemapUrl[] = [];
  for (const page of ATTRIBUTE_PAGES) {
    const { data } = await getFountainsByAttributeServer(page.attribute, crypto.randomUUID());
    if (data?.indexable) {
      urls.push({ loc: `${SITE_URL}${page.path}`, changefreq: "weekly", priority: 0.6 });
    }
  }
  // The near-me hub is static and always indexable (it links out to the map + top places).
  urls.push({ loc: `${SITE_URL}${NEAR_ME_PATH}`, changefreq: "weekly", priority: 0.6 });
  return sitemapResponse(buildUrlset(urls));
}
