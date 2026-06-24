import type { components } from "@fountainrank/api-client";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { attributeOptions, buildAttributeGroups } from "../../lib/add-fountain/payloads";
import { attributeValueLabel, formatCategory } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];

export function AttributeFields({
  attributeTypes,
  values,
  disabled,
  onChange,
}: {
  attributeTypes: AttributeTypeOut[];
  values: Record<number, string | undefined>;
  disabled: boolean;
  onChange: (values: Record<number, string | undefined>) => void;
}) {
  const groups = buildAttributeGroups(attributeTypes);
  if (groups.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Access and features</Text>
      {groups.map((group) => (
        <View key={group.category} style={styles.group}>
          <Text style={styles.groupTitle}>{formatCategory(group.category).toUpperCase()}</Text>
          {group.items.map((attribute) => (
            <View key={attribute.id} style={styles.attribute}>
              <Text style={styles.label}>{attribute.name}</Text>
              <View style={styles.options}>
                {attributeOptions(attribute).map((value) => {
                  const selected = (values[attribute.id] ?? "unknown") === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled }}
                      disabled={disabled}
                      onPress={() => onChange({ ...values, [attribute.id]: value })}
                      style={[styles.option, selected ? styles.optionSelected : null]}
                    >
                      <Text
                        style={[styles.optionText, selected ? styles.optionTextSelected : null]}
                      >
                        {attributeValueLabel(value)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...typography.body, fontWeight: "700", color: colors.text },
  group: { gap: spacing.sm },
  groupTitle: { ...typography.meta, color: colors.textMuted, fontWeight: "700" },
  attribute: { gap: spacing.xs },
  label: { ...typography.body, color: colors.textMuted },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.brandBlue, backgroundColor: colors.brandBlue },
  optionText: { ...typography.meta, color: colors.text },
  optionTextSelected: { color: colors.onBrand, fontWeight: "700" },
});
