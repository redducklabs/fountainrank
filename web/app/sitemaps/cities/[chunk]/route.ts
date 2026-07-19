import { notFound } from "next/navigation";

import { cityPath, getSitemapCitiesServer, SITEMAP_CITY_CAP } from "../../../../lib/places";
import { log } from "../../../../lib/server/log";
import { SITE_URL } from "../../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../../lib/seo/sitemap";

// One zero-based cities sitemap chunk. The route segment is the full "{n}.xml" filename so invalid
// forms are a 404 instead of a silently empty sitemap. Region-tier cities nest their parent region
// (`/[country]/[region]/[city]`), two-level cities keep `/[country]/[city]` — the backend supplies
// `region_slug` per city so this route needs no per-city lookup. Dynamic so it reflects live
// membership and `next build` never fetches the API.
export const dynamic = "force-dynamic";

const CHUNK_SOFT_LIMIT = 45000;
const CHUNK_RE = /^(\d+)\.xml$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chunk: string }> },
): Promise<Response> {
  const { chunk } = await params;
  const match = CHUNK_RE.exec(chunk);
  if (!match) notFound();

  const chunkNumber = Number(match[1]);
  const offset = chunkNumber * SITEMAP_CITY_CAP;
  // An out-of-range chunk name (digits beyond the safe-integer range lose precision / overflow)
  // is an invalid URL, not a transient backend failure — 404 it rather than 503-ing a bad offset.
  if (!Number.isSafeInteger(chunkNumber) || !Number.isSafeInteger(offset)) notFound();
  const { data, status } = await getSitemapCitiesServer(
    crypto.randomUUID(),
    SITEMAP_CITY_CAP,
    offset,
  );
  if (!data) {
    log("error", "cities sitemap chunk: indexable-cities fetch failed", {
      chunk: chunkNumber,
      offset,
      status,
    });
    return new Response("", {
      status: 503,
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (offset >= data.total_count) notFound();

  const cities = data.cities;
  if (cities.length > CHUNK_SOFT_LIMIT) {
    log("warn", "cities sitemap chunk is approaching the 50k-URL limit", {
      chunk: chunkNumber,
      urls: cities.length,
    });
  }

  const urls: SitemapUrl[] = cities.map((c) => ({
    loc: `${SITE_URL}${cityPath(c.country_code, c.slug, c.region_slug)}`,
    changefreq: "weekly",
    priority: 0.6,
  }));
  return sitemapResponse(buildUrlset(urls));
}
