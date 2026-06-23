import { StyleSheet, Text, View } from "react-native";

import {
  formatDateFull,
  formatRelativeTime,
  statusDisplay,
  type StatusTone,
} from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

const CHIP: Record<StatusTone, { bg: string; fg: string }> = {
  ok: { bg: "#D1FAE5", fg: "#065F46" },
  warn: { bg: "#FEF3C7", fg: "#92400E" },
  bad: { bg: "#FEE2E2", fg: "#991B1B" },
};

export function StatusBlock({
  currentStatus,
  isWorking,
  lastVerifiedAt,
  now,
}: {
  currentStatus: string | null | undefined;
  isWorking: boolean;
  lastVerifiedAt: string | null | undefined;
  now: Date;
}) {
  const { chipLabel, chipTone, advisory } = statusDisplay(currentStatus, isWorking);
  const chip = CHIP[chipTone];
  const verifiedText = lastVerifiedAt
    ? `Last verified ${formatRelativeTime(lastVerifiedAt, now)}`
    : "Not yet verified by anyone";
  // RN has no hover title — preserve the exact last-verified date for screen readers.
  const verifiedA11y = lastVerifiedAt
    ? `${verifiedText} (${formatDateFull(lastVerifiedAt)})`
    : verifiedText;
  return (
    <View style={styles.wrap}>
      <View style={[styles.chip, { backgroundColor: chip.bg }]}>
        <Text style={[styles.chipText, { color: chip.fg }]}>{chipLabel}</Text>
      </View>
      {advisory ? <Text style={styles.advisory}>{`⚠ ${advisory}`}</Text> : null}
      <Text style={styles.verified} accessibilityLabel={verifiedA11y}>
        {verifiedText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, alignItems: "flex-start" },
  chip: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { ...typography.meta, fontWeight: "700" },
  advisory: { ...typography.meta, color: "#92400E" },
  verified: { ...typography.meta, color: colors.textMuted },
});
