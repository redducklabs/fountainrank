import type { components } from "@fountainrank/api-client";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { buildNotePayload } from "../../lib/contributions/payloads";
import { notePointsPreview } from "../../lib/contributions/points";
import type { ContributionError } from "../../lib/contributions/state";
import { contributionErrorText } from "../../lib/contributions/state";
import { colors, spacing, typography } from "../../theme";
import { ContributionMessage, PointsPreview, SubmitButton } from "./RatingContributionForm";

type AddNoteRequest = components["schemas"]["AddNoteRequest"];

export function NoteContributionForm({
  fountainId,
  initialBody = "",
  pending,
  onSubmit,
}: {
  fountainId: string;
  initialBody?: string;
  pending: boolean;
  onSubmit: (
    body: AddNoteRequest,
  ) => Promise<{ ok: true } | { ok: false; error: ContributionError }>;
}) {
  const [body, setBody] = useState(initialBody);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit() {
    setMessage(null);
    const payload = buildNotePayload(fountainId, body);
    if (!payload.ok) {
      setMessage({ tone: "err", text: "Please enter 1-1000 characters." });
      return;
    }
    const result = await onSubmit(payload.value);
    if (result.ok) {
      setMessage({ tone: "ok", text: "Your note was saved." });
    } else {
      setMessage({ tone: "err", text: contributionErrorText(result.error) });
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Your note</Text>
      <TextInput
        accessibilityLabel="Your note"
        value={body}
        editable={!pending}
        maxLength={1000}
        multiline
        onChangeText={setBody}
        style={styles.input}
      />
      <View style={styles.actions}>
        <Text style={styles.count}>{`${body.length}/1000`}</Text>
        <SubmitButton label="Save note" disabled={pending} onPress={submit} />
      </View>
      <PointsPreview lines={notePointsPreview(body.trim().length > 0)} />
      <ContributionMessage message={message} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...typography.body, fontWeight: "700", color: colors.text },
  input: {
    minHeight: 96,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    textAlignVertical: "top",
    backgroundColor: colors.background,
  },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  count: { ...typography.meta, color: colors.textMuted },
});
