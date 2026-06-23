import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { colors, spacing, typography } from "../../theme";

export default function MapScreen() {
  return (
    <ScreenContainer>
      <View style={styles.body}>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.note}>
          The interactive map and nearby fountains arrive in slice 6e-3.
        </Text>
        <Link href="/fountains/sample" style={styles.link}>
          Preview a fountain detail
        </Link>
        <Link href="/diagnostics" style={styles.link}>
          Diagnostics
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.md },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
});
