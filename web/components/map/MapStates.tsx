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
