import type { components } from "@fountainrank/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { QueryStateView } from "../../components/states/QueryStateView";
import { unwrap } from "../../lib/api";
import {
  contentSupportsDelete,
  hideToggleLabel,
  isQueueEmpty,
  nextHiddenState,
} from "../../lib/admin/reports";
import { resolvePhotoUrl } from "../../lib/detail/photo-carousel";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";

type ReportedContentOut = components["schemas"]["ReportedContentOut"];
type MeResponse = components["schemas"]["MeResponse"];

// SAME keys the ProfileTabIcon badge polls, so a moderation action here refreshes the badge live.
const REPORTS_QUERY_KEY = ["admin", "reports"] as const;
const SUMMARY_QUERY_KEY = ["admin", "reports", "summary"] as const;

/** Admin unified moderation queue (#12): photo, note, and fountain reports in one list, each
 *  with its per-type actions. Gated on `["me"]`'s `is_admin` — non-admins never see the list,
 *  since report notes are admin-only PII. */
export default function AdminReportsScreen() {
  const { client, config } = useApi();
  const auth = useAuth();
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    enabled: auth.status === "authenticated",
    queryFn: async (): Promise<MeResponse> => unwrap(await client.GET("/api/v1/me")),
  });
  const isAdmin = meQuery.data?.is_admin === true;
  const viewerResolved = auth.status !== "authenticated" || meQuery.isFetched || meQuery.isError;

  // Never render the queue for a resolved non-admin viewer (it carries admin-only report
  // notes) — bounce back to wherever the admin link was pushed from.
  useEffect(() => {
    if (viewerResolved && !isAdmin) {
      router.back();
    }
  }, [isAdmin, viewerResolved]);

  const reportsQuery = useQuery({
    queryKey: REPORTS_QUERY_KEY,
    enabled: isAdmin,
    queryFn: async (): Promise<ReportedContentOut[]> =>
      unwrap(await client.GET("/api/v1/admin/reports")),
  });

  const invalidateAfterModeration = () => {
    void queryClient.invalidateQueries({ queryKey: REPORTS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: SUMMARY_QUERY_KEY });
  };

  const hideMutation = useMutation({
    mutationFn: async (item: ReportedContentOut) => {
      const is_hidden = nextHiddenState(item);
      if (item.content_type === "photo") {
        return unwrap(
          await client.PATCH("/api/v1/admin/photos/{photo_id}", {
            params: { path: { photo_id: item.content_id } },
            body: { is_hidden },
          }),
        );
      }
      if (item.content_type === "note") {
        return unwrap(
          await client.PATCH("/api/v1/admin/notes/{note_id}", {
            params: { path: { note_id: item.content_id } },
            body: { is_hidden },
          }),
        );
      }
      return unwrap(
        await client.PATCH("/api/v1/admin/fountains/{fountain_id}", {
          params: { path: { fountain_id: item.content_id } },
          body: { is_hidden },
        }),
      );
    },
    onSuccess: invalidateAfterModeration,
    onError: () => {
      Alert.alert("Couldn't update this item", "Please try again in a moment.");
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (item: ReportedContentOut) => {
      unwrap(
        await client.POST("/api/v1/admin/reports/dismiss", {
          body: { content_type: item.content_type, content_id: item.content_id },
        }),
      );
    },
    onSuccess: invalidateAfterModeration,
    onError: () => {
      Alert.alert("Couldn't reject these reports", "Please try again in a moment.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: ReportedContentOut) => {
      if (item.content_type === "photo") {
        unwrap(
          await client.DELETE("/api/v1/admin/photos/{photo_id}", {
            params: { path: { photo_id: item.content_id } },
          }),
        );
      } else {
        unwrap(
          await client.DELETE("/api/v1/admin/fountains/{fountain_id}", {
            params: { path: { fountain_id: item.content_id } },
          }),
        );
      }
    },
    onSuccess: invalidateAfterModeration,
    onError: () => {
      Alert.alert("Couldn't delete this item", "Please try again in a moment.");
    },
  });

  const confirmDelete = (item: ReportedContentOut) => {
    const title = item.content_type === "fountain" ? "Delete fountain?" : "Delete photo?";
    Alert.alert(title, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate(item),
      },
    ]);
  };

  const pending = hideMutation.isPending || dismissMutation.isPending || deleteMutation.isPending;
  // The mutations are screen-level (they disable every row's buttons while any one runs), so drive
  // the spinner off the acted item + action — otherwise every button in the list would spin (#212).
  const itemKey = (i: ReportedContentOut) => `${i.content_type}:${i.content_id}`;
  const hidingKey =
    hideMutation.isPending && hideMutation.variables ? itemKey(hideMutation.variables) : null;
  const rejectingKey =
    dismissMutation.isPending && dismissMutation.variables
      ? itemKey(dismissMutation.variables)
      : null;
  const deletingKey =
    deleteMutation.isPending && deleteMutation.variables ? itemKey(deleteMutation.variables) : null;

  if (viewerResolved && !isAdmin) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: true, title: "Reports" }} />
        <View style={styles.centered}>
          <Text style={styles.notAuthorized}>Not authorized.</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Moderation queue" }} />
      <QueryStateView
        input={{
          isLoading: !viewerResolved || meQuery.isLoading || reportsQuery.isLoading,
          isError: reportsQuery.isError,
          error: reportsQuery.error,
          isEmpty: isQueueEmpty(reportsQuery.data),
        }}
        emptyLabel="No pending reports."
        onRetry={() => void reportsQuery.refetch()}
      >
        <FlatList
          data={reportsQuery.data ?? []}
          keyExtractor={(item) => `${item.content_type}:${item.content_id}`}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ReportRow
              item={item}
              apiBaseUrl={config.apiBaseUrl}
              pending={pending}
              hidePending={hidingKey === itemKey(item)}
              rejectPending={rejectingKey === itemKey(item)}
              deletePending={deletingKey === itemKey(item)}
              onHideToggle={() => hideMutation.mutate(item)}
              onReject={() => dismissMutation.mutate(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      </QueryStateView>
    </ScreenContainer>
  );
}

