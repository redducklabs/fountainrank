import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "FountainRank",
  slug: "fountainrank",
  version: "0.1.0",
  scheme: "com.redducklabs.fountainrank",
  platforms: ["ios", "android"],
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
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.fountainrank.com",
    logtoEndpoint: process.env.EXPO_PUBLIC_LOGTO_ENDPOINT ?? "https://auth.fountainrank.com",
    logtoAudience: process.env.EXPO_PUBLIC_LOGTO_AUDIENCE ?? "https://api.fountainrank.com",
    authCallbackScheme: "com.redducklabs.fountainrank",
  },
};

export default config;
