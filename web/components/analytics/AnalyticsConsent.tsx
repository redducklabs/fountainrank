"use client";

import { useCallback, useSyncExternalStore } from "react";

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

// The single source of truth for analytics consent. The persisted choice and the hostname are read
// via useSyncExternalStore so they are SSR-safe (server snapshot = "undecided"/"" → renders nothing
// on the server and the first client paint, no hydration mismatch, and — per the project's
// react-hooks rules — no setState inside an effect). GA + the banner are gated on production +
// canonical host via the pure helpers. Mounted once from the root layout.

const CONSENT_CHANGE_EVENT = "fr-analytics-consent-change";

function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getConsentSnapshot(): Consent {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch (err) {
    console.warn("analytics: localStorage unavailable; treating consent as undecided", err);
    return "undecided";
  }
}

function getServerConsent(): Consent {
  return "undecided";
}

function noopSubscribe(): () => void {
  return () => {};
}

function getHostnameSnapshot(): string {
  return window.location.hostname;
}

function getServerHostname(): string {
  return "";
}

export function AnalyticsConsent() {
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsent);
  const hostname = useSyncExternalStore(noopSubscribe, getHostnameSnapshot, getServerHostname);
  const nodeEnv = process.env.NODE_ENV;

  const persist = useCallback((value: Exclude<Consent, "undecided">): boolean => {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
    } catch {
      return false;
    }
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    return true;
  }, []);

  const accept = useCallback(() => {
    // Fail-closed: if the choice did not persist, do NOT start tracking. localStorage stays
    // unchanged → the snapshot is still "undecided" → the banner remains and GA never loads.
    if (!persist("granted")) {
      console.warn("analytics: could not persist consent; not enabling analytics");
    }
  }, [persist]);

  const decline = useCallback(() => {
    if (!persist("denied")) {
      console.warn("analytics: could not persist decline");
    }
  }, [persist]);

  return (
    <>
      {shouldLoadGa(consent, nodeEnv, hostname) && <GaScripts gaId={resolveGaMeasurementId()} />}
      {shouldShowBanner(consent, nodeEnv, hostname) && (
        <ConsentBanner onAccept={accept} onDecline={decline} />
      )}
    </>
  );
}
