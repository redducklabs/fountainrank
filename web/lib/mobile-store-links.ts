export type MobileStoreLink = {
  store: "ios" | "android";
  label: string;
  href: string;
};

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
