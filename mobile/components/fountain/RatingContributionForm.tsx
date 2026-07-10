import type { components } from "@fountainrank/api-client";
import {
  ratingPointsPreview,
  totalPreviewPoints,
  type PointsLine,
} from "@fountainrank/contributions";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ContributionError } from "../../lib/contributions/state";
import { buildRatingPayload } from "../../lib/contributions/payloads";
import { contributionErrorText } from "../../lib/contributions/state";
import { requestCurrentCoords } from "../../lib/location-request";
import { colors, spacing, typography } from "../../theme";

type Dimension = components["schemas"]["DimensionSummary"];
type RateRequest = components["schemas"]["RateRequest"];

type Message = { tone: "ok" | "err"; text: string } | null;

export function RatingContributionForm({
  fountainId,
  dimensions,
  pending,
  onSubmit,
}: {
  fountainId: string;
  dimensions: Dimension[];
  pending: boolean;
  onSubmit: (body: RateRequest) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
}) {
  // Track only the user's explicit taps; the effective stars fall back to the caller's
  // saved rating (`your_rating`). Deriving this each render instead of syncing via an
  // effect means a previously-rated fountain pre-fills correctly even when `your_rating`
  // loads after mount or changes on sign-in, and the user's edits always win (#65).
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<Message>(null);
  const hasExistingRating = dimensions.some((dimension) => dimension.your_rating != null);
  const stars: Record<number, number | undefined> = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension.rating_type_id,
      edits[dimension.rating_type_id] ?? dimension.your_rating ?? undefined,
    ]),
  );
  // Coord-less build drives the points preview + the submit-disabled state; submit() rebuilds
  // with coords (fetched on the tap) so a location prompt never fires just from rendering.
  const previewPayload = buildRatingPayload(fountainId, stars);
  const preview = ratingPointsPreview(previewPayload.ok ? previewPayload.value.ratings.length : 0);

  async function submit() {
    setMessage(null);
    // Best-effort location for the proximity guard (#3); never blocks (null ok -> unverified).
    const coords = await requestCurrentCoords();
    const payload = buildRatingPayload(fountainId, stars, coords);
    if (!payload.ok) {
      setMessage({ tone: "err", text: "Choose at least one rating." });
      return;
    }
    const result = await onSubmit(payload.value);
    setMessage(
      result.ok
        ? { tone: "ok", text: "Thanks. Your rating was saved." }
        : { tone: "err", text: contributionErrorText(result.error) },
    );
  }

  if (dimensions.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Rate it</Text>
      {hasExistingRating ? (
        <Text style={styles.alreadyRated}>
          You’ve rated this fountain. Update your stars and submit to change it.
        </Text>
      ) : null}
      {dimensions.map((dimension) => (
        <View key={dimension.rating_type_id} style={styles.row}>
          <Text style={styles.label}>{dimension.name}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => {
              const selected = (stars[dimension.rating_type_id] ?? 0) >= value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${dimension.name} ${value} stars`}
                  accessibilityState={{ selected }}
                  disabled={pending}
                  onPress={() =>
                    setEdits((current) => ({
                      ...current,
                      [dimension.rating_type_id]: value,
                    }))
                  }
                  style={styles.starButton}
                >
                  <Text style={[styles.star, selected ? styles.starSelected : null]}>★</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <PointsPreview lines={preview} />
      <SubmitButton
        label={hasExistingRating ? "Update rating" : "Submit rating"}
        disabled={pending || !previewPayload.ok}
        onPress={submit}
      />
      <ContributionMessage message={message} />
    </View>
  );
}

export function ContributionMessage({ message }: { message: Message }) {
  useEffect(() => {
    if (message && Platform.OS !== "android") {
      AccessibilityInfo.announceForAccessibility(message.text);
    }
  }, [message]);

  if (!message) return null;
  return (
    <Text
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={[styles.message, message.tone === "ok" ? styles.ok : styles.err]}
    >
      {message.text}
    </Text>
  );
}

export function PointsPreview({ lines }: { lines: PointsLine[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.pointsPreview}>
      <Text
        style={styles.pointsPreviewTitle}
      >{`+${totalPreviewPoints(lines)} possible points`}</Text>
      {lines.map((line) => (
        <Text key={`${line.label}-${line.points}`} style={styles.pointsPreviewLine}>
          {`+${line.points} ${line.label}${line.conditional ? " (conditional)" : ""}`}
        </Text>
      ))}
    </View>
  );
}

export function SubmitButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.submitButton,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={styles.submitText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...typography.body, fontWeight: "700", color: colors.text },
  alreadyRated: { ...typography.meta, color: colors.brandBlue, fontWeight: "600" },
  row: { gap: spacing.xs },
  label: { ...typography.body, color: colors.textMuted },
  stars: { flexDirection: "row", gap: spacing.xs },
  starButton: { minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center" },
  star: { fontSize: 26, color: colors.border },
  starSelected: { color: colors.brandYellow },
  submitButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  submitText: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
  pointsPreview: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  pointsPreviewTitle: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  pointsPreviewLine: { ...typography.meta, color: colors.textMuted },
  message: { ...typography.meta },
  ok: { color: "#047857" },
  err: { color: colors.danger },
});
