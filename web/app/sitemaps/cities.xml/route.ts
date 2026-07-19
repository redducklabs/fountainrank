import { permanentRedirect } from "next/navigation";

// The cities sitemap is now chunked at /sitemaps/cities/{n}.xml (the flat-enumeration backend feed
// scales past the 50k-URL/file limit). Keep this legacy path as a 308 to chunk zero so any external
// reference to /sitemaps/cities.xml still resolves. The sitemap index lists the chunks directly.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  permanentRedirect("/sitemaps/cities/0.xml");
}
