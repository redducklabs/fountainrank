import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { MobileStoreLinks } from "../components/MobileStoreLinks";
import { SiteHeader } from "../components/SiteHeader";
import MapBrowserLoader from "../components/map/MapBrowserLoader";
import { getSiteStatsServer, roundedCountPlus, type SiteStatsOut } from "../lib/places";
import { getViewer } from "../lib/server/viewer";

export const dynamic = "force-dynamic";

// The homepage is force-dynamic (viewer + ?add), but the site-wide counts change slowly and must NOT
// run a full fountains count() on every landing-page hit (the most-exposed route). Cache the
// aggregate in Next's data cache for an hour (a static key, independent of any per-request id),
// revalidated in the background. A failed fetch THROWS so the failure is not cached — the next
// request retries and the caller falls back to countless copy.
const getCachedSiteStats = unstable_cache(
  async (): Promise<SiteStatsOut> => {
    const { data } = await getSiteStatsServer();
    if (!data) throw new Error("site stats unavailable");
    return data;
  },
  ["home-site-stats"],
  { revalidate: 3600 },
);

// Self-referential canonical (the apex homepage is the one indexed variant, #126) + a positioning
// meta description with LIVE counts (approved copy). If the stats fetch fails, fall back to a
// countless phrasing rather than render "undefined".
export async function generateMetadata(): Promise<Metadata> {
  let stats: SiteStatsOut | null = null;
  try {
    stats = await getCachedSiteStats();
  } catch {
    stats = null;
  }
  const description = stats
    ? `Browse ${roundedCountPlus(stats.total_fountains)} public drinking fountains across ${stats.total_countries} countries, rated by the community for working status and quality. Find water near you and refill for free.`
    : "Browse public drinking fountains rated by the community for working status and quality. Find water near you and refill for free.";
  return {
    description,
    alternates: { canonical: "/" },
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const [{ add }, viewer] = await Promise.all([searchParams, getViewer(crypto.randomUUID())]);
  const isAuthenticated = viewer.state === "authed";
  const hadAddParam = add === "1";
  const autoEnterAdd = hadAddParam && isAuthenticated;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant="hero" />
      <main className="relative flex-1">
        <MapBrowserLoader
          isAuthenticated={isAuthenticated}
          autoEnterAdd={autoEnterAdd}
          hadAddParam={hadAddParam}
        />
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-gradient-to-b from-brand-royal to-brand px-6 py-3 text-xs text-white/60">
        <span>&copy; {new Date().getFullYear()} FountainRank</span>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/privacy">
          Privacy
        </Link>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/terms">
          Terms
        </Link>
        <MobileStoreLinks />
      </footer>
    </div>
  );
}
