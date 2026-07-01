import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { profileTabIcon } from "../../lib/auth/profile-tab-icon";
import type { MeProfile } from "../../lib/auth/profile";
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
 * Data access is a **cache-only, fetch-disabled read**: `useQuery({ queryKey: ["me"], enabled:
 * false })` still subscribes this component to the shared `["me"]` query cache and re-renders
 * when `NameGate` (mobile/app/(tabs)/_layout.tsx) populates or updates it, but never triggers a
 * fetch of its own. That matters because the root `QueryClient` has no `staleTime` - an
 * `enabled: true` observer here would refetch on every mount, and a one-shot
 * `queryClient.getQueryData` read would not react once `NameGate`'s fetch resolves.
 */
export function ProfileTabIcon({ focused }: { focused: boolean }) {
  const me = useQuery<MeProfile>({ queryKey: ["me"], enabled: false });
  const avatarUrl = me.data?.avatar_url;
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
