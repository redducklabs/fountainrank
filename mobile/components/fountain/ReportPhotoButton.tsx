import type { components } from "@fountainrank/api-client";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ContributionError } from "../../lib/contributions/state";
import { contributionErrorText } from "../../lib/contributions/state";
import { colors, spacing, typography } from "../../theme";

type PhotoOut = components["schemas"]["PhotoOut"];
type ReportCategory = components["schemas"]["ReportPhotoRequest"]["category"];

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "inappropriate", label: "Inappropriate" },
  { value: "not_a_fountain", label: "Not a fountain" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

/** The photo-report sheet, opened via `PhotoCarousel`'s "Report" trigger. A plain-props
 *  Modal (no dialog library exists in this app yet) mirroring the web `ReportPhotoDialog`'s
 *  category + optional note shape. `report_photo` (design §8.3) is idempotent server-side, so
 *  unlike the web dialog this doesn't need an `alreadyReported` short-circuit — a duplicate
 *  pending report from the same reporter is silently accepted (204) and shown as success.
 *  The caller should remount this component per photo (e.g. `key={photo?.id}`) so the local
 *  form state resets between reports. */
export function ReportPhotoButton({
  photo,
  pending,
  onSubmit,
  onClose,
}: {
  photo: PhotoOut | null;
  pending: boolean;
  onSubmit: (
    category: ReportCategory,
    note: string | undefined,
  ) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory>("inappropriate");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    const result = await onSubmit(category, note.trim() || undefined);
    if (result.ok) {
      setSubmitted(true);
      setMessage({ tone: "ok", text: "Thanks — this photo was reported." });
    } else {
      setMessage({ tone: "err", text: contributionErrorText(result.error) });
    }
  }

  return (
    <Modal visible={photo != null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Report photo</Text>

          <Text style={styles.label}>Reason</Text>
          <View style={styles.categories}>
            {CATEGORIES.map((c) => {
              const selected = c.value === category;
              return (
                <Pressable
                  key={c.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  disabled={pending || submitted}
                  onPress={() => setCategory(c.value)}
                  style={[styles.chip, selected ? styles.chipSelected : null]}
                >
                  <Text style={selected ? styles.chipTextSelected : styles.chipText}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            accessibilityLabel="Report note"
            value={note}
            editable={!pending && !submitted}
            maxLength={500}
            multiline
            onChangeText={setNote}
            style={styles.input}
          />

          {message ? (
            <Text
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
              style={[styles.message, message.tone === "ok" ? styles.ok : styles.err]}
            >
              {message.text}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>{submitted ? "Close" : "Cancel"}</Text>
            </Pressable>
            {!submitted ? (
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={() => {
                  void submit();
                }}
                style={[styles.primaryButton, pending ? styles.disabled : null]}
              >
                <Text style={styles.primaryText}>
                  {pending ? "Submitting…" : "Submit report"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { ...typography.heading, color: colors.brandBlue },
  label: { ...typography.meta, color: colors.textMuted, fontWeight: "700" },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipText: { ...typography.meta, color: colors.text, fontWeight: "600" },
  chipTextSelected: { ...typography.meta, color: colors.onBrand, fontWeight: "700" },
  input: {
    minHeight: 76,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    textAlignVertical: "top",
    backgroundColor: colors.surface,
  },
  message: { ...typography.meta },
  ok: { color: "#047857" },
  err: { color: colors.danger },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  secondaryText: { ...typography.body, color: colors.textMuted, fontWeight: "700" },
  primaryButton: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  disabled: { opacity: 0.6 },
  primaryText: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
});
