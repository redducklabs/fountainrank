"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#e9efe7]" aria-hidden />,
});
export default function MapBrowserLoader() {
  return <MapBrowser />;
}
