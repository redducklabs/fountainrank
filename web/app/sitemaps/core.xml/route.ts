import { SITE_URL } from "../../../lib/seo/site";
import { buildUrlset, sitemapResponse, type SitemapUrl } from "../../../lib/seo/sitemap";

// The "core" chunk: the static, publicly-indexable pages (formerly app/sitemap.ts). lastmod is
// set only for the legal pages, using their real "last updated" dates (keep in sync with the
// dates rendered on those pages). Data-driven pages omit lastmod and rely on changefreq, so we
// never report a misleading "changed today" for content that didn't.
const PRIVACY_UPDATED = "2026-06-30";
const TERMS_UPDATED = "2026-06-19";

export function GET(): Response {
  const urls: SitemapUrl[] = [
    { loc: `${SITE_URL}/`, changefreq: "daily", priority: 1.0 },
    { loc: `${SITE_URL}/leaderboard`, changefreq: "daily", priority: 0.8 },
    { loc: `${SITE_URL}/privacy`, lastmod: PRIVACY_UPDATED, changefreq: "yearly", priority: 0.3 },
    { loc: `${SITE_URL}/terms`, lastmod: TERMS_UPDATED, changefreq: "yearly", priority: 0.3 },
  ];
  return sitemapResponse(buildUrlset(urls));
}
