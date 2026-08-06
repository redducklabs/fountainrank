import type { FountainPin } from "../../lib/fountains";
import type { RawBounds } from "../../lib/map/bounds";
import MapBrowserLoader from "../map/MapBrowserLoader";
import { SiteHeader } from "../SiteHeader";

export function AreaMapPage({
  bounds,
  fountains,
  isAuthenticated,
  children,
}: {
  bounds: RawBounds;
  fountains: FountainPin[];
  isAuthenticated: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant="hero" />
      <main className="relative flex-1">
        <MapBrowserLoader
          isAuthenticated={isAuthenticated}
          autoEnterAdd={false}
          hadAddParam={false}
          initialBounds={bounds}
          initialPins={fountains}
        />
        <aside
          aria-label="Selected area"
          className="absolute inset-x-3 bottom-3 z-30 max-h-[45%] overflow-y-auto rounded-xl border border-border bg-surface-raised/95 p-5 shadow-xl backdrop-blur md:inset-x-auto md:bottom-auto md:left-4 md:top-4 md:max-h-[calc(100%-2rem)] md:w-[24rem]"
        >
          {children}
        </aside>
      </main>
    </div>
  );
}
