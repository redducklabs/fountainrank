import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export function ScreenContainer({
  children,
  includeTopInset = false,
}: {
  children: ReactNode;
  includeTopInset?: boolean;
}) {
  const edges: Edge[] = includeTopInset
    ? ["top", "left", "right", "bottom"]
    : ["left", "right", "bottom"];
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.lg },
});
