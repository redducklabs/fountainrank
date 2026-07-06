import type { FountainPin } from "../../lib/fountains";
import { formatAverage } from "../../lib/map/format";
import { basePinIcon } from "../../lib/map/pins";

export function FountainsInViewList({
  pins,
  activeId,
  onOpen,
}: {
  pins: FountainPin[];
  activeId?: string;
  onOpen: (id: string) => void;
}) {
  if (pins.length === 0) return null;
  // On mobile the list floats as an inset card lifted clear of the map's bottom-right
  // attribution control (#74); on md+ it docks to the top-left.
  return (
    <nav
      aria-label="Fountains in view"
      className="absolute bottom-10 left-2 right-2 max-h-40 overflow-auto rounded-lg bg-surface-raised/95 p-2 shadow md:bottom-4 md:left-4 md:right-auto md:w-72"
    >
      <ul className="space-y-1">
        {pins.map((p) => {
          const status = p.is_working ? "Working" : "Out of order";
          return (
            <li key={p.id}>
              <button
                onClick={() => onOpen(String(p.id))}
                aria-current={String(p.id) === activeId ? "true" : undefined}
                className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-mid aria-[current=true]:bg-brand-mid/10"
              >
                <span>
                  {status}
                  {basePinIcon({ ...p, ranking_score: p.ranking_score ?? null }) === "pin-gold"
                    ? " · Top-rated"
                    : ""}
                </span>
                <span className="text-muted">{formatAverage(p.average_rating ?? null)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
