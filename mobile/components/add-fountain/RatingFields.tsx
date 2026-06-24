import type { components } from "@fountainrank/api-client";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "../../theme";

type RatingTypeOut = components["schemas"]["RatingTypeOut"];

export function RatingFields({
  ratingTypes,
  values,
  disabled,
  onChange,
}: {
  ratingTypes: RatingTypeOut[];
  values: Record<number, number | undefined>;
  disabled: boolean;
  onChange: (values: Record<number, number | undefined>) => void;
}) {
  if (ratingTypes.length === 0) return null;
  const sorted = [...ratingTypes].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Initial rating</Text>
      {sorted.map((type) => (
        <View key={type.id} style={styles.row}>
          <Text style={styles.label}>{type.name}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((stars) => {
              const selected = (values[type.id] ?? 0) >= stars;
              return (
                <Pressable
                  key={stars}
                  accessibilityRole="button"
                  accessibilityLabel={`${type.name} ${stars} stars`}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => onChange({ ...values, [type.id]: stars })}
                  style={styles.starButton}
                >
                  <Text style={[styles.star, selected ? styles.starSelected : null]}>★</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...typography.body, fontWeight: "700", color: colors.text },
  row: { gap: spacing.xs },
  label: { ...typography.body, color: colors.textMuted },
  stars: { flexDirection: "row", gap: spacing.xs },
  starButton: { minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center" },
  star: { fontSize: 26, color: colors.border },
  starSelected: { color: colors.brandYellow },
});
