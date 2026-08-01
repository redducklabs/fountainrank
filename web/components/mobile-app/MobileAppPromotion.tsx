"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import {
  detectMobilePlatform,
  isStandaloneDisplayMode,
  MOBILE_APP_BANNER_DISMISSED_KEY,
  resolveMobileStoreLinks,
  selectMobileStoreLink,
  type MobilePlatform,
} from "../../lib/mobile-store-links";
import { MobileAppBanner } from "./MobileAppBanner";

type BannerSnapshot = MobilePlatform | "hidden";

const standaloneQuery = "(display-mode: standalone)";

function getBannerSnapshot(): BannerSnapshot {
  try {
    if (window.localStorage.getItem(MOBILE_APP_BANNER_DISMISSED_KEY) === "true") {
      return "hidden";
    }
  } catch (err) {
    console.warn("mobile-app-banner: localStorage unavailable; dismissal will be temporary", err);
  }

  const displayModeStandalone = window.matchMedia?.(standaloneQuery).matches ?? false;
  const navigatorStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isStandaloneDisplayMode({ displayModeStandalone, navigatorStandalone })) return "hidden";

  return (
    detectMobilePlatform({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }) ?? "hidden"
  );
}

function getServerSnapshot(): BannerSnapshot {
  return "hidden";
}

function subscribe(onChange: () => void): () => void {
  const displayMode = window.matchMedia?.(standaloneQuery);
  window.addEventListener("storage", onChange);
  displayMode?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    displayMode?.removeEventListener("change", onChange);
  };
}

export function MobileAppPromotion() {
  const platform = useSyncExternalStore(subscribe, getBannerSnapshot, getServerSnapshot);
  const [dismissedForPage, setDismissedForPage] = useState(false);
  const link = selectMobileStoreLink(
    resolveMobileStoreLinks(),
    platform === "hidden" ? null : platform,
  );

  const dismiss = useCallback(() => {
    setDismissedForPage(true);
    try {
      window.localStorage.setItem(MOBILE_APP_BANNER_DISMISSED_KEY, "true");
    } catch (err) {
      console.warn("mobile-app-banner: could not persist dismissal", err);
    }
  }, []);

  if (!link || dismissedForPage) return null;
  return <MobileAppBanner link={link} onDismiss={dismiss} />;
}
