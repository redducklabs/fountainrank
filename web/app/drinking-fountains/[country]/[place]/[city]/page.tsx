import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { FountainList } from "../../../../../components/fountain/FountainList";
import { RelatedPlaces } from "../../../../../components/place/RelatedPlaces";
import type { RelatedPlace } from "../../../../../components/place/RelatedPlaces";
import { SiteHeader } from "../../../../../components/SiteHeader";
import {
  cityPath,
  countryPath,
  fountainPath,
  getNestedCityFountainsServer,
  getRegionCitiesServer,
  placeTitle,
  RELATED_PLACES_CAP,
  regionPath,
  resolvePlaceServer,
} from "../../../../../lib/places";
import type { CityFountainsOut, PlaceOut } from "../../../../../lib/places";
import { log } from "../../../../../lib/server/log";
import { itemListStructuredData, jsonLdScript } from "../../../../../lib/seo/jsonld";
import { SITE_URL } from "../../../../../lib/seo/site";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

// cache() dedupes the fetch between generateMetadata() and the page render within one request.
// Segments are lowercased for the lookup (slugs are stored lowercased); the page 301s any
// non-canonical casing to the canonical URL.
const loadCity = cache(
  (
    country: string,
    region: string,
    city: string,
  ): Promise<{
    data: CityFountainsOut | undefined;
    region: PlaceOut | undefined;
    status: number;
  }> => {
    const requestId = crypto.randomUUID();
    return Promise.all([
      getNestedCityFountainsServer(
        country.toLowerCase(),
        region.toLowerCase(),
        city.toLowerCase(),
        requestId,
      ),
      resolvePlaceServer(country.toLowerCase(), region.toLowerCase(), requestId),
    ]).then(([cityRes, regionRes]) => ({
      data: cityRes.data,
      region: regionRes.data?.kind === "region" ? regionRes.data.place : undefined,
      status: cityRes.status,
    }));
  },
);

function cityDescription(place: CityFountainsOut["place"]): string {
  return `Find ${place.fountain_count.toLocaleString()} public drinking fountains and water bottle refill stations in ${place.name}. Compare community ratings, working status, and locations before opening directions on FountainRank.`;
}

export function buildCityBreadcrumbStructuredData(
  place: CityFountainsOut["place"],
  region: PlaceOut,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "FountainRank",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `Drinking fountains in ${place.country_code.toUpperCase()}`,
        item: `${SITE_URL}${countryPath(place.country_code)}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `Drinking fountains in ${region.name}`,
        item: `${SITE_URL}${regionPath(region.country_code, region.slug)}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: `Drinking fountains in ${place.name}`,
        item: `${SITE_URL}${cityPath(place.country_code, place.slug, region.slug)}`,
      },
    ],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string; place: string; city: string }>;
}): Promise<Metadata> {
  const { country, place: region, city } = await params;
  const { data, region: regionPlace } = await loadCity(country, region, city);
  if (!data || !regionPlace) return { robots: { index: false, follow: false } };
  const { place, indexable } = data;
  const title = placeTitle(place.name, place.fountain_count);
  const description = cityDescription(place);
  const canonical = cityPath(place.country_code, place.slug, regionPlace.slug);
  return {
    title,
    description,
    alternates: { canonical },
    // Below the thin-content gate (spec §7): the backend computes `indexable` (the single source of
    // K), the page renders, but we keep it out of the index.
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ country: string; place: string; city: string }>;
}) {
  const { country, place: region, city } = await params;
  const { data, region: regionPlace, status } = await loadCity(country, region, city);
  if (status === 404) {
    log("info", "city page not found", {
      country: country.toLowerCase(),
      region: region.toLowerCase(),
      city: city.toLowerCase(),
    });
    notFound();
  }
  if (!data) {
    log("error", "failed to load city", {
      country: country.toLowerCase(),
      region: region.toLowerCase(),
      city: city.toLowerCase(),
      status,
    });
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <Link href="/" className="text-sm text-brand-ink underline">
            ← Back to the map
          </Link>
          <h1 className="mt-6 text-lg font-bold text-brand-ink">Couldn&rsquo;t load this city</h1>
          <p className="mt-2 text-muted">Please try again.</p>
        </main>
      </>
    );
  }

  const { place, fountains } = data;
  if (!regionPlace) {
    log("error", "nested city missing parent region", {
      country: country.toLowerCase(),
      region: region.toLowerCase(),
      city: city.toLowerCase(),
    });
    notFound();
  }
  // Canonical URL: 301 any non-canonical form (e.g. uppercase segments) to the lowercase country +
  // the sticky canonical slug, so search engines see one URL per city.
  const canonical = cityPath(place.country_code, place.slug, regionPlace.slug);
  if (`/drinking-fountains/${country}/${region}/${city}` !== canonical) {
    permanentRedirect(canonical);
  }
  const structuredJson = data.indexable
    ? jsonLdScript(buildCityBreadcrumbStructuredData(place, regionPlace))
    : null;
  // ItemList of the fountains this page lists, each linking to its detail page. Gated on
  // indexability like the breadcrumb — no structured data for a below-gate page.
  const itemList = data.indexable
    ? itemListStructuredData(fountains.map((f) => `${SITE_URL}${fountainPath(String(f.id))}`))
    : null;
  const itemListJson = itemList ? jsonLdScript(itemList) : null;

  // Sideways internal links to sibling cities in the same region (SEO #53). One cheap extra fetch;
  // the block renders nothing on error/empty. Fetch one over the cap so excluding the current city
  // still leaves a full row of siblings.
  const requestId = crypto.randomUUID();
  const siblingCities = await getRegionCitiesServer(
    place.country_code,
    regionPlace.slug,
    requestId,
    RELATED_PLACES_CAP + 1,
  );
  const relatedPlaces: RelatedPlace[] = siblingCities.data
    .filter((sibling) => sibling.id !== place.id)
    .slice(0, RELATED_PLACES_CAP)
    .map((sibling) => ({
      id: sibling.id,
      name: sibling.name,
      href: cityPath(sibling.country_code, sibling.slug, regionPlace.slug),
      fountainCount: sibling.fountain_count,
    }));

  return (
    <>
      <SiteHeader variant="bar" />
      {structuredJson ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: structuredJson,
          }}
        />
      ) : null}
      {itemListJson ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: itemListJson }} />
      ) : null}
      <main className={shell}>
        <Link
          href={regionPath(regionPlace.country_code, regionPlace.slug)}
          className="text-sm text-brand-ink underline"
        >
          ← All of {regionPlace.name}
        </Link>
        <h1 className="mt-6 text-2xl font-black text-brand-ink">
          Drinking fountains in {place.name}
        </h1>
        <p className="mt-2 text-muted">
          {place.fountain_count.toLocaleString()} public drinking fountains and bottle-refill
          stations in {place.name}.
          {fountains.length < place.fountain_count ? ` Showing the top ${fountains.length}.` : ""}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Use this city guide to compare nearby public water fountains by community rating, working
          status, and location before opening directions.
        </p>

        {fountains.length > 0 ? (
          <FountainList fountains={fountains} />
        ) : (
          <p className="mt-6 text-muted">No public fountains are mapped here yet.</p>
        )}
        <RelatedPlaces heading={`Other cities in ${regionPlace.name}`} places={relatedPlaces} />
      </main>
    </>
  );
}
