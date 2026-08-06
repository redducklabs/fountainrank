// Individual fountain pages are no longer sitemap/index targets. Return Gone for old chunk URLs so
// search engines discard sitemap files learned from an earlier sitemap-index revision.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response("", {
    status: 410,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
  });
}
