import type { components } from "@fountainrank/api-client";
import { attributeEarnablePoints, type ViewerAwardStateT } from "@fountainrank/contributions";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { attributeOptions, buildAttributePayload } from "../../lib/contributions/payloads";
import type { ContributionError } from "../../lib/contributions/state";
import { contributionErrorText } from "../../lib/contributions/state";
import { formatCategory, attributeValueLabel } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";
import {
  ContributionMessage,
  NoPointsNotice,
  PointsPreview,
  SubmitButton,
} from "./RatingContributionForm";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type ObserveAttributesRequest = components["schemas"]["ObserveAttributesRequest"];

export function AttributeContributionForm({
  fountainId,
  attributeTypes,
  pending,
  isLoading,
  isError,
  onRetry,
  onSubmit,
  viewerAwardState,
}: {
  fountainId: string;
  attributeTypes: AttributeTypeOut[];
  pending: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  // What this viewer can still EARN here, from the contribution ledger (#204).
  viewerAwardState?: ViewerAwardStateT | null;
  onSubmit: (
    body: ObserveAttributesRequest,
  ) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
}) {
  const [values, setValues] = useState<Record<number, string | undefined>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const groups = useMemo(() => groupAttributeTypes(attributeTypes), [attributeTypes]);
  const payload = buildAttributePayload(fountainId, attributeTypes, values);
  // Only what the viewer can ACTUALLY still earn, per the ledger (#204).
  const chosenAttributeIds = payload.ok
    ? payload.value.observations.map((o) => o.attribute_type_id)
    : [];
  const earnable = attributeEarnablePoints(viewerAwardState, chosenAttributeIds);

  async function submit() {
    setMessage(null);
    if (!payload.ok) {
      setMessage({ tone: "err", text: "Choose at least one valid observation." });
      return;
    }
    const result = await onSubmit(payload.value);
    setMessage(
      result.ok
        ? { tone: "ok", text: "Thanks. Your observations were saved." }
        : { tone: "err", text: contributionErrorText(result.error) },
    );
  }

  if (isLoading) {
    return <CatalogState title="Access and features" text="Loading attribute options..." />;
  }
  if (isError) {
    return (
      <CatalogState
        title="Access and features"
        text="Attribute options couldn't load."
        onRetry={onRetry}
      />
    );
  }
  if (groups.length === 0) {
    return <CatalogState title="Access and features" text="No attribute options are available." />;
  }

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
                  const selected = values[attribute.id] === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: pending }}
                      disabled={pending}
                      onPress={() =>
                        setValues((current) => ({
                          ...current,
                          [attribute.id]: selected ? undefined : value,
                        }))
                      }
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
      {chosenAttributeIds.length > 0 && earnable.length === 0 ? (
        <NoPointsNotice text="You've already earned points for these details — you can still update them, but they won't earn points again." />
      ) : (
        <PointsPreview lines={earnable} />
      )}
      <SubmitButton
        label="Save observations"
        disabled={pending || !payload.ok}
        pending={pending}
        onPress={submit}
      />
      <ContributionMessage message={message} />
    </View>
  );
}

function groupAttributeTypes(attributeTypes: AttributeTypeOut[]) {
  const sorted = [...attributeTypes]
    .filter((attribute) => attribute.place_type === "fountain")
    .sort((a, b) => a.sort_order - b.sort_order);
  const order: string[] = [];
  const byCategory = new Map<string, AttributeTypeOut[]>();
  for (const attribute of sorted) {
    if (!byCategory.has(attribute.category)) {
      byCategory.set(attribute.category, []);
      order.push(attribute.category);
    }
    byCategory.get(attribute.category)!.push(attribute);
  }
  return order.map((category) => ({ category, items: byCategory.get(category)! }));
}

function CatalogState({
  title,
  text,
  onRetry,
}: {
  title: string;
  text: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.stateText}>{text}</Text>
      {onRetry ? <SubmitButton label="Retry" disabled={false} onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...typography.body, fontWeight: "700", color: colors.text },
  stateText: { ...typography.body, color: colors.textMuted },
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
