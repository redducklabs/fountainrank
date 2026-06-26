export function LoadingBar() {
  return (
    <div
      role="status"
      aria-label="Loading fountains"
      className="absolute left-0 right-0 top-0 h-1 animate-pulse bg-[#0C44A0]"
    />
  );
}
export function ZoomInHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow">
        🔍 Zoom in to see fountains
      </span>
    </div>
  );
}
export function EmptyHint() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-slate-700 shadow">
        No fountains mapped here yet.
      </span>
    </div>
  );
}
export function CapHint() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-slate-700 shadow">
        Lots of fountains here — zoom in to see them all.
      </span>
    </div>
  );
}
export function UnsupportedHint() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#e9efe7] p-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-slate-800">
          The map couldn&rsquo;t start in this browser.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          It needs WebGL. Turning on hardware acceleration (or relaxing strict anti-fingerprinting
          for this site) and reloading usually fixes it.
        </p>
        <button
          onClick={() => location.reload()}
          className="mt-3 rounded-full bg-[#0C44A0] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0E4DA4]"
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
      className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-white px-4 py-2 text-sm shadow"
    >
      <span className="text-slate-700">Couldn&apos;t load fountains.</span>
      <button onClick={onRetry} className="font-semibold text-[#0C44A0] underline">
        Retry
      </button>
    </div>
  );
}

export function PointsBadge({ total }: { total: number }) {
  return (
    <div
      aria-label={`${total} points`}
      className="absolute right-3 top-3 z-30 min-w-24 rounded-lg border-2 border-[#F2C200] bg-[#0A357E] px-3 py-2 text-center text-white shadow-lg motion-safe:animate-[points-pop_420ms_ease-out]"
    >
      <div className="text-[11px] font-bold uppercase text-white">Points</div>
      <div className="text-2xl font-black leading-none text-[#F2C200] tabular-nums">{total}</div>
    </div>
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
