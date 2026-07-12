import type { components } from "@fountainrank/api-client";
import {
  conditionPointsBlocked,
  conditionPointsEligibleInText,
  conditionPointsPreview,
  type AwardedPoints,
} from "@fountainrank/contributions";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { buildConditionPayload } from "../../lib/contributions/payloads";
import type { ContributionError } from "../../lib/contributions/state";
import {
  conditionStatusLabel,
  contributionErrorText,
  PROBLEM_CONDITION_STATUSES,
} from "../../lib/contributions/state";
import { createGuardedSubmit, type GuardedSubmit } from "../../lib/contributions/submit-flow";
import { requestCurrentCoords } from "../../lib/location-request";
import { colors, spacing, typography } from "../../theme";
import { ContributionMessage, PointsPreview, SubmitButton } from "./RatingContributionForm";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
type ConditionReportRequest = components["schemas"]["ConditionReportRequest"];

export function ConditionContributionForm({
  fountainId,
  pending,
  onSubmit,
  conditionPointsEligibleAt,
}: {
  fountainId: string;
  pending: boolean;
  onSubmit: (
    body: ConditionReportRequest,
  ) => Promise<
    { ok: true; pointsAwarded: AwardedPoints } | { ok: false; error: ContributionError }
  >;
  conditionPointsEligibleAt?: string | null;
}) {
  const [problem, setProblem] = useState<ConditionStatus>(PROBLEM_CONDITION_STATUSES[0]);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Which status is currently submitting, so only the tapped button spins while both stay disabled
  // (the two buttons share one in-flight guard). Set synchronously on tap for an instant spinner (#212).
  const [submittingStatus, setSubmittingStatus] = useState<ConditionStatus | null>(null);
  const mountedRef = useRef(true);
  // Created in the effect (not during render) so we never read/pass a ref during render — the
  // React-Compiler lint (react-hooks/refs) forbids that. Read only in the submit handler.
  const guardRef = useRef<GuardedSubmit<ConditionStatus | null> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const now = new Date();
  const blocked = conditionPointsBlocked(conditionPointsEligibleAt, now);
  const eligibleIn = conditionPointsEligibleInText(conditionPointsEligibleAt, now);
  const busy = pending || submittingStatus !== null;

  function submit(status: ConditionStatus) {
    // Lazily create the single-flight guard on the first tap (in the handler, never during render —
    // the react-hooks/refs lint forbids ref access there) so the very first tap works immediately.
    const guard = (guardRef.current ??= createGuardedSubmit<ConditionStatus | null>({
      setBusy: setSubmittingStatus,
      idle: null,
      isMounted: () => mountedRef.current,
    }));
    void guard(status, async () => {
      setMessage(null);
      // Best-effort location so the server can derive is_proximate (#3); never blocks (null ok).
      const coords = await requestCurrentCoords();
      const payload = buildConditionPayload(fountainId, status, coords);
      if (!payload.ok) {
        setMessage({ tone: "err", text: "Choose a valid status." });
        return;
      }
      const result = await onSubmit(payload.value);
      setMessage(
        result.ok
          ? {
              tone: "ok" as const,
              text:
                result.pointsAwarded > 0
                  ? `Thanks — you earned ${result.pointsAwarded} points.`
                  : "Status saved. (Already counted recently, so no points this time.)",
            }
          : { tone: "err", text: contributionErrorText(result.error) },
      );
    });
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Is it working?</Text>
      <SubmitButton
        label="I checked - it's working"
        disabled={busy}
        pending={submittingStatus === "working"}
        onPress={() => submit("working")}
      />
      {blocked ? (
        <Text style={styles.limitNote}>
          You&rsquo;ve earned points for updating this fountain recently — you can still update its
          status, but it won&rsquo;t earn points again{eligibleIn ? ` for ${eligibleIn}` : ""}.
        </Text>
      ) : (
        <PointsPreview lines={conditionPointsPreview("working")} />
      )}
      <Text style={styles.label}>Report a problem</Text>
      <View style={styles.options}>
        {PROBLEM_CONDITION_STATUSES.map((status) => {
          const selected = status === problem;
          return (
            <Pressable
              key={status}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
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
      {blocked ? null : <PointsPreview lines={conditionPointsPreview("problem")} />}
      <SubmitButton
        label="Submit problem"
        disabled={busy}
        pending={submittingStatus !== null && submittingStatus !== "working"}
        onPress={() => submit(problem)}
      />
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
  limitNote: {
    ...typography.meta,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: spacing.sm,
    fontWeight: "600",
  },
});
