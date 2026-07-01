import type { components } from "@fountainrank/api-client";
import { CONTRIBUTION_POINTS } from "@fountainrank/contributions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AttributeContributionForm } from "../../components/fountain/AttributeContributionForm";
import { WaterCelebration } from "../../components/feedback/WaterCelebration";
import { ConditionContributionForm } from "../../components/fountain/ConditionContributionForm";
import { ContributePanel } from "../../components/fountain/ContributePanel";
import { FountainDetail } from "../../components/fountain/FountainDetail";
import { NoteContributionForm } from "../../components/fountain/NoteContributionForm";
import { RatingContributionForm } from "../../components/fountain/RatingContributionForm";
import { ScreenContainer } from "../../components/ScreenContainer";
import { QueryStateView } from "../../components/states/QueryStateView";
import { apiErrorStatus, unwrap } from "../../lib/api";
import type { ContributionError } from "../../lib/contributions/state";
import { mapContributionError } from "../../lib/contributions/state";
import { normalizeFountainId } from "../../lib/detail/id";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];
type AdminFountainDetail = components["schemas"]["AdminFountainDetail"];
type AdminFountainPatch = components["schemas"]["AdminFountainPatch"];
type AdminNoteOut = components["schemas"]["AdminNoteOut"];
type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RateRequest = components["schemas"]["RateRequest"];
type ConditionReportRequest = components["schemas"]["ConditionReportRequest"];
type ObserveAttributesRequest = components["schemas"]["ObserveAttributesRequest"];
type AddNoteRequest = components["schemas"]["AddNoteRequest"];
type MeResponse = components["schemas"]["MeResponse"];
type SubmitResult = { ok: true } | { ok: false; error: ContributionError };

function NotFound({ note }: { note: string }) {
  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <View style={styles.centered}>
        <Text style={styles.notFoundTitle}>Fountain not found</Text>
        <Text style={styles.notFoundNote}>{note}</Text>
      </View>
    </ScreenContainer>
  );
}

