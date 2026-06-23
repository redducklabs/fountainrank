import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../theme";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brandBlue} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { marginTop: spacing.sm, color: colors.textMuted },
});
