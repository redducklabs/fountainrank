"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#e9efe7]" aria-hidden />,
});
export default function MapBrowserLoader({
  isAuthenticated,
  autoEnterAdd,
  hadAddParam,
  initialTotalPoints,
}: {
  isAuthenticated: boolean;
  autoEnterAdd: boolean;
  hadAddParam: boolean;
  initialTotalPoints: number;
}) {
  return (
    <MapBrowser
      isAuthenticated={isAuthenticated}
      autoEnterAdd={autoEnterAdd}
      hadAddParam={hadAddParam}
      initialTotalPoints={initialTotalPoints}
    />
  );
}
