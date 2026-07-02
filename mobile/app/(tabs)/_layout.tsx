import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs, router, usePathname } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfileTabIcon } from "../../components/nav/ProfileTabIcon";
import { unwrap } from "../../lib/api";
import { shouldRouteToNameGate } from "../../lib/auth/display-name";
import { type MeProfile } from "../../lib/auth/profile";
import { shouldEnableProfileQuery, shouldRetryProfileQuery } from "../../lib/auth/state";
import { requestMapAddMode } from "../../lib/navigation/add-tab";
import { requestMapSearch } from "../../lib/navigation/map-search";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing } from "../../theme";

// Safe-area contract (spec 5.2): fixed bar content height + a bottom pad that is the larger of the
// device's real bottom inset and a floor, so Android 3-button nav (which often reports
// insets.bottom === 0) never jams the bar against the system chrome.
const BAR_CONTENT_H = 56;
const ANDROID_MIN_PAD = 8;
const TAB_INACTIVE_COLOR = "#64748B";

// Root name-gate (kill Anonymous): sign-in can start from the map, not just the account tab, so a
// mounted watcher forces the account capture screen once authenticated and still name-less. Shares
// the ["me"] query cache with the account tab, so setting a name (which invalidates ["me"]) clears
// the gate.
function NameGate() {
  const auth = useAuth();
  const { client } = useApi();
  const pathname = usePathname();
  const me = useQuery({
    queryKey: ["me"],
    enabled: shouldEnableProfileQuery(auth.status),
    retry: (failureCount, error) => shouldRetryProfileQuery(error, failureCount),
    queryFn: async (): Promise<MeProfile> => unwrap(await client.GET("/api/v1/me")),
  });
  const needsName = me.data?.needs_name ?? false;
  const onAccountRoute = pathname?.startsWith("/account") ?? false;
  useEffect(() => {
    if (shouldRouteToNameGate(auth.status, needsName, onAccountRoute)) {
      router.navigate("/account");
    }
  }, [auth.status, needsName, onAccountRoute]);
  return null;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, ANDROID_MIN_PAD);
  return (
    <>
      <NameGate />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.brandBlue,
          tabBarInactiveTintColor: TAB_INACTIVE_COLOR,
          headerShown: true,
          tabBarStyle: [
            styles.tabBar,
            { height: BAR_CONTENT_H + bottomPad, paddingBottom: bottomPad },
          ],
          tabBarLabelStyle: styles.tabBarLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Map",
            headerShown: false,
            tabBarIcon: ({ color, size }) => <Ionicons name="map" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="search"
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              router.navigate("/");
              requestMapSearch();
            },
          }}
          options={{
            title: "Search",
            tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: "Add",
            tabBarButton: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a fountain"
                onPress={() => {
                  router.navigate("/");
                  requestMapAddMode();
                }}
                style={[styles.addTabButton, { paddingBottom: bottomPad }]}
              >
                <View style={styles.addTabCircle}>
                  <Ionicons name="add" color={colors.brandBlue} size={30} />
                </View>
                <Text style={styles.addTabLabel}>Add</Text>
              </Pressable>
            ),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="add-circle" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: "Rankings",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="trophy-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: "Profile",
            tabBarIcon: ({ focused }) => <ProfileTabIcon focused={focused} />,
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    paddingTop: spacing.xs,
    borderTopColor: colors.border,
  },
  tabBarLabel: {
    fontSize: 10,
  },
  addTabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.xs,
  },
  addTabCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandYellow,
    borderColor: colors.brandBlue,
    borderWidth: 2,
    marginTop: -18,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  addTabLabel: {
    marginTop: 2,
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "700",
  },
});
