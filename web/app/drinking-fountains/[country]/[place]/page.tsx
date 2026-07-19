import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { FountainList } from "../../../../components/fountain/FountainList";
import { SiteHeader } from "../../../../components/SiteHeader";
import {
  cityPath,
  countryPath,
  getCityFountainsServer,
  getRegionFountainsServer,
  placeTitle,
  regionPath,
  resolvePlaceServer,
} from "../../../../lib/places";
import type { CityFountainsOut, PlaceOut, PlaceResolveOut } from "../../../../lib/places";
import { log } from "../../../../lib/server/log";
import { jsonLdScript } from "../../../../lib/seo/jsonld";
import { SITE_URL } from "../../../../lib/seo/site";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

type ResolvedPage =
  | { kind: "region"; resolved: PlaceResolveOut; fountains?: CityFountainsOut }
  | { kind: "city"; resolved: PlaceResolveOut; fountains?: CityFountainsOut };

const loadResolved = cache(
  async (
    country: string,
    place: string,
  ): Promise<{ data: ResolvedPage | undefined; status: number }> => {
    const requestId = crypto.randomUUID();
    const resolved = await resolvePlaceServer(
      country.toLowerCase(),
      place.toLowerCase(),
      requestId,
    );
    if (!resolved.data) return { data: undefined, status: resolved.status };
    if (resolved.data.canonical_path !== `/drinking-fountains/${country}/${place}`) {
      return { data: { kind: "city", resolved: resolved.data }, status: resolved.status };
    }
    const fountains =
      resolved.data.kind === "region"
        ? await getRegionFountainsServer(country.toLowerCase(), place.toLowerCase(), requestId)
        : await getCityFountainsServer(country.toLowerCase(), place.toLowerCase(), requestId);
    return {
      data: { kind: resolved.data.kind, resolved: resolved.data, fountains: fountains.data },
      status: fountains.status,
    };
  },
);

function description(place: PlaceOut): string {
  return `Find ${place.fountain_count.toLocaleString()} public drinking fountains and water bottle refill stations in ${place.name}. Compare community ratings, working status, and locations before opening directions on FountainRank.`;
}

function breadcrumb(place: PlaceOut, canonical: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "FountainRank", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: `Drinking fountains in ${place.country_code.toUpperCase()}`,
        item: `${SITE_URL}${countryPath(place.country_code)}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `Drinking fountains in ${place.name}`,
        item: `${SITE_URL}${canonical}`,
      },
    ],
  };
}

function disambiguationForRegion(place: PlaceOut): { label: string; href: string } | null {
  if (place.country_code !== "us") return null;
  if (place.slug === "washington") {
    return {
      label: "Looking for Washington, District of Columbia?",
      href: cityPath("us", "washington", "district-of-columbia"),
    };
  }
  if (place.slug === "delaware") {
    return { label: "Looking for Delaware, Ohio?", href: cityPath("us", "delaware", "ohio") };
  }
  if (place.slug === "wyoming") {
    return { label: "Looking for Wyoming, Michigan?", href: cityPath("us", "wyoming", "michigan") };
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string; place: string }>;
}): Promise<Metadata> {
  const { country, place } = await params;
  const { data } = await loadResolved(country, place);
  if (!data?.fountains) return { robots: { index: false, follow: false } };
  const resolvedPlace = data.resolved.place;
  const canonical = data.resolved.canonical_path;
  const title = placeTitle(resolvedPlace.name, resolvedPlace.fountain_count);
  const desc = description(resolvedPlace);
  return {
    title,
    description: desc,
    alternates: { canonical },
    robots: data.fountains.indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description: desc, url: canonical, type: "website" },
  };
}

export default async function PlaceResolverPage({
  params,
}: {
  params: Promise<{ country: string; place: string }>;
}) {
  const { country, place } = await params;
  const { data, status } = await loadResolved(country, place);
  if (status === 404) {
    log("info", "place resolver not found", { country: country.toLowerCase(), place });
    notFound();
  }
  if (
    data?.resolved.canonical_path &&
    data.resolved.canonical_path !== `/drinking-fountains/${country}/${place}`
  ) {
    permanentRedirect(data.resolved.canonical_path);
  }
  if (!data?.fountains) {
    log("error", "failed to load resolved place", {
      country: country.toLowerCase(),
      place,
      status,
    });
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <Link href="/" className="text-sm text-brand-ink underline">
            ← Back to the map
          </Link>
          <h1 className="mt-6 text-lg font-bold text-brand-ink">Couldn&rsquo;t load this place</h1>
          <p className="mt-2 text-muted">Please try again.</p>
        </main>
      </>
    );
  }

  const { resolved, fountains } = data;
  const placeData = resolved.place;
  const canonical =
    resolved.kind === "region"
      ? regionPath(placeData.country_code, placeData.slug)
      : cityPath(placeData.country_code, placeData.slug);
  if (`/drinking-fountains/${country}/${place}` !== canonical) permanentRedirect(canonical);
  const structuredJson = fountains.indexable
    ? jsonLdScript(breadcrumb(placeData, canonical))
    : null;
  const disambiguation = resolved.kind === "region" ? disambiguationForRegion(placeData) : null;

  return (
    <>
      <SiteHeader variant="bar" />
      {structuredJson ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredJson }} />
      ) : null}
      <main className={shell}>
        <Link
          href={countryPath(placeData.country_code)}
          className="text-sm text-brand-ink underline"
        >
          ← All of {placeData.country_code.toUpperCase()}
        </Link>
        <h1 className="mt-6 text-2xl font-black text-brand-ink">
          Drinking fountains in {placeData.name}
        </h1>
        <p className="mt-2 text-muted">
          {placeData.fountain_count.toLocaleString()} public drinking fountains and bottle-refill
          stations in {placeData.name}.
          {fountains.fountains.length < placeData.fountain_count
            ? ` Showing the top ${fountains.fountains.length}.`
            : ""}
        </p>
        {disambiguation ? (
          <p className="mt-4 text-sm text-muted">
            <Link href={disambiguation.href} className="text-brand-ink underline">
              {disambiguation.label}
            </Link>
          </p>
        ) : null}
        {fountains.fountains.length > 0 ? (
          <FountainList fountains={fountains.fountains} />
        ) : (
          <p className="mt-6 text-muted">No public fountains are mapped here yet.</p>
        )}
      </main>
    </>
  );
}
