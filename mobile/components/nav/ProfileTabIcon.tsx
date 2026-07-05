import type { components } from "@fountainrank/api-client";
import { Ionicons } from "@expo/vector-icons";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { unwrap } from "../../lib/api";
import { formatBadgeCount, shouldShowBadge } from "../../lib/admin/reports";
import { profileTabIcon } from "../../lib/auth/profile-tab-icon";
import type { MeProfile } from "../../lib/auth/profile";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors } from "../../theme";

type PhotoReportsSummary = components["schemas"]["PhotoReportsSummary"];

const SUMMARY_QUERY_KEY = ["admin", "photo-reports", "summary"] as const;

const ICON_SIZE = 24;
const RING_WIDTH = 2;
const RING_SIZE = ICON_SIZE + RING_WIDTH * 2;
// Matches `tabBarInactiveTintColor` in `_layout.tsx`'s `screenOptions` - kept local since that
// value isn't (yet) exported from `theme.ts`.
const INACTIVE_COLOR = "#64748B";

/**
 * The Profile tab-bar icon: the signed-in user's avatar photo when one is available, otherwise
 * the generic `person-circle` glyph (spec section 5.3).
 *
 * Data access is a **cache-only, fetch-disabled read**: `useQuery({ queryKey: ["me"], queryFn:
 * skipToken })` still subscribes this component to the shared `["me"]` query cache and re-renders
 * when `NameGate` (mobile/app/(tabs)/_layout.tsx) populates or updates it, but never triggers a
 * fetch of its own. That matters because the root `QueryClient` has no `staleTime` - an
 * `enabled: true` observer here would refetch on every mount, and a one-shot
 * `queryClient.getQueryData` read would not react once `NameGate`'s fetch resolves. `skipToken`
 * (rather than `enabled: false`) is the official v5 idiom for a conditionally-disabled query: a
 * `queryFn` of `skipToken` forces `enabled` to `false` internally (see
 * `QueryClient.defaultQueryOptions`), so behavior is identical, but it also gives
 * `defaultedOptions.queryFn` a truthy value - `enabled: false` alone leaves `queryFn` `undefined`,
 * which trips react-query's every-render dev-mode `console.error` ("No queryFn was passed...") in
 * `useBaseQuery` since this component lives in the persistent tab bar and re-renders on every
 * navigation.
 *
 * The `avatarUrl` derivation below also gates on `auth.status`: `account.tsx`'s sign-out clears the
 * `["me"]` cache via `removeQueries`, which does not itself notify this already-mounted (disabled)
 * observer, so a stale `avatar_url` from the previous session can otherwise linger until the next
 * sign-in. Since `auth.status` flips to a non-`"authenticated"` value synchronously on sign-out,
 * gating on it (rather than on the cached data alone) avoids showing the previous user's photo on a
 * shared device.
 *
 * Admins additionally get a small pending-photo-report count badge overlaid on the
 * avatar/glyph (style guide "Pending-report badge"), fed by a `useQuery` polling
 * `GET /api/v1/admin/photo-reports/summary` every 60s under the SAME query key
 * (`["admin","photo-reports","summary"]`) the admin reports screen (M5) invalidates on
 * every moderation action, so the badge updates live without waiting for its own poll
 * tick. The query is `enabled` only for a confirmed admin (`me.data?.is_admin === true`)
 * — never fetched or polled for a non-admin viewer, avoiding 403 spam from this
 * persistent tab-bar component.
 */
export function ProfileTabIcon({ focused }: { focused: boolean }) {
  const auth = useAuth();
  const { client } = useApi();
  const me = useQuery<MeProfile>({ queryKey: ["me"], queryFn: skipToken });
  const isAdmin = me.data?.is_admin === true;
  // Admin-only, polled pending-photo-report count (style guide "Pending-report badge"):
  // never fetched/polled for a non-admin viewer, so signed-in members never 403-spam this
  // staff-only endpoint from the persistent tab bar.
  const summary = useQuery<PhotoReportsSummary>({
    queryKey: SUMMARY_QUERY_KEY,
    queryFn: async () => unwrap(await client.GET("/api/v1/admin/photo-reports/summary")),
    enabled: isAdmin,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingCount = summary.data?.pending_photo_count;
  const showBadge = isAdmin && shouldShowBadge(pendingCount);
  const avatarUrl = auth.status === "authenticated" ? me.data?.avatar_url : undefined;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageErrored = failedUrl !== null && failedUrl === avatarUrl;
  const showImage = !imageErrored && profileTabIcon(avatarUrl, focused) === "image";

  const badge = showBadge ? (
    <View style={styles.badge} accessibilityLabel={`${pendingCount} pending photo reports`}>
      <Text style={styles.badgeText} accessibilityElementsHidden importantForAccessibility="no">
        {formatBadgeCount(pendingCount as number)}
      </Text>
    </View>
  ) : null;

  if (showImage) {
    return (
      <View style={styles.wrapper}>
        <View style={[styles.ring, focused && styles.ringFocused]}>
          <Image
            source={{ uri: avatarUrl as string }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
            accessibilityLabel="Your profile photo"
            onError={() => setFailedUrl(avatarUrl ?? null)}
          />
        </View>
        {badge}
      </View>
    );
  }
  return (
    <View style={styles.wrapper}>
      <Ionicons
        name="person-circle"
        color={focused ? colors.brandBlue : INACTIVE_COLOR}
        size={ICON_SIZE}
      />
      {badge}
    </View>
  );
}

const BADGE_SIZE = 16;

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: colors.onBrand,
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  ringFocused: {
    borderWidth: RING_WIDTH,
    borderColor: colors.brandBlue,
  },
  avatar: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: colors.surface,
  },
});
