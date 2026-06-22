import Link from "next/link";

import { SiteHeader } from "../components/SiteHeader";
import MapBrowserLoader from "../components/map/MapBrowserLoader";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant="hero" />

      {/* ── Map region — fills remaining viewport ── */}
      <main className="relative flex-1">
        <MapBrowserLoader />
      </main>

      {/* ── Footer ── */}
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
