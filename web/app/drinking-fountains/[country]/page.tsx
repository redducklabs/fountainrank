import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { SiteHeader } from "../../../components/SiteHeader";
import {
  cityPath,
  countryPath,
  getCountriesServer,
  getCountryCitiesServer,
  getCountryRegionsServer,
  placeTitle,
  regionPath,
} from "../../../lib/places";
import type { PlaceOut } from "../../../lib/places";
import { log } from "../../../lib/server/log";
import { itemListStructuredData, jsonLdScript } from "../../../lib/seo/jsonld";
import { SITE_URL } from "../../../lib/seo/site";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

// Resolve the canonical country for the URL segment. Only >= K countries are returned by the
// API, so an unknown/below-gate segment resolves to null (the page 404s). cache() dedupes the
// lookup between generateMetadata() and the page render within one request.
const loadCountry = cache(async (segment: string): Promise<PlaceOut | null> => {
  const code = segment.toLowerCase();
  const requestId = crypto.randomUUID();
  const { data } = await getCountriesServer(requestId);
  return data.find((c) => c.country_code === code) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string }>;
}): Promise<Metadata> {
  const { country } = await params;
  const place = await loadCountry(country);
  if (!place) {
    // Unknown / below-gate country: the page 404s, but keep metadata explicitly non-indexable.
    return { robots: { index: false, follow: false } };
  }
  const title = placeTitle(place.name, place.fountain_count);
  const description = `Find public drinking fountains and water bottle refill stations across ${place.name} — ${place.fountain_count.toLocaleString()} mapped on FountainRank.`;
  const canonical = countryPath(place.country_code);
  return {
    title,
    description,
    alternates: { canonical },
    robots: place.indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function CountryPage({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const place = await loadCountry(country);
  if (!place) {
    log("info", "country page not found or below gate", { country: country.toLowerCase() });
    notFound();
  }

  const requestId = crypto.randomUUID();
  const [{ data: regions }, { data: cities }] = await Promise.all([
    getCountryRegionsServer(place.country_code, requestId),
    getCountryCitiesServer(place.country_code, requestId),
  ]);
  const hasRegions = regions.length > 0;
  const structuredJson = jsonLdScript({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "FountainRank", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Drinking fountains",
        item: `${SITE_URL}/drinking-fountains`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `Drinking fountains in ${place.name}`,
        item: `${SITE_URL}${countryPath(place.country_code)}`,
      },
    ],
  });

  // ItemList of the child places this page lists (regions when the country has a region tier, else
  // the top cities), so search engines see the ordered set of crawlable sub-pages. Gated on
  // indexability like the breadcrumb — no structured data for a below-gate page.
  const childUrls = hasRegions
    ? regions.map((region) => `${SITE_URL}${regionPath(place.country_code, region.slug)}`)
    : cities.map((city) => `${SITE_URL}${cityPath(place.country_code, city.slug)}`);
  const itemList = place.indexable ? itemListStructuredData(childUrls) : null;
  const itemListJson = itemList ? jsonLdScript(itemList) : null;

  return (
    <>
      <SiteHeader variant="bar" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredJson }} />
      {itemListJson ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: itemListJson }} />
      ) : null}
      <main className={shell}>
        <Link href="/" className="text-sm text-brand-ink underline">
          ← Back to the map
        </Link>
        <h1 className="mt-6 text-2xl font-black text-brand-ink">
          Drinking fountains in {place.name}
        </h1>
        <p className="mt-2 text-muted">
          {place.fountain_count.toLocaleString()} public drinking fountains and bottle-refill
          stations mapped in {place.name} on FountainRank.
        </p>

        {hasRegions ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-brand-ink">Regions</h2>
            <ul className="mt-3 divide-y divide-border">
              {regions.map((region) => (
                <li key={region.id} className="flex items-center justify-between py-2">
                  <Link
                    href={regionPath(place.country_code, region.slug)}
                    className="text-brand-ink underline"
                  >
                    {region.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {region.fountain_count.toLocaleString()} fountains
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : cities.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-brand-ink">Top cities</h2>
            <ul className="mt-3 divide-y divide-border">
              {cities.map((city) => (
                <li key={city.id} className="flex items-center justify-between py-2">
                  <Link
                    href={cityPath(place.country_code, city.slug)}
                    className="text-brand-ink underline"
                  >
                    {city.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {city.fountain_count.toLocaleString()} fountains
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-8 text-muted">
            Explore the{" "}
            <Link href="/" className="text-brand-ink underline">
              map
            </Link>{" "}
            to find drinking fountains in {place.name}.
          </p>
        )}
      </main>
    </>
  );
}
