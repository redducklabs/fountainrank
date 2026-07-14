import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  getFountainDetailServer,
  getFountainNotesServer,
  getFountainPhotosServer,
} from "../../../lib/fountains";
import { cityPath, fountainPath, getFountainPlaceServer } from "../../../lib/places";
import { getAdminFountainDetailServer } from "../../../lib/server/admin";
import { getViewerAccessToken } from "../../../lib/server/api";
import { log } from "../../../lib/server/log";
import { getViewer } from "../../../lib/server/viewer";
import { FountainAdminControls } from "../../../components/admin/FountainAdminControls";
import { ContributionStatusOverlay } from "../../../components/contributions/ContributionStatusOverlay";
import { FountainDetail } from "../../../components/fountain/FountainDetail";
import { SiteHeader } from "../../../components/SiteHeader";
import {
  attributeDisplay,
  formatAverage,
  formatVotes,
  statusDisplay,
} from "../../../lib/map/format";
import { jsonLdScript } from "../../../lib/seo/jsonld";
import { SITE_URL } from "../../../lib/seo/site";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

// cache() dedupes the PUBLIC place fetch between generateMetadata() and the page render within one
// request. It drives BOTH the indexing verdict (spec §7) and the city h1 label from public,
// non-hidden data only — never the viewer/admin detail path, so auth/admin state can't affect SEO.
const loadFountainPlace = cache((id: string) => getFountainPlaceServer(id, crypto.randomUUID()));
const loadPublicFountainDetail = cache((id: string) =>
  getFountainDetailServer(id, crypto.randomUUID(), null),
);

// The public city label for the h1, e.g. "Public drinking fountain in Manhattan". Undefined when no
// city resolves (or the backend is down), so the component falls back to the generic label.
function cityLabel(name: string | undefined): string | undefined {
  return name ? `Public drinking fountain in ${name}` : undefined;
}

type PublicFountainDetail = NonNullable<
  Awaited<ReturnType<typeof getFountainDetailServer>>["data"]
>;
type PublicFountainPlace = NonNullable<Awaited<ReturnType<typeof getFountainPlaceServer>>["data"]>;

function ratingTitlePrefix(detail: PublicFountainDetail | undefined): string | null {
  if (detail?.average_rating == null || detail.rating_count < 1) return null;
  return `${formatAverage(detail.average_rating)}-rated`;
}

function positiveAttributeLabels(detail: PublicFountainDetail | undefined): string[] {
  return (
    detail?.attributes
      .filter((attribute) => attribute.consensus_value === "yes" && attribute.confidence !== "low")
      .map((attribute) => attribute.name.toLowerCase())
      .slice(0, 2) ?? []
  );
}

function metadataTitle(
  place: PublicFountainPlace,
  detail: PublicFountainDetail | undefined,
): string {
  const cityName = place?.city?.name;
  const prefix = ratingTitlePrefix(detail);
  if (cityName) {
    return prefix
      ? `${prefix} drinking fountain in ${cityName}`
      : `Public drinking fountain in ${cityName}`;
  }
  return prefix ? `${prefix} public drinking fountain` : "Public drinking fountain";
}

function metadataDescription(
  place: PublicFountainPlace,
  detail: PublicFountainDetail | undefined,
): string {
  const cityName = place?.city?.name;
  const location = cityName ? `in ${cityName}` : "nearby";
  const parts = [`Find a public drinking fountain ${location} on FountainRank.`];
  if (detail) {
    const status = statusDisplay(detail.current_status, detail.is_working).chipLabel;
    parts.push(status.endsWith(".") ? status : `${status}.`);
    if (detail.average_rating != null && detail.rating_count > 0) {
      parts.push(
        `Rated ${formatAverage(detail.average_rating)} from ${formatVotes(detail.rating_count)}.`,
      );
    }
    const attributes = positiveAttributeLabels(detail);
    if (attributes.length > 0) {
      parts.push(`Reported features include ${attributes.join(" and ")}.`);
    }
  }
  parts.push("Get directions and community details.");
  return parts.join(" ");
}

