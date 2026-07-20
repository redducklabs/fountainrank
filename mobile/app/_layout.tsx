import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ScreenContainer } from "../components/ScreenContainer";
import { parseMobileConfig, type MobileConfig } from "../lib/config";
import { ApiProvider } from "../providers/api-provider";
import { AuthProvider, useAuth } from "../providers/auth-provider";
import { colors, typography } from "../theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  console.warn("[bootstrap] splash prevent-auto-hide failed", (error as Error)?.name);
});

function BootstrapSplashGate() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "initializing") return;
    void SplashScreen.hideAsync().catch((error: unknown) => {
      console.warn("[bootstrap] splash hide failed", (error as Error)?.name);
    });
  }, [auth.status]);
  return null;
}

let mobileConfig: MobileConfig | null;
let configError: string | null;
try {
  mobileConfig = parseMobileConfig(Constants.expoConfig?.extra);
  configError = null;
} catch (err) {
  mobileConfig = null;
  configError = err instanceof Error ? err.message : "Invalid mobile configuration";
}

if (!mobileConfig) {
  void SplashScreen.hideAsync().catch((error: unknown) => {
    console.warn("[bootstrap] configuration-error splash hide failed", (error as Error)?.name);
  });
}

export default function RootLayout() {
  if (!mobileConfig) {
    return (
      <SafeAreaProvider>
        <ScreenContainer includeTopInset>
          <View style={styles.center}>
            <Text style={styles.title}>FountainRank</Text>
            <Text style={styles.error}>Configuration error: {configError}</Text>
          </View>
        </ScreenContainer>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider config={mobileConfig}>
          <BootstrapSplashGate />
          <ApiProvider config={mobileConfig}>
            <Stack screenOptions={{ headerShown: false }} />
            <StatusBar style="dark" />
          </ApiProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { ...typography.title, color: colors.brandBlue, marginBottom: 8 },
  error: { color: colors.danger, textAlign: "center" },
});
