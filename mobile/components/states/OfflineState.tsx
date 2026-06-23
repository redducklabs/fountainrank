import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../theme";

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.label}>You appear to be offline.</Text>
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginBottom: spacing.md },
  button: {
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
  },
  buttonLabel: { color: colors.onBrand, fontWeight: "600" },
});
