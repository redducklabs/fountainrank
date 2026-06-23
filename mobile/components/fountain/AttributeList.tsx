import type { components } from "@fountainrank/api-client";
import { StyleSheet, Text, View } from "react-native";

import { groupAttributes } from "../../lib/detail/attributes";
import { attributeDisplay, type AttrTone, formatCategory } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type Attr = components["schemas"]["AttributeConsensusOut"];

const TONE: Record<AttrTone, string> = {
  normal: colors.text,
  muted: colors.textMuted,
  mixed: "#92400E",
};

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  const groups = groupAttributes(attributes);
  if (groups.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.category} style={styles.group}>
          <Text style={styles.header}>{formatCategory(g.category).toUpperCase()}</Text>
          {g.items.map((a) => {
            const d = attributeDisplay(a);
            return (
              <View key={a.attribute_type_id} style={styles.row}>
                <Text style={styles.name}>{a.name}</Text>
                <Text style={[styles.value, { color: TONE[d.tone] }]}>
                  {d.text}
                  {d.hint ? <Text style={styles.hint}>{` ${d.hint}`}</Text> : null}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.xs },
  header: { ...typography.meta, color: colors.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  name: { ...typography.body, color: colors.textMuted, flexShrink: 1 },
  value: { ...typography.body, textAlign: "right" },
  hint: { ...typography.meta, color: colors.textMuted },
});