export default function FountainDetailScreen() {
  const { client } = useApi();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | null>(null);
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  // Reject absent/array/malformed (non-UUID) ids client-side — the backend route
  // param is a uuid.UUID, so a bad value would 422; show the honest not-found state.
  const fountainId = normalizeFountainId(id);
  const now = new Date();

  // Key on auth: the detail GET is enriched with the caller's own rating only when the
  // request carries a token (#65), so anonymous and authenticated reads are distinct cache
  // entries — signing in (or auth settling after the first fetch) re-fetches the enriched
  // detail instead of serving the cached anonymous one.
  const viewerQuery = useQuery({
    queryKey: ["me"],
    enabled: fountainId != null && auth.status === "authenticated",
    queryFn: async (): Promise<MeResponse> => unwrap(await client.GET("/api/v1/me")),
  });
  const viewerResolved =
    auth.status !== "authenticated" || viewerQuery.isFetched || viewerQuery.isError;
  const isAdmin = viewerQuery.data?.is_admin === true;
  const detailQuery = useQuery({
    queryKey: [
      "fountain",
      fountainId,
      auth.status === "authenticated",
      isAdmin ? "admin" : "public",
    ],
    enabled: fountainId != null && viewerResolved,
    queryFn: async (): Promise<FountainDetailT | AdminFountainDetail> => {
      if (fountainId == null) throw new Error("missing fountain id");
      if (isAdmin) {
        return unwrap(
          await client.GET("/api/v1/admin/fountains/{fountain_id}", {
            params: { path: { fountain_id: fountainId } },
          }),
        );
      }
      return unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}", {
          params: { path: { fountain_id: fountainId } },
        }),
      );
    },
  });

  const notesQuery = useQuery({
    queryKey: ["fountain", fountainId, "notes"],
    enabled: fountainId != null && !isAdmin,
    queryFn: async (): Promise<NoteOut[]> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}/notes", {
          params: { path: { fountain_id: fountainId } },
        }),
      );
    },
  });

  const adminDetail =
    isAdmin && detailQuery.data && "is_hidden" in detailQuery.data ? detailQuery.data : null;

  const attributeTypesQuery = useQuery({
    queryKey: ["attribute-types"],
    enabled: fountainId != null && auth.status === "authenticated" && showMoreDetails,
    queryFn: async (): Promise<AttributeTypeOut[]> =>
      unwrap(await client.GET("/api/v1/attribute-types")),
  });

  const refreshDetailAfterWrite = (detail?: FountainDetailT, points?: number) => {
    if (fountainId == null) return;
    if (detail) {
      queryClient.setQueryData(
        ["fountain", fountainId, auth.status === "authenticated", isAdmin ? "admin" : "public"],
        detail,
      );
    } else {
      void detailQuery.refetch();
    }
    void queryClient.invalidateQueries({ queryKey: ["fountains", "bbox"] });
    void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
    setCelebrationPoints(points ?? null);
    setCelebrationKey((key) => key + 1);
  };

  const refreshAdminAfterWrite = () => {
    if (fountainId == null) return;
    void queryClient.invalidateQueries({ queryKey: ["fountain", fountainId] });
    void queryClient.invalidateQueries({ queryKey: ["fountain", fountainId, "notes"] });
    void queryClient.invalidateQueries({ queryKey: ["fountains", "bbox"] });
  };

  const handleMutationError = (error: unknown): SubmitResult => {
    const mapped = mapContributionError(error);
    if (mapped === "unauthenticated") {
      auth.markReauthRequired();
    }
    if (mapped === "needs_name") {
      // The name gate (kill Anonymous): send the user to the account capture screen to set a name.
      router.navigate("/account");
    }
    return { ok: false, error: mapped };
  };

  const ratingMutation = useMutation({
    mutationFn: async (body: RateRequest): Promise<FountainDetailT> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/ratings", {
          params: { path: { fountain_id: fountainId } },
          body,
        }),
      );
    },
    onSuccess: (detail, body) =>
      refreshDetailAfterWrite(detail, body.ratings.length * CONTRIBUTION_POINTS.rate),
  });

  const conditionMutation = useMutation({
    mutationFn: async (body: ConditionReportRequest): Promise<FountainDetailT> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/conditions", {
          params: { path: { fountain_id: fountainId } },
          body,
        }),
      );
    },
    onSuccess: (detail, body) =>
      refreshDetailAfterWrite(
        detail,
        body.status === "working"
          ? CONTRIBUTION_POINTS.verify_working
          : CONTRIBUTION_POINTS.report_condition,
      ),
  });

  const attributeMutation = useMutation({
    mutationFn: async (body: ObserveAttributesRequest): Promise<FountainDetailT> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/attributes", {
          params: { path: { fountain_id: fountainId } },
          body,
        }),
      );
    },
    onSuccess: (detail, body) =>
      refreshDetailAfterWrite(
        detail,
        body.observations.length * CONTRIBUTION_POINTS.observe_attribute,
      ),
  });

  const noteMutation = useMutation({
    mutationFn: async (body: AddNoteRequest): Promise<NoteOut> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/notes", {
          params: { path: { fountain_id: fountainId } },
          body,
        }),
      );
    },
    onSuccess: () => {
      void notesQuery.refetch();
      void detailQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
      setCelebrationPoints(CONTRIBUTION_POINTS.add_note);
      setCelebrationKey((key) => key + 1);
    },
  });

  const adminUpdateMutation = useMutation({
    mutationFn: async (body: AdminFountainPatch): Promise<AdminFountainDetail> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.PATCH("/api/v1/admin/fountains/{fountain_id}", {
          params: { path: { fountain_id: fountainId } },
          body,
        }),
      );
    },
    onSuccess: refreshAdminAfterWrite,
  });

  const adminDeleteMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (fountainId == null) throw new Error("missing fountain id");
      unwrap(
        await client.DELETE("/api/v1/admin/fountains/{fountain_id}", {
          params: { path: { fountain_id: fountainId } },
        }),
      );
    },
    onSuccess: refreshAdminAfterWrite,
  });

  const adminNoteMutation = useMutation({
    mutationFn: async ({
      noteId,
      isHidden,
    }: {
      noteId: string;
      isHidden: boolean;
    }): Promise<AdminNoteOut> =>
      unwrap(
        await client.PATCH("/api/v1/admin/notes/{note_id}", {
          params: { path: { note_id: noteId } },
          body: { is_hidden: isHidden },
        }),
      ),
    onSuccess: refreshAdminAfterWrite,
  });

  const refetchAll = () => {
    void detailQuery.refetch();
    void notesQuery.refetch();
    void viewerQuery.refetch();
  };

  // Invalid route id (bad deep link / unexpected param) — honest, non-retryable.
  if (fountainId == null) {
    return <NotFound note="This link doesn't reference a fountain." />;
  }
  // A 404 means "no such fountain" — honest, non-retryable (not a transient error).
  if (apiErrorStatus(detailQuery.error) === 404) {
    return <NotFound note="This fountain may have been removed." />;
  }
  const displayNotes = adminDetail?.notes ?? notesQuery.data ?? [];

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <QueryStateView
        input={{
          isLoading: viewerQuery.isLoading || detailQuery.isLoading,
          isError: detailQuery.isError,
          error: detailQuery.error,
        }}
        onRetry={refetchAll}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={detailQuery.isRefetching || notesQuery.isRefetching}
              onRefresh={refetchAll}
              tintColor={colors.brandBlue}
            />
          }
        >
          {detailQuery.data ? (
            <FountainDetail
              detail={detailQuery.data}
              notes={displayNotes}
              notesError={notesQuery.isError}
              onRetryNotes={() => void notesQuery.refetch()}
              adminControls={
                adminDetail ? (
                  <AdminControls
                    detail={adminDetail}
                    pending={
                      adminUpdateMutation.isPending ||
                      adminDeleteMutation.isPending ||
                      adminNoteMutation.isPending
                    }
                    onUpdate={async (patch) => {
                      await adminUpdateMutation.mutateAsync(patch);
                    }}
                    onDelete={async () => {
                      await adminDeleteMutation.mutateAsync();
                    }}
                    onSetNoteHidden={async (noteId, isHidden) => {
                      await adminNoteMutation.mutateAsync({ noteId, isHidden });
                    }}
                  />
                ) : undefined
              }
              contribution={
                <ContributePanel
                  authStatus={auth.status}
                  onSignIn={async () => {
                    await auth.signIn();
                  }}
                >
                  <RatingContributionForm
                    fountainId={fountainId}
                    dimensions={detailQuery.data.dimensions}
                    pending={ratingMutation.isPending}
                    onSubmit={async (body) => {
                      try {
                        await ratingMutation.mutateAsync(body);
                        return { ok: true };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                  <ConditionContributionForm
                    fountainId={fountainId}
                    pending={conditionMutation.isPending}
                    onSubmit={async (body) => {
                      try {
                        await conditionMutation.mutateAsync(body);
                        return { ok: true };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                  <NoteContributionForm
                    fountainId={fountainId}
                    pending={noteMutation.isPending}
                    onSubmit={async (body) => {
                      try {
                        await noteMutation.mutateAsync(body);
                        return { ok: true };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShowMoreDetails((current) => !current)}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {showMoreDetails ? "Hide More Details" : "More Details"}
                    </Text>
                  </Pressable>
                  {showMoreDetails ? (
                    <AttributeContributionForm
                      fountainId={fountainId}
                      attributeTypes={attributeTypesQuery.data ?? []}
                      pending={attributeMutation.isPending}
                      isLoading={attributeTypesQuery.isLoading}
                      isError={attributeTypesQuery.isError}
                      onRetry={() => void attributeTypesQuery.refetch()}
                      onSubmit={async (body) => {
                        try {
                          await attributeMutation.mutateAsync(body);
                          return { ok: true };
                        } catch (error) {
                          return handleMutationError(error);
                        }
                      }}
                    />
                  ) : null}
                </ContributePanel>
              }
              now={now}
            />
          ) : null}
        </ScrollView>
        <WaterCelebration triggerKey={celebrationKey} points={celebrationPoints} />
      </QueryStateView>
    </ScreenContainer>
  );
}

function AdminControls({
  detail,
  pending,
  onUpdate,
  onDelete,
  onSetNoteHidden,
}: {
  detail: AdminFountainDetail;
  pending: boolean;
  onUpdate: (patch: AdminFountainPatch) => Promise<void>;
  onDelete: () => Promise<void>;
  onSetNoteHidden: (noteId: string, isHidden: boolean) => Promise<void>;
}) {
  const [latitude, setLatitude] = useState(String(detail.location.latitude));
  const [longitude, setLongitude] = useState(String(detail.location.longitude));
  const [isWorking, setIsWorking] = useState(detail.is_working);
  const [placementNote, setPlacementNote] = useState(detail.placement_note ?? "");
  const [comments, setComments] = useState(detail.comments ?? "");
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setMessage(null);
    try {
      await action();
      setMessage("Saved.");
    } catch (error) {
      const status = apiErrorStatus(error);
      if (status === 401) {
        setMessage("Sign in again before moderating.");
      } else if (status === 403) {
        setMessage("This account does not have admin access.");
      } else if (status === 422) {
        setMessage("Check the values and try again.");
      } else {
        setMessage("Admin action failed.");
      }
    }
  };

  const save = () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage("Latitude and longitude must be numbers.");
      return;
    }
    void run(() =>
      onUpdate({
        location: { latitude: lat, longitude: lng },
        is_working: isWorking,
        placement_note: placementNote.trim() || null,
        comments: comments.trim() || null,
      }),
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete fountain?",
      "This permanently deletes the fountain and its ratings, reports, and notes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void run(onDelete);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.adminWrap}>
      <View>
        <Text style={styles.adminHeading}>Admin controls</Text>
        {detail.is_hidden ? <Text style={styles.adminMeta}>Hidden from public reads</Text> : null}
        {message ? <Text style={styles.adminMessage}>{message}</Text> : null}
      </View>
      <View style={styles.adminForm}>
        <Text style={styles.adminLabel}>Latitude</Text>
        <TextInput
          value={latitude}
          onChangeText={setLatitude}
          keyboardType="numbers-and-punctuation"
          editable={!pending}
          style={styles.adminInput}
        />
        <Text style={styles.adminLabel}>Longitude</Text>
        <TextInput
          value={longitude}
          onChangeText={setLongitude}
          keyboardType="numbers-and-punctuation"
          editable={!pending}
          style={styles.adminInput}
        />
        <View style={styles.adminButtonRow}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() => setIsWorking(true)}
            style={[styles.adminSegment, isWorking ? styles.adminSegmentActive : null]}
          >
            <Text style={isWorking ? styles.adminSegmentTextActive : styles.adminSegmentText}>
              Working
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() => setIsWorking(false)}
            style={[styles.adminSegment, !isWorking ? styles.adminSegmentActive : null]}
          >
            <Text style={!isWorking ? styles.adminSegmentTextActive : styles.adminSegmentText}>
              Out of order
            </Text>
          </Pressable>
        </View>
        <Text style={styles.adminLabel}>Placement note</Text>
        <TextInput
          value={placementNote}
          onChangeText={setPlacementNote}
          editable={!pending}
          multiline
          style={[styles.adminInput, styles.adminMultiline]}
        />
        <Text style={styles.adminLabel}>Comments</Text>
        <TextInput
          value={comments}
          onChangeText={setComments}
          editable={!pending}
          multiline
          style={[styles.adminInput, styles.adminMultiline]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={save}
          style={[styles.adminPrimaryButton, pending ? styles.disabled : null]}
        >
          <Text style={styles.adminPrimaryText}>Save edits</Text>
        </Pressable>
      </View>
      <View style={styles.adminButtonRow}>
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={() => {
            void run(() => onUpdate({ is_hidden: !detail.is_hidden }));
          }}
          style={[styles.adminOutlineButton, pending ? styles.disabled : null]}
        >
          <Text style={styles.adminOutlineText}>
            {detail.is_hidden ? "Unhide fountain" : "Hide fountain"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={confirmDelete}
          style={[styles.adminDangerButton, pending ? styles.disabled : null]}
        >
          <Text style={styles.adminDangerText}>Delete fountain</Text>
        </Pressable>
      </View>
      {detail.notes.length > 0 ? (
        <View style={styles.adminNotes}>
          <Text style={styles.adminMeta}>MODERATE NOTES</Text>
          {detail.notes.map((note) => (
            <View key={note.id} style={styles.adminNoteRow}>
              <View style={styles.adminNoteText}>
                <Text style={styles.adminNoteBody}>{note.body}</Text>
                <Text style={styles.adminMeta}>
                  {note.author_display_name}
                  {note.is_hidden ? " · hidden" : ""}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={() => {
                  void run(() => onSetNoteHidden(note.id, !note.is_hidden));
                }}
                style={[styles.adminSmallButton, pending ? styles.disabled : null]}
              >
                <Text style={styles.adminOutlineText}>{note.is_hidden ? "Unhide" : "Hide"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.md, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  notFoundTitle: { ...typography.title, color: colors.brandBlue },
  notFoundNote: { ...typography.body, color: colors.textMuted },
  secondaryButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  adminWrap: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  adminHeading: { ...typography.heading, color: colors.brandBlue },
  adminMeta: { ...typography.meta, color: colors.textMuted, fontWeight: "600" },
  adminMessage: { ...typography.body, color: colors.danger, marginTop: spacing.xs },
  adminForm: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  adminLabel: { ...typography.meta, color: colors.textMuted, fontWeight: "700" },
  adminInput: {
    minHeight: 44,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  adminMultiline: { minHeight: 76, textAlignVertical: "top" },
  adminButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  adminSegment: {
    minHeight: 44,
    justifyContent: "center",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminSegmentActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  adminSegmentText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  adminSegmentTextActive: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
  adminPrimaryButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminPrimaryText: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
  adminOutlineButton: {
    minHeight: 44,
    justifyContent: "center",
    borderColor: colors.brandBlue,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminOutlineText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  adminDangerButton: {
    minHeight: 44,
    justifyContent: "center",
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminDangerText: { ...typography.body, color: colors.danger, fontWeight: "700" },
  adminNotes: { gap: spacing.sm },
  adminNoteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
  },
  adminNoteText: { flex: 1, gap: spacing.xs },
  adminNoteBody: { ...typography.body, color: colors.text },
  adminSmallButton: {
    minHeight: 40,
    justifyContent: "center",
    borderColor: colors.brandBlue,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  disabled: { opacity: 0.6 },
});
