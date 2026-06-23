import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { makeClient } from "@fountainrank/api-client";

import { formatBuildInfo } from "./lib/build-info";
import { parseMobileConfig, type MobileConfig } from "./lib/config";

const versionCode = Constants.expoConfig?.android?.versionCode;
const buildLabel = formatBuildInfo(
  Constants.expoConfig?.version,
  Platform.OS === "ios"
    ? Constants.expoConfig?.ios?.buildNumber
    : versionCode != null
      ? String(versionCode)
      : null,
);

let mobileConfig: MobileConfig | null;
let configError: string | null;
try {
  mobileConfig = parseMobileConfig(Constants.expoConfig?.extra);
  configError = null;
} catch (err) {
  mobileConfig = null;
  configError = err instanceof Error ? err.message : "Invalid mobile configuration";
}

type Status = "loading" | "ok" | "error";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!mobileConfig) return;
    makeClient(mobileConfig.apiBaseUrl)
      .GET("/healthz")
      .then(({ data, error }) => setStatus(!error && data?.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  if (configError) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>FountainRank</Text>
        <Text>Configuration error: {configError}</Text>
        <Text style={styles.meta}>{buildLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FountainRank</Text>
      <Text>Backend status: {status}</Text>
      <Text style={styles.meta}>{buildLabel}</Text>
      <Text style={styles.meta}>{mobileConfig?.apiBaseUrl}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
  meta: { marginTop: 8, color: "#475569", fontSize: 12 },
});
