import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AuthStatus } from "../../lib/auth/state";
import { contributionGate } from "../../lib/contributions/state";
import { colors, spacing, typography } from "../../theme";

export function ContributePanel({
  authStatus,
  onSignIn,
  children,
}: {
  authStatus: AuthStatus;
  onSignIn: () => Promise<void>;
  children: ReactNode;
}) {
  const gate = contributionGate(authStatus);
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Contribute</Text>
      {gate.state === "ready" ? (
        <View style={styles.forms}>{children}</View>
      ) : (
        <View style={styles.stateBox}>
          <Text style={styles.note}>{gate.message}</Text>
          {(gate.state === "sign_in" || gate.state === "reauth") && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void onSignIn();
              }}
              style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null]}
            >
              <Text style={styles.primaryButtonText}>Sign in</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  heading: { ...typography.heading, color: colors.brandBlue },
  forms: { gap: spacing.lg },
  stateBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  note: { ...typography.body, color: colors.textMuted },
  primaryButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.brandYellow,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.8 },
  primaryButtonText: { ...typography.body, fontWeight: "700", color: colors.brandBlue },
});
