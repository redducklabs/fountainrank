export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// A schema.org ItemList in Google's "summary page" format: an ordered list of ListItems that carry
// only a position + the item's own URL (SEO #53). Place pages emit one to declare, in order, the
// fountains (or child places) they list, each linking to its own detail/place page. We use the
// URL-only form deliberately: individual drinking fountains have no public name, so a per-item
// name/entity would be fabricated — the visible list already carries the human-facing labels. `urls`
// MUST be absolute (prefixed with SITE_URL). Returns null when empty so the caller emits no script.
export function itemListStructuredData(urls: string[]): Record<string, unknown> | null {
  if (urls.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: urls.map((url, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url,
    })),
  };
}
