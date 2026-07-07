import type React from "react";
import { createContext, useContext, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "../../theme";

export type FountainDetailTabId = "info" | "details" | "photos";
export type FountainDetailTab = {
  id: FountainDetailTabId;
  label: string;
  content: React.ReactNode;
};

const TabsContext = createContext<{ setActive: (id: FountainDetailTabId) => void } | null>(null);

/** Read the enclosing tabs controller so content inside a tab body (the Info `PhotoHero`)
 *  can switch to another tab. Throws if used outside `FountainDetailTabs`. */
export function useFountainDetailTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useFountainDetailTabs must be used within FountainDetailTabs");
  return ctx;
}

export function FountainDetailTabs({
  tabs,
  refreshing,
  onRefresh,
}: {
  tabs: FountainDetailTab[];
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [active, setActive] = useState<FountainDetailTabId>(tabs[0]?.id ?? "info");

  return (
    <TabsContext.Provider value={{ setActive }}>
      <View style={styles.wrap}>
        <View style={styles.tabBar}>
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${tab.label} tab`}
                onPress={() => setActive(tab.id)}
                style={[styles.tab, selected ? styles.tabSelected : null]}
              >
                <Text style={[styles.tabLabel, selected ? styles.tabLabelSelected : null]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {/* All bodies stay mounted; inactive ones are hidden (display:none) so form input and
            scroll position survive a switch. Each body owns its own ScrollView. */}
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <ScrollView
              key={tab.id}
              style={selected ? styles.panel : styles.panelHidden}
              contentContainerStyle={styles.panelContent}
              refreshControl={
                onRefresh ? (
                  <RefreshControl
                    refreshing={Boolean(refreshing)}
                    onRefresh={onRefresh}
                    tintColor={colors.brandBlue}
                  />
                ) : undefined
              }
            >
              {tab.content}
            </ScrollView>
          );
        })}
      </View>
    </TabsContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderBottomColor: "transparent",
    borderBottomWidth: 2,
  },
  tabSelected: { borderBottomColor: colors.brandBlue },
  tabLabel: { ...typography.body, fontWeight: "700", color: colors.textMuted },
  tabLabelSelected: { color: colors.brandBlue },
  panel: { flex: 1 },
  panelHidden: { flex: 1, display: "none" },
  panelContent: { padding: spacing.md, gap: spacing.md },
});
