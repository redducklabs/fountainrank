import type { components } from "@fountainrank/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

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
type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RateRequest = components["schemas"]["RateRequest"];
type ConditionReportRequest = components["schemas"]["ConditionReportRequest"];
type ObserveAttributesRequest = components["schemas"]["ObserveAttributesRequest"];
type AddNoteRequest = components["schemas"]["AddNoteRequest"];
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
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  // Reject absent/array/malformed (non-UUID) ids client-side — the backend route
  // param is a uuid.UUID, so a bad value would 422; show the honest not-found state.
  const fountainId = normalizeFountainId(id);
  const now = new Date();

  // Key on auth: the detail GET is enriched with the caller's own rating only when the
  // request carries a token (#65), so anonymous and authenticated reads are distinct cache
  // entries — signing in (or auth settling after the first fetch) re-fetches the enriched
  // detail instead of serving the cached anonymous one.
  const detailQuery = useQuery({
    queryKey: ["fountain", fountainId, auth.status === "authenticated"],
    enabled: fountainId != null,
    queryFn: async (): Promise<FountainDetailT> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}", {
          params: { path: { fountain_id: fountainId } },
        }),
      );
    },
  });

  const notesQuery = useQuery({
    queryKey: ["fountain", fountainId, "notes"],
    enabled: fountainId != null,
    queryFn: async (): Promise<NoteOut[]> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}/notes", {
          params: { path: { fountain_id: fountainId } },
        }),
      );
    },
  });

  const attributeTypesQuery = useQuery({
    queryKey: ["attribute-types"],
    enabled: fountainId != null && auth.status === "authenticated" && showMoreDetails,
    queryFn: async (): Promise<AttributeTypeOut[]> =>
      unwrap(await client.GET("/api/v1/attribute-types")),
  });

  const refreshDetailAfterWrite = (detail?: FountainDetailT) => {
    if (fountainId == null) return;
    if (detail) {
      queryClient.setQueryData(["fountain", fountainId, auth.status === "authenticated"], detail);
    } else {
      void detailQuery.refetch();
    }
    void queryClient.invalidateQueries({ queryKey: ["fountains", "bbox"] });
    void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
    setCelebrationKey((key) => key + 1);
  };

  const handleMutationError = (error: unknown): SubmitResult => {
    const mapped = mapContributionError(error);
    if (mapped === "unauthenticated") {
      auth.markReauthRequired();
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
    onSuccess: refreshDetailAfterWrite,
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
    onSuccess: refreshDetailAfterWrite,
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
    onSuccess: refreshDetailAfterWrite,
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
      setCelebrationKey((key) => key + 1);
    },
  });

  const refetchAll = () => {
    void detailQuery.refetch();
    void notesQuery.refetch();
  };

  // Invalid route id (bad deep link / unexpected param) — honest, non-retryable.
  if (fountainId == null) {
    return <NotFound note="This link doesn't reference a fountain." />;
  }
  // A 404 means "no such fountain" — honest, non-retryable (not a transient error).
  if (apiErrorStatus(detailQuery.error) === 404) {
    return <NotFound note="This fountain may have been removed." />;
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <QueryStateView
        input={{
          isLoading: detailQuery.isLoading,
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
              notes={notesQuery.data ?? []}
              notesError={notesQuery.isError}
              onRetryNotes={() => void notesQuery.refetch()}
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
        <WaterCelebration triggerKey={celebrationKey} />
      </QueryStateView>
    </ScreenContainer>
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
});
