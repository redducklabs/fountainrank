import type { components } from "@fountainrank/api-client";
import Link from "next/link";
import type { FountainPin } from "../../lib/fountains";
import { resolveApiBaseUrl } from "../../lib/api";
import { seeOnMapHref } from "../../lib/fountain/see-on-map";
import { Stars } from "./Stars";
import { PendingLinkLabel } from "../ui/PendingLinkLabel";
import { LoadableImage } from "../ui/LoadableImage";

// The city-list endpoint (`GET /api/v1/places/{country}/{city}/fountains`) returns
// `CityFountainPin`, which adds `photo_count`/`thumbnail_url` on top of the plain
// `FountainPin` shape used elsewhere (e.g. `/api/v1/me/fountains`). This row is shared by
// both callers (`FountainList`), so the photo fields are optional here — present for the
// city list, absent (and treated as "no photo") for the other caller.
type FountainRowPin = FountainPin &
  Pick<Partial<components["schemas"]["CityFountainPin"]>, "photo_count" | "thumbnail_url">;

// `thumbnail_url` is an API-relative gated read path (`/api/v1/photos/{id}/thumb`), not a
// durable object URL — it must be prefixed with the API base to resolve cross-origin in
// prod, the same pattern `PhotoCarousel`/`MapBrowser` use (docs/style-guide.md "List-row
// thumbnail").
function resolveThumbnailUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path}`;
}

export function FountainListRow({ fountain: f }: { fountain: FountainRowPin }) {
  const href = seeOnMapHref({
    id: String(f.id),
    lng: f.location.longitude,
    lat: f.location.latitude,
  });
  return (
    <li className="flex items-center gap-3 py-3">
      {f.thumbnail_url ? (
        // LoadableImage's wrapper is `h-full w-full`, so it must live inside an explicitly SIZED
        // parent (the PhotoHero/PhotoCarousel pattern). Passing `h-12 w-12` via wrapperClassName
        // conflicted with `w-full` and let the thumbnail stretch to the full row width, pushing the
        // row content out of the card (#257 regression). The sizing + shrink-0 belong on this span.
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
          <LoadableImage
            src={resolveThumbnailUrl(f.thumbnail_url)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface text-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
            <path
              d="M4 7h3l2-2h6l2 2h3v12H4V7z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      )}
      <div className="min-w-0 flex-1">
        {/* Responsive: stack on narrow screens, row on >= sm; min-w-0 lets the label truncate
            instead of crowding the stars/links. Focus-visible rings keep both links reachable. */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Link
            href={`/fountains/${f.id}`}
            className="min-w-0 truncate text-brand-ink underline focus-visible:outline-2"
          >
            <PendingLinkLabel pendingLabel="Opening details…">
              Drinking fountain{f.is_working ? "" : " · Out of order"}
            </PendingLinkLabel>
          </Link>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {f.average_rating != null ? (
              <span className="flex items-center gap-1">
                <Stars value={f.average_rating} />
                {f.rating_count ? <span>· {f.rating_count} ratings</span> : null}
              </span>
            ) : (
              <span className="text-muted">Not yet rated</span>
            )}
            <Link
              href={href}
              className="whitespace-nowrap text-brand-ink underline focus-visible:outline-2"
            >
              <PendingLinkLabel pendingLabel="Opening map…">See on Map</PendingLinkLabel>
            </Link>
          </span>
        </div>
        {f.photo_count ? (
          <p className="mt-1 text-xs text-muted">
            {f.photo_count} photo{f.photo_count === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </li>
  );
}
