import Image from "next/image";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4] px-6 py-16 text-white">
      {/* Soft cyan glow behind the hero for depth (purely decorative). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5FC5F0] opacity-15 blur-3xl"
      />

      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <Image
          src="/fountainrank-logo.png"
          alt="FountainRank — a crowned blue map pin with a water-fountain spray, beside the FountainRank wordmark"
          width={480}
          height={205}
          priority
          sizes="(max-width: 640px) 80vw, 480px"
          className="h-auto w-[min(80vw,480px)] drop-shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
        />

        <span className="mt-10 inline-flex items-center gap-2 rounded-full border border-[#F2C200]/70 bg-[#F2C200]/10 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.18em] text-[#F2C200]">
          <span className="h-2 w-2 rounded-full bg-[#F2C200]" aria-hidden="true" />
          Coming soon
        </span>

        <h1 className="mt-8 text-balance text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
          Find, rate, and rank the world&rsquo;s public drinking fountains.
        </h1>

        <p className="mt-5 max-w-xl text-balance text-base leading-relaxed text-white/80 sm:text-lg">
          FountainRank is a community-built map of public drinking fountains&nbsp;&mdash; discover
          one nearby, share the ones you love, and help the best rise to the top.
        </p>
      </div>

      <footer className="absolute bottom-6 text-xs text-white/50">
        &copy; {new Date().getFullYear()} FountainRank
      </footer>
    </main>
  );
}
