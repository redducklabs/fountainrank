import Link from "next/link";

// One sibling link in a RelatedPlaces block.
export type RelatedPlace = { id: string; name: string; href: string; fountainCount: number };

// Sideways internal-link block on place pages (SEO #53): links to sibling places — other cities in
// the same region, or other regions in the same country — so pages link ACROSS the place tree, not
// only up (breadcrumb) and down (fountain list). Improves crawl discovery and spreads link equity
// between peer pages. Renders nothing when there are no siblings. Styling mirrors the country page's
// region/city list. See docs/style-guide.md "Related places (sibling links)".
export function RelatedPlaces({ heading, places }: { heading: string; places: RelatedPlace[] }) {
  if (places.length === 0) return null;
  return (
    <nav className="mt-10" aria-label={heading}>
      <h2 className="text-lg font-bold text-brand-ink">{heading}</h2>
      <ul className="mt-3 divide-y divide-border">
        {places.map((place) => (
          <li key={place.id} className="flex items-center justify-between py-2">
            <Link href={place.href} className="text-brand-ink underline">
              {place.name}
            </Link>
            <span className="text-sm text-muted">
              {place.fountainCount.toLocaleString()} fountains
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
