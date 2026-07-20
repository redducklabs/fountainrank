import type { components } from "@fountainrank/api-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../../components/ScreenContainer";
import { unwrap } from "../../../lib/api";
import { contributionEventLabel, signedContributionPoints } from "../../../lib/admin/contributions";
import { useApi } from "../../../providers/api-provider";
import { useAuth } from "../../../providers/auth-provider";
import { colors, spacing, typography } from "../../../theme";

type History = components["schemas"]["AdminContributorHistoryOut"];
type Event = components["schemas"]["AdminContributionEventOut"];

export default function AdminContributorHistoryScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { client } = useApi();
  const auth = useAuth();
  const meQuery = useQuery({
    queryKey: ["me"],
    enabled: auth.status === "authenticated",
    queryFn: async () => unwrap(await client.GET("/api/v1/me")),
  });
  const isAdmin = meQuery.data?.is_admin === true;
  const viewerResolved = auth.status !== "authenticated" || meQuery.isFetched || meQuery.isError;
  useEffect(() => {
    if (viewerResolved && !isAdmin) router.back();
  }, [isAdmin, viewerResolved]);

  const history = useInfiniteQuery({
    queryKey: ["admin", "contributor-history", userId],
    enabled: isAdmin && typeof userId === "string",
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<History> =>
      unwrap(
        await client.GET("/api/v1/admin/contributors/{user_id}/contributions", {
          params: { path: { user_id: userId }, query: { cursor: pageParam, limit: 50 } },
        }),
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  if (!isAdmin) return <ActivityIndicator color={colors.brandBlue} />;
  if (history.isLoading) return <ActivityIndicator color={colors.brandBlue} />;
  if (history.isError || !history.data) {
    return <Text style={styles.message}>Couldn&rsquo;t load this contribution history.</Text>;
  }
  const first = history.data.pages[0];
  const events = history.data.pages.flatMap((page) => page.events);
  return (
    <ScreenContainer includeTopInset>
      <Stack.Screen options={{ title: "Contribution history", headerShown: true }} />
      <Text style={styles.title}>{first.display_name}</Text>
      <Text style={styles.meta}>{first.stats.total_points.toLocaleString()} points</Text>
      <FlatList
        data={events}
        keyExtractor={(event) => event.id}
        renderItem={({ item }) => <EventRow event={item} />}
        ListEmptyComponent={<Text style={styles.message}>No contribution events recorded.</Text>}
        ListFooterComponent={
          history.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              disabled={history.isFetchingNextPage}
              onPress={() => void history.fetchNextPage()}
              style={styles.more}
            >
              <Text style={styles.moreText}>
                {history.isFetchingNextPage ? "Loading…" : "Load more"}
              </Text>
            </Pressable>
          ) : events.length ? (
            <Text style={styles.message}>End of history.</Text>
          ) : null
        }
      />
    </ScreenContainer>
  );
}

function EventRow({ event }: { event: Event }) {
  return (
    <View style={styles.row}>
      <View style={styles.eventText}>
        <Text style={styles.eventTitle}>{contributionEventLabel(event.event_type)}</Text>
        <Text style={styles.meta}>
          {new Date(event.created_at).toLocaleString()} · {event.status}
        </Text>
        {event.fountain_id ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/fountains/${event.fountain_id}`)}
          >
            <Text style={styles.link}>View fountain</Text>
          </Pressable>
        ) : event.target_type ? (
          <Text style={styles.meta}>Target: {event.target_type}</Text>
        ) : null}
      </View>
      <Text style={[styles.points, event.status === "reversed" && styles.reversed]}>
        {signedContributionPoints(event.points, event.status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.brandBlue, margin: spacing.md },
  meta: { ...typography.meta, color: colors.textMuted },
  message: { ...typography.body, color: colors.textMuted, margin: spacing.md, textAlign: "center" },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventText: { flex: 1 },
  eventTitle: { ...typography.body, fontWeight: "700", color: colors.text },
  points: { ...typography.heading, color: colors.brandBlue },
  reversed: { color: colors.danger },
  link: { ...typography.meta, color: colors.brandBlue, textDecorationLine: "underline" },
  more: { alignSelf: "center", margin: spacing.md, padding: spacing.sm },
  moreText: { ...typography.body, fontWeight: "700", color: colors.brandBlue },
});
