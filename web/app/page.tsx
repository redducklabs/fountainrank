import Image from "next/image";
import Link from "next/link";

import MapBrowserLoader from "../components/map/MapBrowserLoader";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* ── Hero band — brand-gradient top third ── */}
      <header className="bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4] px-6 py-6 text-white sm:py-8">
        {/* Top row: wordmark (left) + Sign-in (right) */}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Image
            src="/fountainrank-logo.png"
            alt="FountainRank — a crowned blue map pin with a water-fountain spray, beside the FountainRank wordmark"
            width={480}
            height={205}
            priority
            sizes="(max-width: 640px) 48vw, (max-width: 1024px) 240px, 320px"
            className="h-auto w-[min(48vw,320px)] drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)] sm:w-[min(60vw,320px)]"
          />

          {/* Gold primary Sign-in button */}
          <Link
            href="/account"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#F2C200] px-5 py-2 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2C200] sm:px-6 sm:py-2.5"
          >
            Sign in
          </Link>
        </div>

        {/* Hero copy */}
        <div className="mx-auto mt-5 max-w-2xl sm:mt-6">
          <h1 className="text-balance text-2xl font-bold leading-tight sm:text-3xl md:text-4xl">
            Find a drinking fountain near you.
          </h1>
          <p className="mt-3 text-balance text-sm leading-relaxed text-white/80 sm:text-base sm:mt-4">
            A free, community map of public drinking fountains — see what&rsquo;s nearby,
            what&rsquo;s working, and how people rate it.
          </p>
        </div>
      </header>

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
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/account">
          Sign in
        </Link>
      </footer>
    </div>
  );
}