export function buildFountainStructuredData({
  id,
  place,
  detail,
}: {
  id: string;
  place: PublicFountainPlace;
  detail: PublicFountainDetail;
}) {
  const canonical = `${SITE_URL}${fountainPath(id)}`;
  const cityName = place?.city?.name;
  const status = statusDisplay(detail.current_status, detail.is_working).chipLabel;
  const additionalProperty = [
    {
      "@type": "PropertyValue",
      name: "Working status",
      value: status,
    },
    ...detail.attributes
      .map((attribute) => {
        const display = attributeDisplay(attribute);
        if (display.text === "Unknown") return null;
        return {
          "@type": "PropertyValue",
          name: attribute.name,
          value: display.text,
        };
      })
      .filter(Boolean),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "Place",
    "@id": canonical,
    name: cityName ? `Public drinking fountain in ${cityName}` : "Public drinking fountain",
    url: canonical,
    geo: {
      "@type": "GeoCoordinates",
      latitude: detail.location.latitude,
      longitude: detail.location.longitude,
    },
    ...(detail.average_rating != null && detail.rating_count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(detail.average_rating.toFixed(1)),
            ratingCount: detail.rating_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    additionalProperty,
  };
}

export function buildFountainBreadcrumbStructuredData({
  id,
  place,
}: {
  id: string;
  place: PublicFountainPlace;
}) {
  const city = place.city;
  const region = place.region;
  const itemListElement = [
    {
      "@type": "ListItem",
      position: 1,
      name: "FountainRank",
      item: SITE_URL,
    },
  ];
  if (city) {
    itemListElement.push({
      "@type": "ListItem",
      position: 2,
      name: `Drinking fountains in ${city.name}`,
      item: `${SITE_URL}${cityPath(city.country_code, city.slug, region?.slug)}`,
    });
  }
  itemListElement.push({
    "@type": "ListItem",
    position: itemListElement.length + 1,
    name: city ? `Public drinking fountain in ${city.name}` : "Public drinking fountain",
    item: `${SITE_URL}${fountainPath(id)}`,
  });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data } = await loadFountainPlace(id);
  // Hidden / unknown (404) or backend-down (status 0): keep out of the index. `follow: false`
  // mirrors the city page's missing-data behavior.
  if (!data) return { robots: { index: false, follow: false } };
  const { data: detail } = await loadPublicFountainDetail(id);
  const title = metadataTitle(data, detail);
  const description = metadataDescription(data, detail);
  const canonical = fountainPath(id);
  return {
    title,
    description,
    alternates: { canonical },
    // Below the §7 predicate (thin / broken-and-unrated / no city): render, but keep out of the
    // index — still followable so crawlers reach the linked map + place pages.
    robots: data.indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function FountainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const viewer = await getViewer(requestId);
  const isAuthenticated = viewer.state === "authed";
  const isAdmin = viewer.state === "authed" && viewer.isAdmin;
  const adminRes = isAdmin ? await getAdminFountainDetailServer(id, requestId) : null;
  // Authenticate the public detail + photos fetches when signed in so `your_rating` (#65 web
  // parity, #114) and each photo's `is_own` (per-photo Delete gating) come back correctly.
  // Admins use the admin detail endpoint instead so hidden notes and hidden fountains are
  // reachable, but still authenticate the photos fetch so an admin's own photos show `is_own`.
  const [{ data, status }, notesRes, photosRes] = adminRes
    ? [
        { data: adminRes.data, status: adminRes.status },
        { data: adminRes.data?.notes, status: adminRes.status },
        await getViewerAccessToken().then((token) => getFountainPhotosServer(id, requestId, token)),
      ]
    : await Promise.all([
        getViewerAccessToken().then((token) => getFountainDetailServer(id, requestId, token)),
        getFountainNotesServer(id, requestId),
        getViewerAccessToken().then((token) => getFountainPhotosServer(id, requestId, token)),
      ]);

  if (status === 404) {
    log("info", "fountain not found", { requestId, id, status });
    notFound();
  }
  if (!data) {
    log("error", "failed to load fountain", { requestId, id, status });
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <Link href="/" className="text-sm text-brand-ink underline">
            ← Back to the map
          </Link>
          <h1 className="mt-6 text-lg font-bold text-brand-ink">
            Couldn&rsquo;t load this fountain
          </h1>
          <p className="mt-2 text-muted">Please try again.</p>
        </main>
      </>
    );
  }
  const notesOk = notesRes.status >= 200 && notesRes.status < 300;
  if (!notesOk) {
    log("warn", "failed to load fountain notes", { requestId, id, status: notesRes.status });
  }
  const notes = notesOk && notesRes.data ? notesRes.data : [];
  const photosOk = photosRes.status >= 200 && photosRes.status < 300;
  if (!photosOk) {
    log("warn", "failed to load fountain photos", { requestId, id, status: photosRes.status });
  }
  const photos = photosOk && photosRes.data ? photosRes.data : [];
  // The PUBLIC city label for the h1 (spec §7): cached, so this reuses generateMetadata's fetch.
  const { data: placeData } = await loadFountainPlace(id);
  const locationLabel = cityLabel(placeData?.city?.name);
  const cityHref = placeData?.city
    ? cityPath(placeData.city.country_code, placeData.city.slug, placeData.region?.slug)
    : undefined;
  const structuredJson =
    placeData?.indexable && !adminRes
      ? jsonLdScript([
          buildFountainStructuredData({ id, place: placeData, detail: data }),
          buildFountainBreadcrumbStructuredData({ id, place: placeData }),
        ])
      : null;
  return (
    <>
      <SiteHeader variant="bar" />
      {isAuthenticated ? <ContributionStatusOverlay /> : null}
      {structuredJson ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: structuredJson,
          }}
        />
      ) : null}
      <main className={shell}>
        <Link href="/" className="text-sm text-brand-ink underline">
          ← Back to the map
        </Link>
        {cityHref && placeData?.city ? (
          <p className="mt-3 text-sm text-muted">
            Browse more{" "}
            <Link href={cityHref} className="text-brand-ink underline">
              drinking fountains in {placeData.city.name}
            </Link>
            .
          </p>
        ) : null}
        <div className="mt-6">
          <FountainDetail
            detail={data}
            notes={notes}
            photos={photos}
            isAuthenticated={isAuthenticated}
            adminControls={adminRes?.data ? <FountainAdminControls detail={adminRes.data} /> : null}
            locationLabel={locationLabel}
          />
        </div>
      </main>
    </>
  );
}
