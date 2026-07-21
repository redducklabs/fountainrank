import type { ExpoConfig } from "expo/config";

const logtoNativeAuthConfirmed = process.env.EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED === "true";
const logtoAppId = logtoNativeAuthConfirmed ? process.env.EXPO_PUBLIC_LOGTO_APP_ID : undefined;
// The iOS CFBundleShortVersionString / Android version name. Bump this for every store release:
// App Store Connect rejects re-submitting an already-submitted CFBundleShortVersionString, so the
// version must be NEW each release (Android is immune — it keys on the auto-incremented versionCode).
// Version 1.0.2 has shipped to the iOS store, so the next release floor is 1.0.3. The CI
// release (release-notes job) uses this as the version floor and passes it as EXPO_APP_VERSION.
const defaultAppVersion = "1.0.3";
const appVersion = process.env.EXPO_APP_VERSION ?? defaultAppVersion;

if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
  throw new Error(`EXPO_APP_VERSION must be a semver version like 1.0.0; received ${appVersion}`);
}

const config: ExpoConfig = {
  name: "FountainRank",
  slug: "fountainrank",
  owner: "red-duck-labs",
  version: appVersion,
  scheme: "com.redducklabs.fountainrank",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  plugins: [
    "expo-router",
    "expo-image",
    "@maplibre/maplibre-react-native",
    [
      "expo-image-picker",
      {
        cameraPermission: "Allow FountainRank to take photos of drinking fountains you add.",
        photosPermission: "Allow FountainRank to add photos of drinking fountains you choose.",
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
  ],
  runtimeVersion: { policy: "appVersion" },
  ios: {
    bundleIdentifier: "com.redducklabs.fountainrank",
    buildNumber: "1",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription:
        "FountainRank uses your location to show nearby drinking fountains and to place a fountain you add.",
    },
  },
  android: {
    package: "com.redducklabs.fountainrank",
    versionCode: 1,
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA"],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.fountainrank.com",
    // Public web origin for shareable fountain links (#168). Non-secret; overridable per build.
    webBaseUrl: process.env.EXPO_PUBLIC_WEB_BASE_URL ?? "https://fountainrank.com",
    logtoEndpoint: process.env.EXPO_PUBLIC_LOGTO_ENDPOINT ?? "https://auth.fountainrank.com",
    logtoAudience: process.env.EXPO_PUBLIC_LOGTO_AUDIENCE ?? "https://api.fountainrank.com",
    authCallbackScheme: "com.redducklabs.fountainrank",
    ...(logtoAppId ? { logtoAppId, logtoNativeAuthConfirmed: true } : {}),
    // Public basemap style (Protomaps "light" on the DO Spaces CDN) — the same
    // style the web client uses (see deploy.yml NEXT_PUBLIC_BASEMAP_STYLE_URL).
    // Public, non-secret; overridable per build via EXPO_PUBLIC_BASEMAP_STYLE_URL.
    basemapStyleUrl:
      process.env.EXPO_PUBLIC_BASEMAP_STYLE_URL ??
      "https://fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com/style.light.json",
    // EAS project linkage (public, non-secret — visible in the expo.dev URL).
    // Created via `eas init` under the red-duck-labs org. `parseMobileConfig`
    // ignores this key; EAS reads it directly from the resolved Expo config.
    eas: {
      projectId: "820564bf-5f29-44c7-8ec7-edde67b77360",
    },
  },
};

export default config;
