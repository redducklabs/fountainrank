import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme";

export function EmptyState({ label = "Nothing here yet." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { color: colors.textMuted, fontSize: 15, textAlign: "center" },
});
