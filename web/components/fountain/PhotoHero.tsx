"use client";
import type { PhotoOut } from "../../lib/fountains";
import { resolveApiBaseUrl } from "../../lib/api";
import { useFountainDetailTabs } from "./FountainDetailTabs";

/** Single newest-photo hero at the top of the Info tab. Clicking it opens the Photos tab
 *  (the full set). Rendered only when at least one photo exists. `PhotoOut.url` is an
 *  API-relative gated path; resolve it against the API origin like `PhotoCarousel` does. */
export function PhotoHero({ photos }: { photos: PhotoOut[] }) {
  const { setActive } = useFountainDetailTabs();
  if (photos.length === 0) return null;
  const newest = photos[0];
  return (
    <button
      type="button"
      aria-label={`See all ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
      onClick={() => setActive("photos")}
      className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <img
        src={`${resolveApiBaseUrl()}${newest.url}`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </button>
  );
}
