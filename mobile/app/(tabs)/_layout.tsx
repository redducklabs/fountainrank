import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs, router, usePathname } from "expo-router";
import { useEffect } from "react";

import { unwrap } from "../../lib/api";
import { shouldRouteToNameGate } from "../../lib/auth/display-name";
import { type MeProfile } from "../../lib/auth/profile";
import { shouldEnableProfileQuery, shouldRetryProfileQuery } from "../../lib/auth/state";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors } from "../../theme";

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
  return (
    <>
      <NameGate />
      <Tabs screenOptions={{ tabBarActiveTintColor: colors.brandBlue, headerShown: true }}>
        <Tabs.Screen
          name="index"
          options={{
            title: "Map",
            tabBarIcon: ({ color, size }) => <Ionicons name="map" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: "Add",
            href: null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="add-circle" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: "Account",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-circle" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
