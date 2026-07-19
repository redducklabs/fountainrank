import type { Metadata } from "next";
import Link from "next/link";
import { MobileStoreLinks } from "../components/MobileStoreLinks";
import { SiteHeader } from "../components/SiteHeader";
import MapBrowserLoader from "../components/map/MapBrowserLoader";
import { getSiteStatsServer, roundedCountPlus } from "../lib/places";
import { getViewer } from "../lib/server/viewer";

export const dynamic = "force-dynamic";

// Self-referential canonical (the apex homepage is the one indexed variant, #126) + a positioning
// meta description with LIVE counts (approved copy). force-dynamic already, so the counts stay
// current per request; if the stats fetch fails, fall back to a countless phrasing rather than
// render "undefined".
export async function generateMetadata(): Promise<Metadata> {
  const { data } = await getSiteStatsServer(crypto.randomUUID());
  const description = data
    ? `Browse ${roundedCountPlus(data.total_fountains)} public drinking fountains across ${data.total_countries} countries, rated by the community for working status and quality. Find water near you and refill for free.`
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
