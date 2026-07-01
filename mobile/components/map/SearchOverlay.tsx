// The address/city search overlay (spec §7.1/§12). Purely presentational: it
// renders the view-state produced by `lib/map-search/state.ts` and calls back
// into the screen for every effect (query edits, selecting a result, closing).
// The screen (`app/(tabs)/index.tsx`) owns the reducer, the debounce timer, the
// `AbortController`, and the `setFlyTo` recenter - this component has no
// network/state logic of its own.

import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { SearchResultItem, SearchState } from "../../lib/map-search/state";
import { colors, spacing, typography } from "../../theme";
import { EmptyState } from "../states/EmptyState";
import { ErrorState } from "../states/ErrorState";
import { LoadingState } from "../states/LoadingState";

/** Spec §12: LocationIQ's attribution ToS page. */
const ATTRIBUTION_URL = "https://locationiq.com/attribution";

export function SearchOverlay({
  state,
  topInset = 0,
  onQueryChange,
  onSelect,
  onClose,
}: {
  state: SearchState;
  /** Safe-area top inset so the input clears the status bar/notch. */
  topInset?: number;
  onQueryChange: (text: string) => void;
  onSelect: (result: SearchResultItem) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.scrim}>
      <View style={[styles.panel, { paddingTop: topInset + spacing.sm }]}>
        <View style={styles.headerRow}>
          <TextInput
            accessibilityLabel="Search address or city"
            placeholder="Search address or city"
            placeholderTextColor={colors.textMuted}
            autoFocus
            autoCorrect={false}
            value={state.query}
            onChangeText={onQueryChange}
            returnKeyType="search"
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            onPress={onClose}
            style={styles.closeButton}
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>
        <View style={styles.body}>
          <SearchBody state={state} onSelect={onSelect} />
        </View>
      </View>
    </View>
  );
}

function SearchBody({
  state,
  onSelect,
}: {
  state: SearchState;
  onSelect: (result: SearchResultItem) => void;
}) {
  switch (state.status) {
    case "idle":
      // No recent-search history in v1 (spec §7.1) - nothing to show until the
      // query reaches the minimum length.
      return null;
    case "loading":
      return <LoadingState label="Searching..." />;
    case "empty":
      return <EmptyState label="No matches" />;
    case "error":
      return <ErrorState label="Search is unavailable right now" />;
    case "results":
      return (
        <FlatList
          data={state.results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ResultRow item={item} onSelect={onSelect} />}
          ListFooterComponent={<Attribution />}
        />
      );
  }
}

function ResultRow({
  item,
  onSelect,
}: {
  item: SearchResultItem;
  onSelect: (result: SearchResultItem) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onSelect(item)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={styles.rowLabel} numberOfLines={2}>
        {item.label}
      </Text>
    </Pressable>
  );
}

/** Spec §12: persistent, tappable attribution shown whenever results render. */
function Attribution() {
  const openAttribution = () => {
    Linking.openURL(ATTRIBUTION_URL).catch(() => {
      Alert.alert("Couldn't open link", "No browser is available to open this link.");
    });
  };
  return (
    <Text style={styles.attribution}>
      <Text accessibilityRole="link" style={styles.attributionLink} onPress={openAttribution}>
        Search by LocationIQ
      </Text>
      {" · © OpenStreetMap contributors"}
    </Text>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: spacing.xl * 2,
    backgroundColor: colors.background,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontSize: 28, color: colors.textMuted },
  body: { flex: 1, marginTop: spacing.sm },
  row: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowLabel: { ...typography.body, color: colors.text },
  attribution: {
    ...typography.meta,
    color: colors.textMuted,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  attributionLink: {
    color: colors.brandBlue,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
