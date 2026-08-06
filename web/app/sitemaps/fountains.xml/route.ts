// Retired legacy sitemap URL. Gone is more explicit than redirecting to a retired chunk.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response("", {
    status: 410,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
  });
}
