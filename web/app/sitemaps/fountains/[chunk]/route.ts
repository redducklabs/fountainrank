import { notFound } from "next/navigation";

import {
  fountainPath,
  getIndexableFountainsServer,
  SITEMAP_FOUNTAIN_CAP,
} from "../../../../lib/places";
import { log } from "../../../../lib/server/log";
import { SITE_URL } from "../../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../../lib/seo/sitemap";

// One zero-based fountains sitemap chunk. The route segment is the full "{n}.xml" filename so
// invalid forms are a 404 instead of a silently empty sitemap.
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
  const offset = chunkNumber * SITEMAP_FOUNTAIN_CAP;
  const { data, status } = await getIndexableFountainsServer(
    crypto.randomUUID(),
    SITEMAP_FOUNTAIN_CAP,
    offset,
  );
  if (!data) {
    log("error", "fountains sitemap chunk: indexable-fountains fetch failed", {
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

  const ids = data.fountain_ids;
  if (ids.length > CHUNK_SOFT_LIMIT) {
    log("warn", "fountains sitemap chunk is approaching the 50k-URL limit", {
      chunk: chunkNumber,
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
