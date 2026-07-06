import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ContributionError } from "../../lib/contributions/state";
import { contributionErrorText } from "../../lib/contributions/state";
import {
  REPORT_CONTENT_NOUN,
  type ReportCategoryOption,
  type ReportContentType,
} from "../../lib/detail/report";
import { colors, spacing, typography } from "../../theme";

/** The generalized content-report sheet (#11) — replaces the photo-only `ReportPhotoButton`,
 *  parameterized by `contentType` + its allowed `categories` (spec §6/§10). Opened via the
 *  per-content "Report" triggers (photo carousel, each note row, the fountain detail). A
 *  plain-props Modal (no dialog library exists in this app yet) mirroring the web
 *  `ReportContentDialog`'s category + optional note shape. The nested report endpoint is
 *  idempotent server-side (design §7), so — unlike a dedup-tracking web dialog — a duplicate
 *  pending report from the same reporter is silently accepted (204) and shown as success.
 *  The caller should remount this per target (e.g. `key={contentType:contentId}`) so the
 *  local form state resets between reports. */
export function ReportContentButton({
  contentType,
  categories,
  visible,
  pending,
  onSubmit,
  onClose,
}: {
  contentType: ReportContentType;
  categories: readonly ReportCategoryOption[];
  visible: boolean;
  pending: boolean;
  onSubmit: (
    category: string,
    note: string | undefined,
  ) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
  onClose: () => void;
}) {
  const noun = REPORT_CONTENT_NOUN[contentType];
  const [category, setCategory] = useState<string>(categories[0]?.value ?? "");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    const result = await onSubmit(category, note.trim() || undefined);
    if (result.ok) {
      setSubmitted(true);
      setMessage({ tone: "ok", text: `Thanks — this ${noun} was reported.` });
    } else {
      setMessage({ tone: "err", text: contributionErrorText(result.error) });
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{`Report ${noun}`}</Text>

          <Text style={styles.label}>Reason</Text>
          <View style={styles.categories}>
            {categories.map((c) => {
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
                <Text style={styles.primaryText}>{pending ? "Submitting…" : "Submit report"}</Text>
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
