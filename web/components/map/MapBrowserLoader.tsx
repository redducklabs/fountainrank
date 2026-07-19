"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => (
    <div
      className="absolute inset-0 flex items-center justify-center bg-map-canvas"
      role="status"
      aria-busy="true"
    >
      <span className="rounded-full bg-surface-raised px-4 py-2 text-sm text-foreground shadow">
        Loading map…
      </span>
    </div>
  ),
});
export default function MapBrowserLoader({
  isAuthenticated,
  autoEnterAdd,
  hadAddParam,
}: {
  isAuthenticated: boolean;
  autoEnterAdd: boolean;
  hadAddParam: boolean;
}) {
  return (
    <MapBrowser
      isAuthenticated={isAuthenticated}
      autoEnterAdd={autoEnterAdd}
      hadAddParam={hadAddParam}
    />
  );
}
