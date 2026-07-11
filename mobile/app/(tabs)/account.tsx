import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { DisplayNameForm } from "../../components/account/DisplayNameForm";
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
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
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
    setIsSigningOut(true);
    try {
      clearProfile();
      await auth.signOut();
      clearProfile();
    } finally {
      setIsSigningOut(false);
    }
  };

  const onDeleteAccount = async () => {
    setMessage(null);
    Alert.alert(
      "Delete account?",
      "This permanently deletes your FountainRank account, profile, notes, and photos. Fountain ratings and fountain details you contributed will stay on the public map without your account attached.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setIsDeletingAccount(true);
              try {
                const { response } = await client.DELETE("/api/v1/me");
                if (response.status === 401) {
                  auth.markReauthRequired();
                  setMessage("Your session expired. Please sign in again.");
                  return;
                }
                if (!response.ok) {
                  setMessage("Account deletion did not complete. Please try again.");
                  return;
                }
                // Only once the account is actually gone: on a failed delete the signed-in
                // profile is still valid and must not be evicted.
                queryClient.clear();
                try {
                  await auth.signOut();
                } catch {
                  auth.markReauthRequired();
                  setMessage("Account deleted. Please sign in again before continuing.");
                }
              } catch {
                setMessage("Account deletion did not complete. Please try again.");
              } finally {
                setIsDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.body}>
        <Text style={styles.title}>Profile</Text>
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
            onDeleteAccount={onDeleteAccount}
            isDeletingAccount={isDeletingAccount}
            isSigningOut={isSigningOut}
            message={message}
          />
        ) : (
          <SignedOut
            status={auth.status}
            message={message}
            onSignIn={onSignIn}
            onSignOut={auth.status === "reauthRequired" ? onSignOut : undefined}
            isSigningOut={isSigningOut}
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
  isSigningOut,
}: {
  status: string;
  message: string | null;
  onSignIn: () => Promise<void>;
  onSignOut?: () => Promise<void>;
  isSigningOut: boolean;
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
        pending={pending}
        onPress={onSignIn}
      />
      {onSignOut ? (
        <SecondaryButton
          label="Clear session"
          disabled={isSigningOut}
          pending={isSigningOut}
          onPress={onSignOut}
        />
      ) : null}
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
  onDeleteAccount,
  isDeletingAccount,
  isSigningOut,
  message,
}: {
  profile: MeProfile | null;
  contributions: MeContributionsOut | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  isDeletingAccount: boolean;
  isSigningOut: boolean;
  message: string | null;
}) {
  if (isLoading) {
    return <InlineLoading label="Loading profile..." />;
  }
  if (isError || !profile) {
    return (
      <View style={styles.section}>
        <Text style={styles.note}>Could not load your profile.</Text>
        <SecondaryButton label="Retry" onPress={async () => onRetry()} />
        <SecondaryButton
          label="Sign out"
          disabled={isSigningOut}
          pending={isSigningOut}
          onPress={onSignOut}
        />
      </View>
    );
  }
  // First-sign-in gate: when the account still resolves to "Anonymous", require a name before
  // showing the profile. The raw subject never reaches here (the API sends display_name="").
  if (profile.needs_name) {
    return (
      <View style={styles.section}>
        <DisplayNameForm initialValue="" required />
        {message ? <Text style={styles.warning}>{message}</Text> : null}
        <SecondaryButton
          label="Sign out"
          disabled={isSigningOut}
          pending={isSigningOut}
          onPress={onSignOut}
        />
        <DestructiveButton
          label={isDeletingAccount ? "Deleting account..." : "Delete account"}
          disabled={isDeletingAccount}
          pending={isDeletingAccount}
          onPress={onDeleteAccount}
        />
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
            accessibilityLabel={`Profile initial ${profileInitial(profile.display_name)}`}
          >
            <Text style={styles.avatarText}>{profileInitial(profile.display_name)}</Text>
          </View>
        )}
        <View style={styles.profileText}>
          <Text style={styles.name}>{profile.display_name}</Text>
          {email ? <Text style={styles.note}>{email}</Text> : null}
          {profile.is_admin ? <Text style={styles.meta}>Admin</Text> : null}
          {profile.is_admin ? (
            <Link href="/admin/reports" style={styles.link}>
              Reports
            </Link>
          ) : null}
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
      <DisplayNameForm initialValue={profile.display_name} required={false} />
      {message ? <Text style={styles.warning}>{message}</Text> : null}
      <SecondaryButton label="Sign out" onPress={onSignOut} />
      <DestructiveButton
        label={isDeletingAccount ? "Deleting account..." : "Delete account"}
        disabled={isDeletingAccount}
        onPress={onDeleteAccount}
      />
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
  pending = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: pending }}
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
      {pending ? <ActivityIndicator size="small" color={colors.brandBlue} /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  disabled,
  pending = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: pending }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryButton,
        disabled ? styles.disabledButton : null,
        pressed && !disabled ? styles.pressedSecondaryButton : null,
      ]}
    >
      {pending ? <ActivityIndicator size="small" color={colors.brandBlue} /> : null}
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function DestructiveButton({
  label,
  disabled,
  pending = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: pending }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.destructiveButton,
        disabled ? styles.disabledButton : null,
        pressed && !disabled ? styles.pressedDestructiveButton : null,
      ]}
    >
      {pending ? <ActivityIndicator size="small" color={colors.danger} /> : null}
      <Text style={styles.destructiveButtonText}>{label}</Text>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.brandYellow,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  secondaryButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
  destructiveButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
  },
  destructiveButtonText: { ...typography.body, color: colors.danger, fontWeight: "700" },
  disabledButton: { opacity: 0.55 },
  pressedButton: { backgroundColor: colors.brandYellowHover },
  pressedSecondaryButton: { backgroundColor: colors.surface },
  pressedDestructiveButton: { backgroundColor: "#FEF2F2" },
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
