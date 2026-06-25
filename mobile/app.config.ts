import type { ExpoConfig } from "expo/config";

const logtoNativeAuthConfirmed = process.env.EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED === "true";
const logtoAppId = logtoNativeAuthConfirmed ? process.env.EXPO_PUBLIC_LOGTO_APP_ID : undefined;

const config: ExpoConfig = {
  name: "FountainRank",
  slug: "fountainrank",
  owner: "red-duck-labs",
  version: "0.1.0",
  scheme: "com.redducklabs.fountainrank",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  plugins: [
    "expo-router",
    "@maplibre/maplibre-react-native",
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
      NSLocationWhenInUseUsageDescription:
        "FountainRank uses your location to show nearby drinking fountains and to place a fountain you add.",
    },
  },
  android: {
    package: "com.redducklabs.fountainrank",
    versionCode: 1,
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.fountainrank.com",
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
