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
} from "../../../lib/places";
import type { PlaceOut } from "../../../lib/places";
import { log } from "../../../lib/server/log";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

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
  const title = `Drinking fountains in ${place.name}`;
  const description = `Find public drinking fountains and water bottle refill stations across ${place.name} — ${place.fountain_count.toLocaleString()} mapped on FountainRank.`;
  const canonical = countryPath(place.country_code);
  return {
    title,
    description,
    alternates: { canonical },
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
  const { data: cities } = await getCountryCitiesServer(place.country_code, requestId);

  return (
    <>
      <SiteHeader variant="bar" />
      <main className={shell}>
        <Link href="/" className="text-sm text-[#0C44A0] underline">
          ← Back to the map
        </Link>
        <h1 className="mt-6 text-2xl font-black text-[#0A357E]">
          Drinking fountains in {place.name}
        </h1>
        <p className="mt-2 text-slate-600">
          {place.fountain_count.toLocaleString()} public drinking fountains and bottle-refill
          stations mapped in {place.name} on FountainRank.
        </p>

        {cities.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-[#0A357E]">Top cities</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {cities.map((city) => (
                <li key={city.id} className="flex items-center justify-between py-2">
                  <Link
                    href={cityPath(place.country_code, city.slug)}
                    className="text-[#0C44A0] underline"
                  >
                    {city.name}
                  </Link>
                  <span className="text-sm text-slate-500">
                    {city.fountain_count.toLocaleString()} fountains
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-8 text-slate-500">
            Explore the{" "}
            <Link href="/" className="text-[#0C44A0] underline">
              map
            </Link>{" "}
            to find drinking fountains in {place.name}.
          </p>
        )}
      </main>
    </>
  );
}
