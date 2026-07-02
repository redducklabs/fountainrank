import type { MetadataRoute } from "next";

import { SITE_URL } from "../lib/seo/site";

// Served at /sitemap.xml (see #125). Static, publicly-indexable pages only.
//
// Per-fountain detail URLs (/fountains/[id]) are intentionally deferred to #127
// (crawlable public entry points): a large, dynamic set sourced from the API
// needs a paginated sitemap index, which is a separate change.
//
// lastModified is set only for the static legal pages, using their real
// "last updated" dates (keep in sync with the dates rendered on those pages).
// The data-driven pages (/, /leaderboard) omit it and rely on changeFrequency,
// so we never report a misleading "changed today" for content that didn't.
const PRIVACY_UPDATED = new Date("2026-06-30");
const TERMS_UPDATED = new Date("2026-06-19");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: "daily", priority: 0.8 },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: PRIVACY_UPDATED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: TERMS_UPDATED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
