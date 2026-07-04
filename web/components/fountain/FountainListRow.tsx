import Link from "next/link";
import type { FountainPin } from "../../lib/fountains";
import { seeOnMapHref } from "../../lib/fountain/see-on-map";
import { Stars } from "./Stars";

export function FountainListRow({ fountain: f }: { fountain: FountainPin }) {
  const href = seeOnMapHref({
    id: String(f.id),
    lng: f.location.longitude,
    lat: f.location.latitude,
  });
  return (
    // Responsive: stack on narrow screens, row on >= sm; min-w-0 lets the label truncate
    // instead of crowding the stars/links. Focus-visible rings keep both links reachable.
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <Link
        href={`/fountains/${f.id}`}
        className="min-w-0 truncate text-[#0C44A0] underline focus-visible:outline-2"
      >
        Drinking fountain{f.is_working ? "" : " · Out of order"}
      </Link>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
        {f.average_rating != null ? (
          <span className="flex items-center gap-1">
            <Stars value={f.average_rating} />
            {f.rating_count ? <span>· {f.rating_count} ratings</span> : null}
          </span>
        ) : (
          <span className="text-slate-400">Not yet rated</span>
        )}
        <Link
          href={href}
          className="whitespace-nowrap text-[#0C44A0] underline focus-visible:outline-2"
        >
          See on Map
        </Link>
      </span>
    </li>
  );
}
