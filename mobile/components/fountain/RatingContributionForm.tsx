import type { components } from "@fountainrank/api-client";
import {
  ratingPointsPreview,
  totalPreviewPoints,
  type PointsLine,
} from "@fountainrank/contributions";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ContributionError } from "../../lib/contributions/state";
import { buildRatingPayload } from "../../lib/contributions/payloads";
import { contributionErrorText } from "../../lib/contributions/state";
import { createGuardedSubmit, type GuardedSubmit } from "../../lib/contributions/submit-flow";
import { requestCurrentCoords } from "../../lib/location-request";
import { colors, spacing, typography } from "../../theme";

type Dimension = components["schemas"]["DimensionSummary"];
type RateRequest = components["schemas"]["RateRequest"];

type Message = { tone: "ok" | "err"; text: string } | null;

// Effective stars = the user's explicit tap for a dimension, else their saved `your_rating`, else
// undefined. Derived (not synced via an effect) so a previously-rated fountain pre-fills even when
// `your_rating` loads after mount, and the user's edits always win (#65). Exported so the screen's
// add-photo flush (#1) can build the same payload the form would.
export function effectiveStars(
  dimensions: Dimension[],
  edits: Record<number, number>,
): Record<number, number | undefined> {
  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension.rating_type_id,
      edits[dimension.rating_type_id] ?? dimension.your_rating ?? undefined,
    ]),
  );
}

export function RatingContributionForm({
  fountainId,
  dimensions,
  pending,
  onSubmit,
  edits,
  onStarPress,
}: {
  fountainId: string;
  dimensions: Dimension[];
  pending: boolean;
  onSubmit: (body: RateRequest) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
  // The draft lives in the screen (lifted from local state) so "Add photo" can flush it (#1).
  edits: Record<number, number>;
  onStarPress: (ratingTypeId: number, value: number) => void;
}) {
  const [message, setMessage] = useState<Message>(null);
  // Local, synchronous busy state so the spinner shows the instant the user taps — before the
  // awaited geolocation and before the owner's mutation flips `pending` (#212). Combined with
  // `pending` below to drive the spinner and disabled state.
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);
  // Created in the effect (not during render) so we never read/pass a ref during render — the
  // React-Compiler lint (react-hooks/refs) forbids that. Read only in the submit handler.
  const guardRef = useRef<GuardedSubmit<boolean> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const hasExistingRating = dimensions.some((dimension) => dimension.your_rating != null);
  const stars = effectiveStars(dimensions, edits);
  // Coord-less build drives the points preview + the submit-disabled state; submit() rebuilds
  // with coords (fetched on the tap) so a location prompt never fires just from rendering.
  const previewPayload = buildRatingPayload(fountainId, stars);
  const preview = ratingPointsPreview(previewPayload.ok ? previewPayload.value.ratings.length : 0);
  const busy = pending || submitting;

  function submit() {
    // Lazily create the single-flight guard on the first tap (in the handler, never during render —
    // the react-hooks/refs lint forbids ref access there) so the very first tap works immediately
    // without depending on an effect having run.
    const guard = (guardRef.current ??= createGuardedSubmit<boolean>({
      setBusy: setSubmitting,
      idle: false,
      isMounted: () => mountedRef.current,
    }));
    void guard(true, async () => {
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
    });
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
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => onStarPress(dimension.rating_type_id, value)}
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
        disabled={busy || !previewPayload.ok}
        pending={busy}
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
  pending = false,
  onPress,
}: {
  label: string;
  disabled: boolean;
  // When true, shows an inline ActivityIndicator alongside the label and marks the control busy for
  // assistive tech (#212). Distinct from `disabled` so the caller controls each independently.
  pending?: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: pending }}
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
      {pending ? <ActivityIndicator size="small" color={colors.onBrand} /> : null}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
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
