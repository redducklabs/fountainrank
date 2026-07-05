import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { formatAverage } from "../lib/map/format";
import { getFountainsByAttributeServer, type SeoAttributeKey } from "../lib/places";
import { log } from "../lib/server/log";
import { SiteHeader } from "./SiteHeader";

// Shared implementation of the global attribute pages (#127 Slice 4, spec §4.5). Both attribute
// pages (bottle fillers, wheelchair-accessible) are structurally identical — a ranked, crawlable
// list of matching fountains — so they share this component + metadata builder and differ only in
// the per-route config below. The two routes stay separate files because their canonical URLs are
// deliberately different shapes for the target search phrases.

export type AttributePageConfig = {
  attribute: SeoAttributeKey;
  // The canonical path for this page (e.g. "/drinking-fountains/bottle-fillers").
  canonical: string;
  // Page <h1> (also the metadata title).
  heading: string;
  // Copy referencing the live matching count; both take the full non-hidden total.
  intro: (count: number) => string;
  metaDescription: (count: number) => string;
};

const shell = "mx-auto min-h-dvh max-w-2xl bg-surface-raised px-6 py-10";

// cache() dedupes the fetch between generateMetadata() and the page render within one request.
const loadAttribute = cache((attribute: SeoAttributeKey) => {
  const requestId = crypto.randomUUID();
  return getFountainsByAttributeServer(attribute, requestId);
});

export async function buildAttributeMetadata(config: AttributePageConfig): Promise<Metadata> {
  const { data } = await loadAttribute(config.attribute);
  const count = data?.total_count ?? 0;
  // Indexable only when the backend says so (>= K_attr). A missing response (backend down) or a
  // below-gate page is kept out of the index but still followable (spec §4.5/§7).
  const indexable = data?.indexable ?? false;
  const description = config.metaDescription(count);
  return {
    title: config.heading,
    description,
    alternates: { canonical: config.canonical },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { title: config.heading, description, url: config.canonical, type: "website" },
  };
}

export async function AttributePage(config: AttributePageConfig) {
  const { data, status } = await loadAttribute(config.attribute);
  if (!data) {
    // status 0 = no HTTP response (backend down). Render an error state, NOT an empty/false page.
    log("error", "failed to load attribute page", { attribute: config.attribute, status });
    return (
      <>
        <SiteHeader variant="bar" />
        <main className={shell}>
          <Link href="/" className="text-sm text-brand-mid underline">
            ← Back to the map
          </Link>
          <h1 className="mt-6 text-lg font-bold text-brand">
            Couldn&rsquo;t load these fountains
          </h1>
          <p className="mt-2 text-muted">Please try again.</p>
        </main>
      </>
    );
  }

  const { fountains, total_count } = data;
  return (
    <>
      <SiteHeader variant="bar" />
      <main className={shell}>
        <Link href="/" className="text-sm text-brand-mid underline">
          ← Back to the map
        </Link>
        <h1 className="mt-6 text-2xl font-black text-brand">{config.heading}</h1>
        <p className="mt-2 text-muted">{config.intro(total_count)}</p>

        {fountains.length > 0 ? (
          <ul className="mt-6 divide-y divide-border">
            {fountains.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/fountains/${f.id}`}
                  className="flex items-center justify-between py-3 hover:bg-surface"
                >
                  <span className="text-brand-mid underline">
                    Drinking fountain{f.is_working ? "" : " · Out of order"}
                  </span>
                  <span className="text-sm text-muted">
                    {formatAverage(f.average_rating ?? null)}
                    {f.rating_count ? ` · ${f.rating_count} ratings` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-muted">No public fountains match this yet — check back soon.</p>
        )}
      </main>
    </>
  );
}
