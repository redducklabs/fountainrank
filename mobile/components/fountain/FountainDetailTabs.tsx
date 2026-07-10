import type React from "react";
import { createContext, useContext, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
        {/* All tab bodies stay mounted so in-progress form input and each tab's scroll position
            survive a switch. Each panel is wrapped in a View that is flex:1 when active and
            collapsed to height:0 (overflow hidden) when inactive — the inactive ScrollView stays
            mounted but takes no space and is clipped. NB: `display:"none"` did NOT reliably collapse
            a flex:1 ScrollView on the New Architecture (all three stacked, each clipped to 1/3), and
            an absolute-fill overlay swallowed touches on the active panel — the height:0 wrapper
            avoids both. */}
        {/* Keyboard avoidance for the text inputs on the Details tab (#4). The KAV takes over the
            `panels` flex:1 so the flex chain (wrap → panels → panelWrap → scroll) is unchanged.
            keyboardVerticalOffset starts at 0: the expo-router native stack header is a separate
            view above the KAV frame, so its origin already sits below the header. `behavior="height"`
            on Android resizes the active panel; the per-tab ScrollView then scrolls the focused
            input into view. */}
        <KeyboardAvoidingView
          style={styles.panels}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <View
                key={tab.id}
                style={selected ? styles.panelWrap : styles.panelWrapHidden}
                accessibilityElementsHidden={!selected}
                importantForAccessibility={selected ? "auto" : "no-hide-descendants"}
              >
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.panelContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
              </View>
            );
          })}
        </KeyboardAvoidingView>
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
  // The panels container fills the space below the tab bar. The active panel wrapper is flex:1;
  // inactive wrappers collapse to height 0 (content clipped but still mounted).
  panels: { flex: 1 },
  panelWrap: { flex: 1 },
  panelWrapHidden: { height: 0, overflow: "hidden" },
  scroll: { flex: 1 },
  // Horizontal insets come from the screen's ScreenContainer padding; only add vertical
  // breathing room + inter-item gap here so tab content aligns with the tab bar.
  panelContent: { paddingVertical: spacing.md, gap: spacing.md },
});
