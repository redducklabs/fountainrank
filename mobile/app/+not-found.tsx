import { Link, Stack } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { ScreenContainer } from "../components/ScreenContainer";
import { colors, spacing, typography } from "../theme";

export default function NotFound() {
  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Not found" }} />
      <Text style={styles.title}>Not found</Text>
      <Link href="/" style={styles.link}>
        Go to the map
      </Link>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.brandBlue, marginBottom: spacing.md },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
});
