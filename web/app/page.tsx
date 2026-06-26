import Link from "next/link";
import { SiteHeader } from "../components/SiteHeader";
import MapBrowserLoader from "../components/map/MapBrowserLoader";
import { getViewer, getViewerTotalPoints } from "../lib/server/viewer";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const [{ add }, viewer] = await Promise.all([searchParams, getViewer(crypto.randomUUID())]);
  const isAuthenticated = viewer.state === "authed";
  const initialTotalPoints = isAuthenticated ? await getViewerTotalPoints(crypto.randomUUID()) : 0;
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
          initialTotalPoints={initialTotalPoints}
        />
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-gradient-to-b from-[#0E4DA4] to-[#0A357E] px-6 py-3 text-xs text-white/60">
        <span>&copy; {new Date().getFullYear()} FountainRank</span>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/privacy">
          Privacy
        </Link>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/terms">
          Terms
        </Link>
      </footer>
    </div>
  );
}
