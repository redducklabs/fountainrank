// The single canonical origin for SEO. We serve one indexable host so search
// engines don't split ranking signals across www/non-www (see #126).
//
// This is deliberately distinct from analytics' CANONICAL_HOSTS (lib/analytics.ts),
// which enumerates every production host GA is allowed to load on (both www and
// non-www). Here there is exactly one canonical host.
export const SITE_HOST = "fountainrank.com";
export const SITE_URL = `https://${SITE_HOST}`;
