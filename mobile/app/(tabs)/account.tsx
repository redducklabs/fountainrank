import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { apiErrorStatus, unwrap } from "../../lib/api";
import { displayEmail, profileInitial, type MeProfile } from "../../lib/auth/profile";
import {
  isAuthSessionError,
  shouldEnableProfileQuery,
  shouldRetryProfileQuery,
} from "../../lib/auth/state";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";
import type { components } from "@fountainrank/api-client";

const PROFILE_QUERY_KEY = ["me"] as const;
type MeContributionsOut = components["schemas"]["MeContributionsOut"];

export default function AccountScreen() {
  const { client } = useApi();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    enabled: shouldEnableProfileQuery(auth.status),
    retry: (failureCount, error) => shouldRetryProfileQuery(error, failureCount),
    queryFn: async () => unwrap(await client.GET("/api/v1/me")),
  });
  const contributionsQuery = useQuery({
    queryKey: ["me", "contributions"],
    enabled: shouldEnableProfileQuery(auth.status),
    retry: (failureCount, error) => shouldRetryProfileQuery(error, failureCount),
    queryFn: async (): Promise<MeContributionsOut> =>
      unwrap(await client.GET("/api/v1/me/contributions")),
  });

  const clearProfile = useCallback(() => {
    queryClient.removeQueries({ queryKey: PROFILE_QUERY_KEY });
  }, [queryClient]);

  useEffect(() => {
    const error = profileQuery.error;
    if (apiErrorStatus(error) === 401 || isAuthSessionError(error)) {
      clearProfile();
      auth.markReauthRequired();
    }
  }, [auth, clearProfile, profileQuery.error]);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      clearProfile();
    }
  }, [auth.status, clearProfile]);

  const onSignIn = async () => {
    setMessage(null);
    clearProfile();
    const result = await auth.signIn();
    if (result.status === "success") {
      clearProfile();
    }
    if (result.status === "cancelled") {
      setMessage("Sign-in was cancelled.");
    } else if (result.status === "error") {
      setMessage("Sign-in did not complete. Please try again.");
    }
  };

  const onSignOut = async () => {
    setMessage(null);
    clearProfile();
    await auth.signOut();
    clearProfile();
  };

  return (
    <ScreenContainer>
      <View style={styles.body}>
        <Text style={styles.title}>Account</Text>
        {auth.status === "unconfigured" ? (
          <Text style={styles.note}>
            Browsing FountainRank in public mode. Sign-in is not yet available in this build; rating
            and adding fountains arrive in a later release.
          </Text>
        ) : auth.status === "initializing" ? (
          <InlineLoading label="Checking account..." />
        ) : auth.status === "authenticated" ? (
          <SignedInProfile
            profile={(profileQuery.data as MeProfile | undefined) ?? null}
            contributions={contributionsQuery.data ?? null}
            isLoading={profileQuery.isLoading}
            isError={profileQuery.isError}
            onRetry={() => profileQuery.refetch()}
            onSignOut={onSignOut}
          />
        ) : (
          <SignedOut
            status={auth.status}
            message={message}
            onSignIn={onSignIn}
            onSignOut={auth.status === "reauthRequired" ? onSignOut : undefined}
          />
        )}
        <Link href="/diagnostics" style={styles.link}>
          Diagnostics
        </Link>
      </View>
    </ScreenContainer>
  );
}

function SignedOut({
  status,
  message,
  onSignIn,
  onSignOut,
}: {
  status: string;
  message: string | null;
  onSignIn: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}) {
  const pending = status === "signingIn";
  return (
    <View style={styles.section}>
      {status === "reauthRequired" ? (
        <Text style={styles.note}>Your session expired. Sign in again to continue.</Text>
      ) : (
        <Text style={styles.note}>Sign in to rate fountains and add new ones.</Text>
      )}
      {message ? <Text style={styles.warning}>{message}</Text> : null}
      <PrimaryButton
        label={pending ? "Opening sign-in..." : "Sign in"}
        disabled={pending}
        onPress={onSignIn}
      />
      {onSignOut ? <SecondaryButton label="Clear session" onPress={onSignOut} /> : null}
    </View>
  );
}

function SignedInProfile({
  profile,
  contributions,
  isLoading,
  isError,
  onRetry,
  onSignOut,
}: {
  profile: MeProfile | null;
  contributions: MeContributionsOut | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  if (isLoading) {
    return <InlineLoading label="Loading profile..." />;
  }
  if (isError || !profile) {
    return (
      <View style={styles.section}>
        <Text style={styles.note}>Could not load your profile.</Text>
        <SecondaryButton label="Retry" onPress={async () => onRetry()} />
        <SecondaryButton label="Sign out" onPress={onSignOut} />
      </View>
    );
  }
  const email = displayEmail(profile.email);
  return (
    <View style={styles.section}>
      <View style={styles.profileRow}>
        {profile.avatar_url ? (
          <Image
            source={{ uri: profile.avatar_url }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            style={styles.avatarFallback}
            accessible
            accessibilityLabel={`Account initial ${profileInitial(profile.display_name)}`}
          >
            <Text style={styles.avatarText}>{profileInitial(profile.display_name)}</Text>
          </View>
        )}
        <View style={styles.profileText}>
          <Text style={styles.name}>{profile.display_name}</Text>
          {email ? <Text style={styles.note}>{email}</Text> : null}
          {profile.is_admin ? <Text style={styles.meta}>Admin</Text> : null}
        </View>
      </View>
      {contributions ? (
        <View style={styles.pointsBox}>
          <Text style={styles.pointsTotal}>{`${contributions.stats.total_points} points`}</Text>
          <Text style={styles.meta}>
            {`${contributions.stats.fountains_added} fountains · ${contributions.stats.ratings_count} ratings · ${contributions.stats.notes_count} comments`}
          </Text>
        </View>
      ) : null}
      <SecondaryButton label="Sign out" onPress={onSignOut} />
    </View>
  );
}

function InlineLoading({ label }: { label: string }) {
  return (
    <View style={styles.inline}>
      <ActivityIndicator color={colors.brandBlue} />
      <Text style={styles.note}>{label}</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled ? styles.disabledButton : null,
        pressed && !disabled ? styles.pressedButton : null,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => Promise<void> }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed ? styles.pressedSecondaryButton : null,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.md },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
  warning: { ...typography.body, color: colors.danger },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
  section: { gap: spacing.md },
  inline: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.brandYellow,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
  disabledButton: { opacity: 0.55 },
  pressedButton: { backgroundColor: colors.brandYellowHover },
  pressedSecondaryButton: { backgroundColor: colors.surface },
  profileRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
  },
  avatarText: { color: colors.onBrand, fontSize: 24, fontWeight: "700" },
  profileText: { flex: 1, minWidth: 0, gap: spacing.xs },
  name: { ...typography.heading, color: colors.text },
  meta: { ...typography.meta, color: colors.brandBlue, fontWeight: "700" },
  pointsBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pointsTotal: { ...typography.heading, color: colors.brandBlue },
});
