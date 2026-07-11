import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { apiErrorStatus, unwrap } from "../../lib/api";
import { DISPLAY_NAME_MAX, validateDisplayName } from "../../lib/auth/display-name";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

// The single "Display name" field. `required` renders the first-sign-in capture variant (heading,
// no dismiss); otherwise it is the change-name field on the account tab. Saves via PATCH /me and
// invalidates ["me"] so needs_name re-resolves and the gate clears.
export function DisplayNameForm({
  initialValue,
  required,
  onSaved,
}: {
  initialValue: string;
  required: boolean;
  onSaved?: () => void;
}) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSave = async () => {
    const v = validateDisplayName(value);
    if (!v.ok) {
      setMessage("Please enter 1–80 characters.");
      return;
    }
    setMessage(null);
    setSaving(true);
    try {
      unwrap(await client.PATCH("/api/v1/me", { body: { display_name: v.value } }));
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      onSaved?.();
    } catch (error) {
      setMessage(
        apiErrorStatus(error) === 422
          ? "Please enter 1–80 characters."
          : "Couldn't save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || value.trim().length === 0;
  return (
    <View style={styles.container}>
      {required ? (
        <View style={styles.intro}>
          <Text style={styles.title}>Choose a display name</Text>
          <Text style={styles.note}>
            Pick a name to show on the leaderboard and your notes. You can change it later.
          </Text>
        </View>
      ) : null}
      <Text style={styles.label}>Display name</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        maxLength={DISPLAY_NAME_MAX}
        placeholder="Your name"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
        editable={!saving}
        style={styles.input}
        accessibilityLabel="Display name"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: saving }}
        disabled={disabled}
        onPress={() => {
          void onSave();
        }}
        style={({ pressed }) => [
          styles.button,
          disabled ? styles.buttonDisabled : null,
          pressed && !disabled ? styles.buttonPressed : null,
        ]}
      >
        {saving ? <ActivityIndicator size="small" color={colors.brandBlue} /> : null}
        <Text style={styles.buttonText}>{saving ? "Saving…" : required ? "Continue" : "Save"}</Text>
      </Pressable>
      {message ? <Text style={styles.warning}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  intro: { gap: spacing.xs },
  title: { ...typography.heading, color: colors.text },
  note: { ...typography.body, color: colors.textMuted },
  label: { ...typography.meta, color: colors.text, fontWeight: "700" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  button: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.brandYellow,
    paddingHorizontal: spacing.lg,
  },
  buttonText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { backgroundColor: colors.brandYellowHover },
  warning: { ...typography.body, color: colors.danger },
});
