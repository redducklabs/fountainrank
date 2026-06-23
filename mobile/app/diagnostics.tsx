import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../components/ScreenContainer";
import { QueryStateView } from "../components/states/QueryStateView";
import { unwrap } from "../lib/api";
import { formatBuildInfo } from "../lib/build-info";
import { useApi } from "../providers/api-provider";
import { colors, spacing, typography } from "../theme";

export default function DiagnosticsScreen() {
  const { client, config } = useApi();
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: async () => unwrap(await client.GET("/healthz")),
  });

  const versionCode = Constants.expoConfig?.android?.versionCode;
  const buildLabel = formatBuildInfo(
    Constants.expoConfig?.version,
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : versionCode != null
        ? String(versionCode)
        : null,
  );

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Diagnostics" }} />
      <View style={styles.body}>
        <Text style={styles.title}>Diagnostics</Text>
        <Text style={styles.meta}>{buildLabel}</Text>
        <Text style={styles.meta}>{config.apiBaseUrl}</Text>
        <View style={styles.statusBox}>
          <QueryStateView
            input={{ isLoading: health.isLoading, isError: health.isError, error: health.error }}
            onRetry={() => {
              void health.refetch();
            }}
          >
            <Text style={styles.ok}>Backend reachable</Text>
          </QueryStateView>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.sm },
  title: { ...typography.title, color: colors.brandBlue },
  meta: { ...typography.meta, color: colors.textMuted },
  statusBox: { height: 140, marginTop: spacing.md },
  ok: { ...typography.body, color: colors.brandBlue, textAlign: "center", marginTop: spacing.lg },
});
