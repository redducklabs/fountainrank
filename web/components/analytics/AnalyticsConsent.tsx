"use client";

import { useEffect, useState } from "react";

import {
  CONSENT_STORAGE_KEY,
  parseConsent,
  resolveGaMeasurementId,
  shouldLoadGa,
  shouldShowBanner,
  type Consent,
} from "../../lib/analytics";
import { ConsentBanner } from "./ConsentBanner";
import { GaScripts } from "./GaScripts";

// The single source of truth for analytics consent. SSR-safe (renders nothing until mounted), reads/
// writes the choice in localStorage fail-closed, and gates GA + the banner on production + canonical
// host (via the pure helpers). Mounted once from the root layout.
function safeGetConsent(): Consent {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch (err) {
    console.warn("analytics: localStorage unavailable; treating consent as undecided", err);
    return "undecided";
  }
}

export function AnalyticsConsent() {
  const [mounted, setMounted] = useState(false);
  const [consent, setConsent] = useState<Consent>("undecided");
  const [hostname, setHostname] = useState("");

  useEffect(() => {
    setHostname(window.location.hostname);
    setConsent(safeGetConsent());
    setMounted(true);
  }, []);

  function accept() {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    } catch (err) {
      // Fail-closed: if the choice did not persist, do NOT start tracking. The banner stays so the
      // user can try again, and nothing is sent until consent is durably granted.
      console.warn("analytics: could not persist consent; not enabling analytics", err);
      return;
    }
    setConsent("granted");
  }

  function decline() {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
    } catch (err) {
      // Fail-safe toward not-tracking: an unpersisted decline simply re-prompts next visit.
      console.warn("analytics: could not persist decline", err);
    }
    setConsent("denied");
  }

  if (!mounted) return null;

  const nodeEnv = process.env.NODE_ENV;

  return (
    <>
      {shouldLoadGa(consent, nodeEnv, hostname) && <GaScripts gaId={resolveGaMeasurementId()} />}
      {shouldShowBanner(consent, nodeEnv, hostname) && (
        <ConsentBanner onAccept={accept} onDecline={decline} />
      )}
    </>
  );
}
