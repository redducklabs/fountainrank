import {
  fountainPath,
  getIndexableFountainsServer,
  SITEMAP_FOUNTAIN_CAP,
} from "../../../lib/places";
import { log } from "../../../lib/server/log";
import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "fountains" chunk: every individually-indexable fountain (the backend's §7 predicate — a city
// resolves, not hidden, and rated OR working-and-not-broken). A noindex fountain is omitted here
// too, so the sitemap never advertises a noindex URL. Dynamic so the set reflects live data and
// `next build` never fetches the API.
export const dynamic = "force-dynamic";

// Warn well below the 50k-URL sitemap limit so we split this into multiple chunks (generateSitemaps)
// before it breaks. The backend caps a single fetch at SITEMAP_FOUNTAIN_CAP (50k).
const CHUNK_SOFT_LIMIT = 45000;

export async function GET(): Promise<Response> {
  const { data, status } = await getIndexableFountainsServer(crypto.randomUUID());
  if (!data) {
    // Backend down / non-2xx: do NOT serve a cacheable empty sitemap — a transient outage would
    // stick at crawlers/CDNs as "no indexable fountains" for the full cache window. Log it and
    // return an uncacheable transient 503 so crawlers retry instead (spec §7 diagnosability).
    log("error", "fountains sitemap: indexable-fountains fetch failed", { status });
    return new Response("", {
      status: 503,
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const ids = data.fountain_ids;
  const total = data.total_count;
  if (total > ids.length) {
    // The fetch cap dropped some indexable fountains — surface it (never a silent truncation).
    log("warn", "fountains sitemap hit the fetch cap; some fountains omitted", {
      cap: SITEMAP_FOUNTAIN_CAP,
      total,
      returned: ids.length,
    });
  } else if (ids.length > CHUNK_SOFT_LIMIT) {
    log("warn", "fountains sitemap is approaching the 50k-URL limit; split into chunks", {
      urls: ids.length,
    });
  }

  const urls: SitemapUrl[] = ids.map((id) => ({
    loc: `${SITE_URL}${fountainPath(id)}`,
    changefreq: "weekly",
    priority: 0.5,
  }));
  return sitemapResponse(buildUrlset(urls));
}
