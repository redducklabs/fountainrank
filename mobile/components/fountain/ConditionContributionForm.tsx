import type { components } from "@fountainrank/api-client";
import { conditionPointsPreview } from "@fountainrank/contributions";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { buildConditionPayload } from "../../lib/contributions/payloads";
import type { ContributionError } from "../../lib/contributions/state";
import {
  conditionStatusLabel,
  contributionErrorText,
  PROBLEM_CONDITION_STATUSES,
} from "../../lib/contributions/state";
import { colors, spacing, typography } from "../../theme";
import { ContributionMessage, PointsPreview, SubmitButton } from "./RatingContributionForm";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
type ConditionReportRequest = components["schemas"]["ConditionReportRequest"];

export function ConditionContributionForm({
  fountainId,
  pending,
  onSubmit,
}: {
  fountainId: string;
  pending: boolean;
  onSubmit: (
    body: ConditionReportRequest,
  ) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
}) {
  const [problem, setProblem] = useState<ConditionStatus>(PROBLEM_CONDITION_STATUSES[0]);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit(status: ConditionStatus) {
    setMessage(null);
    const payload = buildConditionPayload(fountainId, status);
    if (!payload.ok) {
      setMessage({ tone: "err", text: "Choose a valid status." });
      return;
    }
    const result = await onSubmit(payload.value);
    setMessage(
      result.ok
        ? { tone: "ok", text: "Thanks. Your status report was saved." }
        : { tone: "err", text: contributionErrorText(result.error) },
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Is it working?</Text>
      <SubmitButton
        label="I checked - it's working"
        disabled={pending}
        onPress={() => submit("working")}
      />
      <PointsPreview lines={conditionPointsPreview("working")} />
      <Text style={styles.label}>Report a problem</Text>
      <View style={styles.options}>
        {PROBLEM_CONDITION_STATUSES.map((status) => {
          const selected = status === problem;
          return (
            <Pressable
              key={status}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: pending }}
              disabled={pending}
              onPress={() => setProblem(status)}
              style={[styles.option, selected ? styles.optionSelected : null]}
            >
              <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
                {conditionStatusLabel(status)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <PointsPreview lines={conditionPointsPreview("problem")} />
      <SubmitButton label="Submit problem" disabled={pending} onPress={() => submit(problem)} />
      <ContributionMessage message={message} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...typography.body, fontWeight: "700", color: colors.text },
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
