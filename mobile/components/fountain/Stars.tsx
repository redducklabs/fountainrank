import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme";

const EMPTY = "#CBD5E1";
const FIVE = "★★★★★";

/**
 * Read-only star rating. A slate base row of 5 stars with a fractional gold
 * overlay clipped to the rounded-to-half score, so 3.5 reads as 3½ filled.
 * Matches the web Stars half-star rounding (nearest 0.5). Decorative; the
 * numeric value is the accessible label.
 */
export function Stars({
  value,
  size = 16,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const v = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  const pct = (v / 5) * 100;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? `Rated ${v.toFixed(1)} out of 5`}
      style={styles.wrap}
    >
      <Text style={[styles.row, { fontSize: size, color: EMPTY }]}>{FIVE}</Text>
      <View style={[styles.overlay, { width: `${pct}%` }]} pointerEvents="none">
        <Text style={[styles.row, { fontSize: size, color: colors.brandYellow }]}>{FIVE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", alignSelf: "flex-start" },
  row: { letterSpacing: 1 },
  overlay: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" },
});
