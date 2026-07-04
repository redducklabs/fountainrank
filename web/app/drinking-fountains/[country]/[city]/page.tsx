import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { SiteHeader } from "../../../../components/SiteHeader";
import { formatAverage } from "../../../../lib/map/format";
import { cityPath, countryPath, getCityFountainsServer } from "../../../../lib/places";
import type { CityFountainsOut } from "../../../../lib/places";
import { log } from "../../../../lib/server/log";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

// cache() dedupes the fetch between generateMetadata() and the page render within one request.
// Segments are lowercased for the lookup (slugs are stored lowercased); the page 301s any
// non-canonical casing to the canonical URL.
const loadCity = cache(
  (
    country: string,
    city: string,
  ): Promise<{ data: CityFountainsOut | undefined; status: number }> => {
    const requestId = crypto.randomUUID();
    return getCityFountainsServer(country.toLowerCase(), city.toLowerCase(), requestId);
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string; city: string }>;
}): Promise<Metadata> {
  const { country, city } = await params;
  const { data } = await loadCity(country, city);
  if (!data) return { robots: { index: false, follow: false } };
  const { place, indexable } = data;
  const title = `Drinking fountains in ${place.name}`;
  const description = `Find ${place.fountain_count.toLocaleString()} public drinking fountains and water bottle refill stations in ${place.name} — ranked and reviewed on FountainRank.`;
  const canonical = cityPath(place.country_code, place.slug);
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
  params: Promise<{ country: string; city: string }>;
}) {
  const { country, city } = await params;
  const { data, status } = await loadCity(country, city);
  if (status === 404) {
    log("info", "city page not found", {
      country: country.toLowerCase(),
      city: city.toLowerCase(),
    });
    notFound();
  }
  if (!data) {
    log("error", "failed to load city", {
      country: country.toLowerCase(),
      city: city.toLowerCase(),
      status,
    });
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <Link href="/" className="text-sm text-[#0C44A0] underline">
            ← Back to the map
          </Link>
          <h1 className="mt-6 text-lg font-bold text-[#0A357E]">Couldn&rsquo;t load this city</h1>
          <p className="mt-2 text-slate-600">Please try again.</p>
        </main>
      </>
    );
  }

  const { place, fountains } = data;
  // Canonical URL: 301 any non-canonical form (e.g. uppercase segments) to the lowercase country +
  // the sticky canonical slug, so search engines see one URL per city.
  const canonical = cityPath(place.country_code, place.slug);
  if (`/drinking-fountains/${country}/${city}` !== canonical) permanentRedirect(canonical);

  return (
    <>
      <SiteHeader variant="bar" />
      <main className={shell}>
        <Link href={countryPath(place.country_code)} className="text-sm text-[#0C44A0] underline">
          ← All of {place.country_code.toUpperCase()}
        </Link>
        <h1 className="mt-6 text-2xl font-black text-[#0A357E]">
          Drinking fountains in {place.name}
        </h1>
        <p className="mt-2 text-slate-600">
          {place.fountain_count.toLocaleString()} public drinking fountains and bottle-refill
          stations in {place.name}.
          {fountains.length < place.fountain_count ? ` Showing the top ${fountains.length}.` : ""}
        </p>

        {fountains.length > 0 ? (
          <ul className="mt-6 divide-y divide-slate-100">
            {fountains.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/fountains/${f.id}`}
                  className="flex items-center justify-between py-3 hover:bg-slate-50"
                >
                  <span className="text-[#0C44A0] underline">
                    Drinking fountain{f.is_working ? "" : " · Out of order"}
                  </span>
                  <span className="text-sm text-slate-500">
                    {formatAverage(f.average_rating ?? null)}
                    {f.rating_count ? ` · ${f.rating_count} ratings` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-slate-500">No public fountains are mapped here yet.</p>
        )}
      </main>
    </>
  );
}
