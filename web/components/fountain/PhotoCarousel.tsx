"use client";
import { useEffect, useState } from "react";
import type { PhotoOut } from "../../lib/fountains";
import { resolveApiBaseUrl } from "../../lib/api";
import { SpinnerButton } from "../ui/SpinnerButton";
import { LoadableImage } from "../ui/LoadableImage";

// `PhotoOut.url`/`thumbnail_url` are API-relative gated read paths (`/api/v1/photos/{id}`,
// `.../thumb`) — never a durable object URL (docs/style-guide.md "Fountain photos (PR 2)").
// The web app and API are served from different origins, so the relative path needs the
// API base prefixed to resolve in the browser, the same way `MapBrowser` resolves it.
function resolvePhotoUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path}`;
}

export function PhotoCarousel({
  photos,
  onDelete,
  onReport,
  deletePending = false,
  deletingPhotoId = null,
}: {
  photos: PhotoOut[];
  onDelete?: (photo: PhotoOut) => void;
  onReport?: (photo: PhotoOut) => void;
  deletePending?: boolean;
  deletingPhotoId?: string | null;
}) {
  const [index, setIndex] = useState(0);

  // If a router.refresh() (e.g. after an owner delete or an admin hide) hands us a
  // shorter `photos` array while `index` still points past the end, reset the state
  // during render (React's documented "adjusting state when props change" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect) so subsequent prev/next
  // navigation stays consistent. This intentionally is NOT a useEffect: calling
  // setState from an effect after commit would flash the stale photo first and trips
  // the react-hooks/set-state-in-effect lint rule; adjusting during render bails out
  // before paint instead.
  const [prevPhotosLength, setPrevPhotosLength] = useState(photos.length);
  if (photos.length !== prevPhotosLength) {
    setPrevPhotosLength(photos.length);
    if (index >= photos.length) {
      setIndex(Math.max(0, photos.length - 1));
    }
  }

  const goPrev = () => setIndex((i) => (i - 1 + photos.length) % photos.length);
  const goNext = () => setIndex((i) => (i + 1) % photos.length);

  useEffect(() => {
    if (photos.length <= 1) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  if (photos.length === 0) return null;

  // Guard against the render that happens *before* the effect above runs:
  // `photos` can shrink (owner delete, admin hide, concurrent update) while
  // `index` still references the old, now out-of-range position.
  const safeIndex = index < photos.length ? index : photos.length - 1;
  const current = photos[safeIndex];

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface">
      <LoadableImage
        src={resolvePhotoUrl(current.url)}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />

      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={goPrev}
            className="absolute inset-y-0 left-0 flex items-center px-2 text-white outline-none"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-lg hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
            >
              &#8249;
            </span>
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={goNext}
            className="absolute inset-y-0 right-0 flex items-center px-2 text-white outline-none"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-lg hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
            >
              &#8250;
            </span>
          </button>

          <div
            className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5"
            aria-hidden="true"
          >
            {photos.map((p, i) => (
              <span
                key={p.id}
                data-dot
                className={`h-1.5 w-1.5 rounded-full ${i === safeIndex ? "bg-white/100" : "bg-white/40"}`}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Photo {safeIndex + 1} of {photos.length}
          </p>
        </>
      )}

      {onReport && (
        <button
          type="button"
          aria-label="Report this photo"
          onClick={() => onReport(current)}
          className="absolute bottom-2 right-2 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white"
        >
          Report
        </button>
      )}

      {current.is_own && onDelete && (
        <SpinnerButton
          pending={deletePending && current.id === deletingPhotoId}
          aria-label="Delete this photo"
          onClick={() => onDelete(current)}
          spinnerClassName="h-3 w-3"
          className={`absolute bottom-2 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white ${
            onReport ? "right-20" : "right-2"
          }`}
        >
          Delete
        </SpinnerButton>
      )}
    </div>
  );
}
