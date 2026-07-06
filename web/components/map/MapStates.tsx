import Link from "next/link";

export function LoadingBar() {
  return (
    <div
      role="status"
      aria-label="Loading fountains"
      className="absolute left-0 right-0 top-0 h-1 animate-pulse bg-brand-mid"
    />
  );
}
export function ZoomInHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rounded-full border border-black/10 bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground shadow">
        🔍 Zoom in to see fountains
      </span>
    </div>
  );
}
export function EmptyHint() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      {/* inline-block keeps the rounded pill a single box (an inline span paints its
          background per line-box, so a wrap on narrow screens splits it — #53). */}
      <span className="inline-block max-w-[90vw] rounded-full border border-black/10 bg-surface-raised px-4 py-2 text-center text-sm text-foreground shadow">
        No fountains mapped here yet.
      </span>
    </div>
  );
}
export function CapHint() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      {/* See EmptyHint (#53): this longer string wraps even sooner. */}
      <span className="inline-block max-w-[90vw] rounded-full border border-black/10 bg-surface-raised px-4 py-2 text-center text-sm text-foreground shadow">
        Lots of fountains here — zoom in to see them all.
      </span>
    </div>
  );
}
export function UnsupportedHint() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-map-canvas p-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-foreground">
          The map couldn&rsquo;t start in this browser.
        </p>
        <p className="mt-1 text-sm text-muted">
          It needs WebGL. Turning on hardware acceleration (or relaxing strict anti-fingerprinting
          for this site) and reloading usually fixes it.
        </p>
        <button
          onClick={() => location.reload()}
          className="mt-3 rounded-full bg-brand-mid px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-royal"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
export function ErrorToast({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-surface-raised px-4 py-2 text-sm shadow"
    >
      <span className="text-foreground">Couldn&apos;t load fountains.</span>
      <button onClick={onRetry} className="font-semibold text-brand-ink underline">
        Retry
      </button>
    </div>
  );
}

export function PointsBadge({
  total,
  href,
  className,
}: {
  total: number;
  href: string;
  className?: string;
}) {
  // A real <Link> (right-clickable / prefetchable) to the leaderboard (#117). `href` is kept
  // current by callers that know the map center; header callers fall back to the global board.
  return (
    <Link
      href={href}
      aria-label={`View leaderboard — ${total} points`}
      className={
        className ??
        "pointer-events-auto block min-w-24 rounded-lg border-2 border-accent-gold bg-brand px-3 py-2 text-center text-white shadow-lg outline-none transition hover:border-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 motion-safe:animate-[points-pop_420ms_ease-out]"
      }
    >
      <div className="text-[11px] font-bold uppercase text-white">Points</div>
      <div className="text-2xl font-black leading-none text-accent-gold tabular-nums">{total}</div>
    </Link>
  );
}

export function WaterCelebration({ triggerKey }: { triggerKey: number }) {
  if (triggerKey === 0) return null;
  return (
    <div
      key={triggerKey}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex justify-center motion-reduce:hidden"
    >
      <span className="water-drop water-drop-1" />
      <span className="water-drop water-drop-2" />
      <span className="water-drop water-drop-3" />
      <span className="water-drop water-drop-4" />
      <span className="water-drop water-drop-5" />
    </div>
  );
}
