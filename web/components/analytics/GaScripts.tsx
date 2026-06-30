"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

import { isValidGaMeasurementId } from "../../lib/analytics";
import { GaPageView } from "./GaPageView";
import { ensureGaConfigured } from "./gtag";

// Loads GA4. Renders nothing for an invalid Measurement ID. The external gtag.js loader is rendered
// ONLY after ensureGaConfigured() has established window.dataLayer + js + config (gated by `ready`),
// matching Google's "establish the data layer before loading the tag" order. No inline
// dangerouslySetInnerHTML — config is queued from typed JS, and the id only enters the loader URL
// via encodeURIComponent.
export function GaScripts({ gaId }: { gaId: string }) {
  const [ready, setReady] = useState(false);
  const valid = isValidGaMeasurementId(gaId);

  useEffect(() => {
    if (!valid) return;
    ensureGaConfigured(gaId);
    setReady(true);
  }, [gaId, valid]);

  if (!valid) return null;

  return (
    <>
      {ready && (
        <Script
          id="ga-loader"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
        />
      )}
      <GaPageView gaId={gaId} />
    </>
  );
}
