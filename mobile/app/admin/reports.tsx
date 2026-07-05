import type { components } from "@fountainrank/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { QueryStateView } from "../../components/states/QueryStateView";
import { unwrap } from "../../lib/api";
import { hideToggleLabel, isQueueEmpty, nextHiddenState } from "../../lib/admin/reports";
import { resolvePhotoUrl } from "../../lib/detail/photo-carousel";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";

type ReportedPhotoOut = components["schemas"]["ReportedPhotoOut"];
type MeResponse = components["schemas"]["MeResponse"];

const REPORTS_QUERY_KEY = ["admin", "photo-reports"] as const;
const SUMMARY_QUERY_KEY = ["admin", "photo-reports", "summary"] as const;

/** Admin photo-moderation queue (fountain-photos PR 3, task M5). Gated on `["me"]`'s
 *  `is_admin` — non-admins never see the list, since report notes are admin-only PII. */
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
  const viewerResolved =
    auth.status !== "authenticated" || meQuery.isFetched || meQuery.isError;

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
    queryFn: async (): Promise<ReportedPhotoOut[]> =>
      unwrap(await client.GET("/api/v1/admin/photo-reports")),
  });

  const invalidateAfterModeration = () => {
    void queryClient.invalidateQueries({ queryKey: REPORTS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: SUMMARY_QUERY_KEY });
  };

  const hideMutation = useMutation({
    mutationFn: async ({ photoId, isHidden }: { photoId: string; isHidden: boolean }) =>
      unwrap(
        await client.PATCH("/api/v1/admin/photos/{photo_id}", {
          params: { path: { photo_id: photoId } },
          body: { is_hidden: isHidden },
        }),
      ),
    onSuccess: invalidateAfterModeration,
    onError: () => {
      Alert.alert("Couldn't update this photo", "Please try again in a moment.");
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (photoId: string) => {
      unwrap(
        await client.POST("/api/v1/admin/photos/{photo_id}/dismiss-reports", {
          params: { path: { photo_id: photoId } },
        }),
      );
    },
    onSuccess: invalidateAfterModeration,
    onError: () => {
      Alert.alert("Couldn't reject these reports", "Please try again in a moment.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (photoId: string) => {
      unwrap(
        await client.DELETE("/api/v1/admin/photos/{photo_id}", {
          params: { path: { photo_id: photoId } },
        }),
      );
    },
    onSuccess: invalidateAfterModeration,
    onError: () => {
      Alert.alert("Couldn't delete this photo", "Please try again in a moment.");
    },
  });

  const confirmDelete = (photo: ReportedPhotoOut) => {
    Alert.alert("Delete photo?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate(photo.photo_id),
      },
    ]);
  };

  const pending = hideMutation.isPending || dismissMutation.isPending || deleteMutation.isPending;

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
      <Stack.Screen options={{ headerShown: true, title: "Reports" }} />
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
          keyExtractor={(photo) => photo.photo_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ReportRow
              photo={item}
              apiBaseUrl={config.apiBaseUrl}
              pending={pending}
              onHideToggle={() =>
                hideMutation.mutate({ photoId: item.photo_id, isHidden: nextHiddenState(item) })
              }
              onReject={() => dismissMutation.mutate(item.photo_id)}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      </QueryStateView>
    </ScreenContainer>
  );
}

function ReportRow({
  photo,
  apiBaseUrl,
  pending,
  onHideToggle,
  onReject,
  onDelete,
}: {
  photo: ReportedPhotoOut;
  apiBaseUrl: string;
  pending: boolean;
  onHideToggle: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.row}>
      <Image
        source={{ uri: resolvePhotoUrl(apiBaseUrl, photo.thumbnail_url) }}
        style={styles.thumb}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
      <View style={styles.rowBody}>
        <Text style={styles.reportCount}>
          {photo.report_count} report{photo.report_count === 1 ? "" : "s"}
          {photo.is_hidden ? " · hidden" : ""}
        </Text>
        <View style={styles.chips}>
          {photo.categories.map((category, index) => (
            <View key={`${category}-${index}`} style={styles.chip}>
              <Text style={styles.chipText}>{category}</Text>
            </View>
          ))}
        </View>
        {photo.notes.length > 0 ? (
          <View style={styles.notes}>
            {photo.notes.map((note, index) => (
              <Text key={index} style={styles.note} numberOfLines={3}>
                {note}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onHideToggle}
            style={[styles.outlineButton, pending ? styles.disabled : null]}
          >
            <Text style={styles.outlineText}>{hideToggleLabel(photo)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onReject}
            style={[styles.outlineButton, pending ? styles.disabled : null]}
          >
            <Text style={styles.outlineText}>Reject</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onDelete}
            style={[styles.dangerButton, pending ? styles.disabled : null]}
          >
            <Text style={styles.dangerText}>Delete</Text>
          </Pressable>
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
    justifyContent: "center",
    borderColor: colors.brandBlue,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  outlineText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  dangerButton: {
    minHeight: 40,
    justifyContent: "center",
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  dangerText: { ...typography.body, color: colors.danger, fontWeight: "700" },
  disabled: { opacity: 0.6 },
});
