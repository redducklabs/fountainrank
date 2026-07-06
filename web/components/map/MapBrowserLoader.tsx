"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-map-canvas" aria-hidden />,
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
