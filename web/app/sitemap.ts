import type { MetadataRoute } from "next";

import { SITE_URL } from "../lib/seo/site";

// Served at /sitemap.xml (see #125). Static, publicly-indexable pages only.
//
// Per-fountain detail URLs (/fountains/[id]) are intentionally deferred to #127
// (crawlable public entry points): a large, dynamic set sourced from the API
// needs a paginated sitemap index, which is a separate change.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/leaderboard`, lastModified, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
