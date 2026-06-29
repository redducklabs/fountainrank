import type { components } from "@fountainrank/api-client";
import { StyleSheet, Text, View } from "react-native";

import { groupAttributes } from "../../lib/detail/attributes";
import {
  attributeChipVariant,
  attributeDisplay,
  type ChipVariant,
  formatCategory,
} from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type Attr = components["schemas"]["AttributeConsensusOut"];

const CHIP_BG: Record<ChipVariant, string> = {
  positive: "#E7F0FF",
  neutral: "#E7F0FF",
  negative: "#F1F5F9",
  mixed: "#FEF3C7",
  muted: "#F8FAFC",
};
const CHIP_FG: Record<ChipVariant, string> = {
  positive: colors.brandBlue,
  neutral: colors.brandBlue,
  negative: colors.textMuted,
  mixed: "#92400E",
  muted: "#94A3B8",
};
const GLYPH: Record<ChipVariant, string> = {
  positive: "✓",
  neutral: "•",
  negative: "✕",
  mixed: "~",
  muted: "•",
};

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  const groups = groupAttributes(attributes);
  if (groups.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.category} style={styles.group}>
          <Text style={styles.header}>{formatCategory(g.category).toUpperCase()}</Text>
          <View style={styles.chips}>
            {g.items.map((a) => {
              const d = attributeDisplay(a);
              const variant = attributeChipVariant(d);
              // Show the explicit value for neutral (a specific value) and muted
              // (low-confidence / unknown) chips; confident booleans use the glyph.
              const showValue = variant === "neutral" || variant === "muted";
              const label = showValue ? `${a.name}: ${d.text}` : a.name;
              return (
                <View
                  key={a.attribute_type_id}
                  style={[styles.chip, { backgroundColor: CHIP_BG[variant] }]}
                >
                  <Text style={[styles.chipText, { color: CHIP_FG[variant] }]}>
                    {`${GLYPH[variant]} ${label}`}
                  </Text>
                  {d.hint ? <Text style={styles.chipHint}>{d.hint}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.xs },
  header: { ...typography.meta, color: colors.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { ...typography.meta, fontWeight: "600" },
  chipHint: { ...typography.meta, color: colors.textMuted, fontSize: 10 },
});