function ReportRow({
  item,
  apiBaseUrl,
  pending,
  hidePending,
  rejectPending,
  deletePending,
  onHideToggle,
  onReject,
  onDelete,
}: {
  item: ReportedContentOut;
  apiBaseUrl: string;
  pending: boolean;
  hidePending: boolean;
  rejectPending: boolean;
  deletePending: boolean;
  onHideToggle: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const showDelete = contentSupportsDelete(item.content_type);
  return (
    <View style={styles.row}>
      {item.content_type === "photo" && item.thumbnail_url ? (
        <Image
          source={{ uri: resolvePhotoUrl(apiBaseUrl, item.thumbnail_url) }}
          style={styles.thumb}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.rowBody}>
        {item.content_type === "note" ? (
          <>
            <Text style={styles.title} numberOfLines={2}>
              {item.excerpt}
            </Text>
            {item.contributor ? <Text style={styles.byline}>by {item.contributor}</Text> : null}
          </>
        ) : null}
        {item.content_type === "fountain" ? (
          <Text style={styles.title} numberOfLines={1}>
            {item.fountain_label ?? "Fountain"}
          </Text>
        ) : null}
        <Text style={styles.reportCount}>
          {item.report_count} report{item.report_count === 1 ? "" : "s"}
          {item.is_hidden ? " · hidden" : ""}
        </Text>
        <View style={styles.chips}>
          {item.categories.map((category, index) => (
            <View key={`${category}-${index}`} style={styles.chip}>
              <Text style={styles.chipText}>{category}</Text>
            </View>
          ))}
        </View>
        {item.notes.length > 0 ? (
          <View style={styles.notes}>
            {item.notes.map((note, index) => (
              <Text key={index} style={styles.note} numberOfLines={3}>
                {note}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending, busy: hidePending }}
            disabled={pending}
            onPress={onHideToggle}
            style={[styles.outlineButton, pending ? styles.disabled : null]}
          >
            {hidePending ? <ActivityIndicator size="small" color={colors.brandBlue} /> : null}
            <Text style={styles.outlineText}>{hideToggleLabel(item)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending, busy: rejectPending }}
            disabled={pending}
            onPress={onReject}
            style={[styles.outlineButton, pending ? styles.disabled : null]}
          >
            {rejectPending ? <ActivityIndicator size="small" color={colors.brandBlue} /> : null}
            <Text style={styles.outlineText}>Reject</Text>
          </Pressable>
          {showDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending, busy: deletePending }}
              disabled={pending}
              onPress={onDelete}
              style={[styles.dangerButton, pending ? styles.disabled : null]}
            >
              {deletePending ? <ActivityIndicator size="small" color={colors.danger} /> : null}
              <Text style={styles.dangerText}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  notAuthorized: { ...typography.body, color: colors.textMuted },
  list: { gap: spacing.md, paddingBottom: spacing.lg },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  thumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: colors.border },
  rowBody: { flex: 1, gap: spacing.xs },
  title: { ...typography.body, color: colors.text, fontWeight: "700" },
  byline: { ...typography.meta, color: colors.textMuted },
  reportCount: { ...typography.body, color: colors.text, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { ...typography.meta, color: colors.textMuted, fontWeight: "600" },
  notes: { gap: 2 },
  note: { ...typography.meta, color: colors.textMuted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  outlineButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderColor: colors.brandBlue,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  outlineText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  dangerButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  dangerText: { ...typography.body, color: colors.danger, fontWeight: "700" },
  disabled: { opacity: 0.6 },
});
