"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { sanitizePagePath, sanitizeUrl } from "../../lib/analytics";
import { sendPageView } from "./gtag";

// Emits one sanitized, path-only page_view per route change. Uses usePathname() ONLY — never
// useSearchParams() — so query strings (e.g. the leaderboard ?lat/lng approximate location) can never
// reach GA. page_referrer is set explicitly to the previous sanitized location (in-app) or the
// query-stripped external referrer (first hit), so no field carries a query string.
export function GaPageView({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  const previousLocation = useRef<string | null>(null);

  useEffect(() => {
    const path = sanitizePagePath(pathname ?? "/");
    const location = window.location.origin + path;
    const referrer = previousLocation.current ?? sanitizeUrl(document.referrer);
    sendPageView(gaId, {
      page_path: path,
      page_location: location,
      page_referrer: referrer,
      page_title: document.title,
    });
    previousLocation.current = location;
  }, [pathname, gaId]);

  return null;
}
