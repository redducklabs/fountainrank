import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "../../components/SiteHeader";
import {
  cityPath,
  countryPath,
  getCountriesServer,
  getCountryCitiesServer,
  NEAR_ME_PATH,
} from "../../lib/places";

// A static hub page (spec §4.5): it explains "near me", deep-links into the map (which geolocates
// the visitor), and links out to the busiest country + its top cities for crawlable internal links.
// Always indexable — it has no per-place thin-content risk. force-dynamic so the place links reflect
// live membership and `next build` never fetches the API.
export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

const TITLE = "Drinking fountains near me";
const DESCRIPTION =
  "Find public drinking fountains and water bottle refill stations near you. Open the map to see fountains around your location, or browse by city on FountainRank.";

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: NEAR_ME_PATH },
    openGraph: { title: TITLE, description: DESCRIPTION, url: NEAR_ME_PATH, type: "website" },
  };
}

export default async function NearMePage() {
  const { data: countries } = await getCountriesServer(crypto.randomUUID());
  const topCountry = countries[0];
  const { data: cities } = topCountry
    ? await getCountryCitiesServer(topCountry.country_code, crypto.randomUUID())
    : { data: [] };

  return (
    <>
      <SiteHeader variant="bar" />
      <main className={shell}>
        <h1 className="mt-2 text-2xl font-black text-[#0A357E]">{TITLE}</h1>
        <p className="mt-2 text-slate-600">
          Looking for a drinking fountain or water bottle refill station nearby? Open the map to see
          public fountains around your current location, ranked and reviewed by the community.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-[#0C44A0] px-4 py-2 font-bold text-white"
        >
          Open the map near you
        </Link>

        {cities.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-[#0A357E]">Popular cities</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {cities.map((city) => (
                <li key={city.id} className="flex items-center justify-between py-2">
                  <Link
                    href={cityPath(city.country_code, city.slug)}
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
        )}

        {countries.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-[#0A357E]">Browse by country</h2>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {countries.map((country) => (
                <li key={country.id}>
                  <Link
                    href={countryPath(country.country_code)}
                    className="text-[#0C44A0] underline"
                  >
                    {country.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
