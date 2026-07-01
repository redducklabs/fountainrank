import { Ionicons } from "@expo/vector-icons";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { profileTabIcon } from "../../lib/auth/profile-tab-icon";
import type { MeProfile } from "../../lib/auth/profile";
import { useAuth } from "../../providers/auth-provider";
import { colors } from "../../theme";

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
 */
export function ProfileTabIcon({ focused }: { focused: boolean }) {
  const auth = useAuth();
  const me = useQuery<MeProfile>({ queryKey: ["me"], queryFn: skipToken });
  const avatarUrl = auth.status === "authenticated" ? me.data?.avatar_url : undefined;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageErrored = failedUrl !== null && failedUrl === avatarUrl;
  const showImage = !imageErrored && profileTabIcon(avatarUrl, focused) === "image";

  if (showImage) {
    return (
      <View style={[styles.ring, focused && styles.ringFocused]}>
        <Image
          source={{ uri: avatarUrl as string }}
          style={styles.avatar}
          accessibilityIgnoresInvertColors
          accessibilityLabel="Your profile photo"
          onError={() => setFailedUrl(avatarUrl ?? null)}
        />
      </View>
    );
  }
  return (
    <Ionicons
      name="person-circle"
      color={focused ? colors.brandBlue : INACTIVE_COLOR}
      size={ICON_SIZE}
    />
  );
}

const styles = StyleSheet.create({
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
