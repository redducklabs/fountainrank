export type MobileStoreLink = {
  store: "ios" | "android";
  label: string;
  href: string;
};

export type MobilePlatform = MobileStoreLink["store"];

export const MOBILE_APP_BANNER_DISMISSED_KEY = "fr-mobile-app-banner-dismissed";

type PlatformDetectionInput = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

export function detectMobilePlatform({
  userAgent,
  platform,
  maxTouchPoints,
}: PlatformDetectionInput): MobilePlatform | null {
  if (/android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";

  // iPadOS can request a desktop-class user agent and identify itself as a Mac.
  if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";

  return null;
}

export function isStandaloneDisplayMode({
  displayModeStandalone,
  navigatorStandalone,
}: {
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
}): boolean {
  return displayModeStandalone || navigatorStandalone;
}

export function selectMobileStoreLink(
  links: MobileStoreLink[],
  platform: MobilePlatform | null,
): MobileStoreLink | null {
  if (!platform) return null;
  return links.find((link) => link.store === platform) ?? null;
}

export function resolveMobileStoreLinks(
  envOverride?: Record<string, string | undefined>,
): MobileStoreLink[] {
  const appStoreUrl = envOverride
    ? envOverride["NEXT_PUBLIC_APP_STORE_URL"]
    : process.env.NEXT_PUBLIC_APP_STORE_URL;
  const googlePlayUrl = envOverride
    ? envOverride["NEXT_PUBLIC_GOOGLE_PLAY_URL"]
    : process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL;

  return [
    ...(appStoreUrl
      ? [{ store: "ios" as const, label: "Download on the App Store", href: appStoreUrl }]
      : []),
    ...(googlePlayUrl
      ? [{ store: "android" as const, label: "Get it on Google Play", href: googlePlayUrl }]
      : []),
  ];
}
