import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../theme";

export function ErrorState({
  label = "Something went wrong.",
  onRetry,
}: {
  label?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.label}>{label}</Text>
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { color: colors.danger, fontSize: 15, textAlign: "center", marginBottom: spacing.md },
  button: {
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
  },
  buttonLabel: { color: colors.onBrand, fontWeight: "600" },
});
