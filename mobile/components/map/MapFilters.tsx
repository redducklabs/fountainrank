import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import type { FountainFilters } from "../../lib/map/filters";
import { colors, spacing, typography } from "../../theme";

type MapFiltersProps = {
  filters: FountainFilters;
  onChange: (next: FountainFilters) => void;
};

// Basic minimum-rating cycle: off -> 3+ -> 4+ -> off.
function nextMinRating(current: number | null): number | null {
  if (current == null) return 3;
  if (current === 3) return 4;
  return null;
}

export function MapFilters({ filters, onChange }: MapFiltersProps) {
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chip("Working now", filters.workingNow, () =>
        onChange({ ...filters, workingNow: !filters.workingNow }),
      )}
      {chip("Bottle filler", filters.bottleFiller, () =>
        onChange({ ...filters, bottleFiller: !filters.bottleFiller }),
      )}
      {chip("Wheelchair", filters.wheelchairReachable, () =>
        onChange({ ...filters, wheelchairReachable: !filters.wheelchairReachable }),
      )}
      {chip(
        filters.minRating == null ? "Any rating" : `${filters.minRating}★+`,
        filters.minRating != null,
        () => onChange({ ...filters, minRating: nextMinRating(filters.minRating) }),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipText: { ...typography.meta, color: colors.text },
  chipTextActive: { color: colors.onBrand },
});
