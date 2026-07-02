import type { MetadataRoute } from "next";

import { SITE_URL } from "../lib/seo/site";

// Served at /robots.txt (see #125). Allows normal crawling, keeps auth-gated app
// surfaces out of the index, and points crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/admin"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
