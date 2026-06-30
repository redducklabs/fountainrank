"use client";

import Script from "next/script";
import { useEffect } from "react";

import { isValidGaMeasurementId } from "../../lib/analytics";
import { GaPageView } from "./GaPageView";
import { ensureGaConfigured } from "./gtag";

// Loads GA4. Renders nothing for an invalid Measurement ID. On mount we establish the data layer +
// js + config via ensureGaConfigured (a plain side effect — no React state), so the queue holds
// `js -> config(send_page_view:false)` before the page_view that GaPageView sends. The external
// gtag.js loader carries no hit on its own and drains the data layer in order whenever it executes,
// so command ordering (not script timing) is what matters. The id only enters the loader URL via
// encodeURIComponent — no inline script.
export function GaScripts({ gaId }: { gaId: string }) {
  const valid = isValidGaMeasurementId(gaId);

  useEffect(() => {
    if (valid) ensureGaConfigured(gaId);
  }, [gaId, valid]);

  if (!valid) return null;

  return (
    <>
      <Script
        id="ga-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
      />
      <GaPageView gaId={gaId} />
    </>
  );
}
