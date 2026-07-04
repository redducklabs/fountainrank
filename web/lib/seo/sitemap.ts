// Pure builders for the sitemap index + chunk XML (#127). Next's `generateSitemaps` emits
// /sitemap/[id].xml chunks but does NOT create an index at /sitemap.xml, so we serve the index
// and each chunk from explicit route handlers and build the XML here (unit-testable, no Next
// request needed). robots.ts points crawlers at /sitemap.xml (the index).

export type SitemapUrl = {
  loc: string;
  lastmod?: string; // ISO date (YYYY-MM-DD)
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number; // 0.0–1.0
};

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// A <urlset> (one sitemap chunk).
export function buildUrlset(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const parts = [`<loc>${escapeXml(u.loc)}</loc>`];
      if (u.lastmod) parts.push(`<lastmod>${escapeXml(u.lastmod)}</lastmod>`);
      if (u.changefreq) parts.push(`<changefreq>${u.changefreq}</changefreq>`);
      if (u.priority !== undefined) parts.push(`<priority>${u.priority.toFixed(1)}</priority>`);
      return `  <url>${parts.join("")}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">\n${body}\n</urlset>\n`;
}

// A <sitemapindex> referencing chunk sitemaps by absolute URL.
export function buildSitemapIndex(locs: string[]): string {
  const body = locs.map((loc) => `  <sitemap><loc>${escapeXml(loc)}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${NS}">\n${body}\n</sitemapindex>\n`;
}

// A route-handler Response for sitemap XML: correct content type + a shared cache window
// (sitemaps change slowly; a stale copy at a crawler/CDN is harmless).
export function sitemapResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
