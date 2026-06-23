import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { colors, spacing, typography } from "../../theme";

export default function FountainDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <View style={styles.body}>
        <Text style={styles.title}>Fountain</Text>
        <Text style={styles.meta}>id: {id}</Text>
        <Text style={styles.note}>
          Fountain detail (rating, status, attributes, notes) arrives in slice 6e-4.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.sm },
  title: { ...typography.title, color: colors.brandBlue },
  meta: { ...typography.meta, color: colors.textMuted },
  note: { ...typography.body, color: colors.textMuted },
});
