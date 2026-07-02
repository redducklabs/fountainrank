import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { unwrap } from "../../lib/api";
import {
  buildLeaderboardQuery,
  LEADERBOARD_SORTS,
  parseCenterParam,
  rowMetricCaption,
  rowPrimaryValue,
  SORT_LABELS,
  type ContributorRow,
  type LeaderboardOut,
  type LeaderboardScope,
  type LeaderboardSort,
  type YourStanding,
} from "../../lib/leaderboard/query";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

export default function LeaderboardScreen() {
  const { client } = useApi();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  // The Map screen passes the current center; when absent only the global board is reachable.
  const center = useMemo(() => parseCenterParam(params.lat, params.lng), [params.lat, params.lng]);
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [sort, setSort] = useState<LeaderboardSort>("total");

  const query = useQuery({
    queryKey: ["leaderboard", scope, sort, center?.lat ?? null, center?.lng ?? null],
    queryFn: async (): Promise<LeaderboardOut> =>
      unwrap(
        await client.GET("/api/v1/leaderboard/contributors", {
          params: { query: buildLeaderboardQuery(scope, sort, center) },
        }),
      ),
  });

  // Rankings change from the web app and from other contributors, so the mobile
  // board must not go stale: refetch whenever this tab regains focus, and expose
  // pull-to-refresh for a manual refresh (see #149).
  const refetch = query.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const rows = query.data?.rows ?? [];
  const you = query.data?.you ?? null;
  const youInList = rows.some((r) => r.is_you);

  return (
    <View style={styles.fill}>
      <Controls
        scope={scope}
        sort={sort}
        hasCenter={center != null}
        onScope={setScope}
        onSort={setSort}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.rank}-${r.display_name}`}
        renderItem={({ item }) => <Row row={item} sort={sort} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.brandBlue}
          />
        }
        ListEmptyComponent={
          query.isLoading ? (
            <ActivityIndicator color={colors.brandBlue} style={styles.loading} />
          ) : query.isError ? (
            <Text style={styles.empty}>Couldn&rsquo;t load the leaderboard.</Text>
          ) : (
            <Text style={styles.empty}>No contributors yet.</Text>
          )
        }
        ListFooterComponent={you && !youInList ? <YouRow you={you} sort={sort} /> : null}
      />
    </View>
  );
}

function Controls({
  scope,
  sort,
  hasCenter,
  onScope,
  onSort,
}: {
  scope: LeaderboardScope;
  sort: LeaderboardSort;
  hasCenter: boolean;
  onScope: (s: LeaderboardScope) => void;
  onSort: (s: LeaderboardSort) => void;
}) {
  return (
    <View style={styles.controls}>
      <View style={styles.segment}>
        <SegmentButton
          label="Global"
          active={scope === "global"}
          onPress={() => onScope("global")}
        />
        {hasCenter ? (
          <SegmentButton
            label="Near here"
            active={scope === "near"}
            onPress={() => onScope("near")}
          />
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {LEADERBOARD_SORTS.map((s) => (
          <Chip key={s} label={SORT_LABELS[s]} active={sort === s} onPress={() => onSort(s)} />
        ))}
      </ScrollView>
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segmentButton, active && styles.segmentButtonActive]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ row, sort }: { row: ContributorRow; sort: LeaderboardSort }) {
  return (
    <View style={[styles.row, row.is_you && styles.rowYou]}>
      <Text style={[styles.rank, row.is_you && styles.rankYou]}>{row.rank}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {row.display_name}
        {row.is_you ? "  (You)" : ""}
      </Text>
      <Metric
        value={rowPrimaryValue(row.points, row.category_count, sort)}
        caption={rowMetricCaption(row.points, sort)}
      />
    </View>
  );
}

function YouRow({ you, sort }: { you: YourStanding; sort: LeaderboardSort }) {
  const ranked = you.rank != null;
  return (
    <View style={[styles.row, styles.rowYou, styles.youPinned]}>
      <Text style={[styles.rank, styles.rankYou]}>{ranked ? you.rank : "—"}</Text>
      <Text style={styles.name}>You{ranked ? "" : "  (not yet ranked)"}</Text>
      <Metric
        value={rowPrimaryValue(you.points, you.category_count, sort)}
        caption={rowMetricCaption(you.points, sort)}
      />
    </View>
  );
}

function Metric({ value, caption }: { value: number; caption: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value.toLocaleString()}</Text>
      <Text style={styles.metricCaption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  controls: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  segment: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  segmentButton: { borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  segmentButtonActive: { backgroundColor: colors.brandBlue },
  segmentText: { ...typography.meta, color: colors.textMuted, fontWeight: "700" },
  segmentTextActive: { color: colors.onBrand },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipText: { ...typography.meta, color: colors.text },
  chipTextActive: { color: colors.onBrand },
  listContent: { paddingBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowYou: { backgroundColor: "#EAF1FF" },
  youPinned: { borderTopWidth: 2, borderTopColor: colors.brandBlue, borderBottomWidth: 0 },
  rank: {
    ...typography.body,
    fontWeight: "700",
    color: colors.textMuted,
    width: 32,
    textAlign: "right",
  },
  rankYou: { color: colors.brandBlue },
  name: { ...typography.body, fontWeight: "600", color: colors.text, flex: 1 },
  metric: { alignItems: "flex-end" },
  metricValue: { ...typography.heading, fontWeight: "800", color: colors.brandBlue },
  metricCaption: { ...typography.meta, color: colors.textMuted },
});
