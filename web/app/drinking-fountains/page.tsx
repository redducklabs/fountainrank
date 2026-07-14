import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "../../components/SiteHeader";
import { countryPath, getCountriesServer } from "../../lib/places";
import { jsonLdScript } from "../../lib/seo/jsonld";
import { SITE_URL } from "../../lib/seo/site";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

const TITLE = "Drinking fountains";
const DESCRIPTION =
  "Browse public drinking fountains and water bottle refill stations by country on FountainRank.";

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/drinking-fountains" },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: "/drinking-fountains",
      type: "website",
    },
  };
}

export default async function DrinkingFountainsHubPage() {
  const { data: countries } = await getCountriesServer(crypto.randomUUID(), 1000);
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
    ],
  });
  return (
    <>
      <SiteHeader variant="bar" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredJson }} />
      <main className={shell}>
        <Link href="/" className="text-sm text-brand-ink underline">
          ← Back to the map
        </Link>
        <h1 className="mt-6 text-2xl font-black text-brand-ink">Drinking fountains</h1>
        <p className="mt-2 text-muted">
          Browse public drinking fountains and bottle-refill stations by country.
        </p>
        {countries.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-brand-ink">Countries</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {countries.map((country) => (
                <li key={country.id} className="rounded-lg border border-border p-3">
                  <Link
                    href={countryPath(country.country_code)}
                    className="font-bold text-brand-ink underline"
                  >
                    {country.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted">
                    {country.fountain_count.toLocaleString()} fountains
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-8 text-muted">No country pages are ready yet.</p>
        )}
      </main>
    </>
  );
}
