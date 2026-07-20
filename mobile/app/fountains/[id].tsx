import type { components } from "@fountainrank/api-client";
import { isRatingDraftDirty, type AwardedPoints } from "@fountainrank/contributions";

import { awardedPoints } from "../../lib/awarded-points";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { PhotoUploadButton } from "../../components/fountain/PhotoUploadButton";
import {
  effectiveStars,
  RatingContributionForm,
} from "../../components/fountain/RatingContributionForm";
import { ReportContentButton } from "../../components/fountain/ReportContentButton";
import { ScreenContainer } from "../../components/ScreenContainer";
import { QueryStateView } from "../../components/states/QueryStateView";
import { apiErrorStatus, unwrap } from "../../lib/api";
import { flushRatingThenUpload } from "../../lib/contributions/add-photo-flow";
import { buildRatingPayload } from "../../lib/contributions/payloads";
import type { ContributionError } from "../../lib/contributions/state";
import { contributionErrorText, mapContributionError } from "../../lib/contributions/state";
import { normalizeFountainId } from "../../lib/detail/id";
import {
  buildPhotoUpload,
  mapPhotoUploadError,
  PhotoUploadError,
} from "../../lib/detail/photo-upload";
import { requestCurrentCoords } from "../../lib/location-request";
import { REPORT_CATEGORIES, reportContent, type ReportContentType } from "../../lib/detail/report";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];
type PhotoOut = components["schemas"]["PhotoOut"];
type ReportTarget = { contentType: ReportContentType; contentId: string };
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
  const { client, config } = useApi();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // The rating draft (explicit star taps) lives here, not in RatingContributionForm, so "Add photo"
  // can flush an unsaved rating before uploading (#1).
  const [ratingEdits, setRatingEdits] = useState<Record<number, number>>({});
  // Single-flight guard for the add-photo flow (#1): the ref blocks re-entry across the whole
  // pick → coords → rating → upload lifecycle; `addingPhoto` disables the buttons for the same span.
  const addPhotoInFlight = useRef(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [photoUploadMessage, setPhotoUploadMessage] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
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

  // Keyed on auth like `detailQuery`: the list is public, but the backend only computes each
  // photo's viewer-specific `is_own` (needed for the mobile per-photo delete gate) when the
  // request carries a token, so signed-in and anonymous reads must be distinct cache entries.
  const photosQuery = useQuery({
    queryKey: ["fountain", fountainId, "photos", auth.status === "authenticated"],
    enabled: fountainId != null,
    queryFn: async (): Promise<PhotoOut[]> => {
      if (fountainId == null) throw new Error("missing fountain id");
      return unwrap(
        await client.GET("/api/v1/fountains/{fountain_id}/photos", {
          params: { path: { fountain_id: fountainId } },
        }),
      );
    },
  });

  const attributeTypesQuery = useQuery({
    queryKey: ["attribute-types"],
    enabled: fountainId != null && auth.status === "authenticated",
    queryFn: async (): Promise<AttributeTypeOut[]> =>
      unwrap(await client.GET("/api/v1/attribute-types")),
  });

  const refreshDetailAfterWrite = (detail: FountainDetailT | undefined, points: AwardedPoints) => {
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
    // Saved, but earned nothing -> refresh the data and stay quiet (#204). The form still shows a
    // neutral confirmation saying why; the celebration is a reward and must not fire for 0.
    if (points <= 0) return;
    setCelebrationPoints(points);
    setCelebrationKey((key) => key + 1);
  };

  const refreshAdminAfterWrite = () => {
    if (fountainId == null) return;
    void queryClient.invalidateQueries({ queryKey: ["fountain", fountainId] });
    void queryClient.invalidateQueries({ queryKey: ["fountain", fountainId, "notes"] });
    void queryClient.invalidateQueries({ queryKey: ["fountains", "bbox"] });
  };

  // Always an error result — typed as such (not the wider SubmitResult) so a form callback's
  // success branch can carry `pointsAwarded` without the union widening back to a bare ok (#204).
  const handleMutationError = (error: unknown): { ok: false; error: ContributionError } => {
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

  const handlePhotoUploadError = (error: unknown): void => {
    const mapped = mapPhotoUploadError(error);
    if (mapped === "unauthenticated") {
      auth.markReauthRequired();
    }
    if (mapped === "needs_name") {
      router.navigate("/account");
    }
    setPhotoUploadMessage({ tone: "err", text: contributionErrorText(mapped) });
  };

  const pickAndUploadPhoto = async (
    asset: { uri: string; fileName?: string | null; mimeType?: string | null },
    dimensions: FountainDetailT["dimensions"],
  ) => {
    // Single-flight guard (#1): the rating flush + location fetch run BEFORE photoUploadMutation
    // flips to pending, so without this a second "Add photo" tap in that window would double-submit
    // the rating and upload two photos. The ref persists across renders (so the flag survives the
    // re-created closure); `addingPhoto` state disables both buttons for the whole lifecycle. This is
    // the same guarded-once semantics as the unit-tested `singleFlight` helper.
    if (addPhotoInFlight.current) return;
    addPhotoInFlight.current = true;
    setAddingPhoto(true);
    setPhotoUploadMessage(null);
    // #1: if the user has an unsaved rating, submit it first — but NEVER let a rating failure
    // (including the 50 mi proximity 403) block the ungated photo upload (spec §4.1).
    const dirty = fountainId != null && isRatingDraftDirty(dimensions, ratingEdits);
    let ratingError: ContributionError | null = null;
    try {
      const { ratingOutcome } = await flushRatingThenUpload({
        isDirty: dirty,
        submitRating: async () => {
          const coords = await requestCurrentCoords();
          const payload = buildRatingPayload(
            fountainId as string,
            effectiveStars(dimensions, ratingEdits),
            coords,
          );
          if (!payload.ok) {
            ratingError = "validation";
            return { ok: false, error: "validation" };
          }
          try {
            await ratingMutation.mutateAsync(payload.value);
            setRatingEdits({}); // draft saved -> no longer dirty
            return { ok: true };
          } catch (error) {
            const result = handleMutationError(error);
            if (!result.ok) ratingError = result.error;
            return result;
          }
        },
        uploadPhoto: async () => {
          await photoUploadMutation.mutateAsync(asset);
        },
      });
      // Photo uploaded (no throw). photoUploadMutation.onSuccess set the default "Photo added"
      // message; override it when the flushed rating failed so the outcome isn't silent.
      if (ratingOutcome === "failed" && ratingError) {
        setPhotoUploadMessage({
          tone: "ok",
          text:
            ratingError === "too_far"
              ? "Photo added. Your rating wasn't saved — you're too far from this fountain to rate it."
              : `Photo added, but your rating wasn't saved: ${contributionErrorText(ratingError)}`,
        });
      }
    } catch (error) {
      handlePhotoUploadError(error);
    } finally {
      addPhotoInFlight.current = false;
      setAddingPhoto(false);
    }
  };

  const submitReport = async (
    category: string,
    note: string | undefined,
  ): Promise<SubmitResult> => {
    if (reportTarget == null) return { ok: false, error: "server" };
    try {
      await reportMutation.mutateAsync({ ...reportTarget, category, note });
      return { ok: true };
    } catch (error) {
      return handleMutationError(error);
    }
  };

  const confirmDeletePhoto = (photo: PhotoOut) => {
    Alert.alert("Delete photo?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          photoDeleteMutation.mutate(photo.id, {
            onError: (error) => {
              const status = apiErrorStatus(error);
              Alert.alert(
                "Couldn't delete this photo",
                status === 403
                  ? "Only the photo's owner can delete it."
                  : "Please try again in a moment.",
              );
            },
          });
        },
      },
    ]);
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
    // The SERVER's award, not `body.ratings.length * CONTRIBUTION_POINTS.rate` — that guess fired a
    // fake "+4 points" on every re-rate (#204).
    onSuccess: (detail) => refreshDetailAfterWrite(detail, awardedPoints(detail)),
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
    onSuccess: (detail) => refreshDetailAfterWrite(detail, awardedPoints(detail)),
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
    onSuccess: (detail) => refreshDetailAfterWrite(detail, awardedPoints(detail)),
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
    onSuccess: (note) => {
      void notesQuery.refetch();
      void detailQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
      // `dk_note` is once-ever per (user, fountain): a 2nd note awards 0 and must not celebrate.
      const earned = awardedPoints(note);
      if (earned <= 0) return;
      setCelebrationPoints(earned);
      setCelebrationKey((key) => key + 1);
    },
  });

  const photoUploadMutation = useMutation({
    mutationFn: async (asset: {
      uri: string;
      fileName?: string | null;
      mimeType?: string | null;
    }): Promise<PhotoOut> => {
      if (fountainId == null) throw new Error("missing fountain id");
      const upload = buildPhotoUpload(asset);
      const result = await client.uploadMultipart(`/api/v1/fountains/${fountainId}/photos`, upload);
      if (result.status < 200 || result.status >= 300) {
        throw new PhotoUploadError(result.status, result.detail);
      }
      // The facade now parses the success body (#204) so we can read the real award.
      return result.data as PhotoOut;
    },
    onSuccess: (photo) => {
      // `photo_first` is per-FOUNTAIN: only a fountain's first photo earns, so say so when it
      // doesn't (#204).
      const earned = awardedPoints(photo);
      setPhotoUploadMessage({
        tone: "ok",
        text:
          earned > 0
            ? `Photo added — you earned ${earned} points.`
            : "Photo added. Points are only awarded for a fountain's first photo.",
      });
      void photosQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
      if (earned <= 0) return;
      setCelebrationPoints(earned);
      setCelebrationKey((key) => key + 1);
    },
  });

  const reportMutation = useMutation({
    mutationFn: async ({
      contentType,
      contentId,
      category,
      note,
    }: ReportTarget & { category: string; note: string | undefined }): Promise<void> => {
      if (fountainId == null) throw new Error("missing fountain id");
      await reportContent(client, { contentType, fountainId, contentId, category, note });
    },
  });

  const photoDeleteMutation = useMutation({
    mutationFn: async (photoId: string): Promise<void> => {
      if (fountainId == null) throw new Error("missing fountain id");
      unwrap(
        await client.DELETE("/api/v1/fountains/{fountain_id}/photos/{photo_id}", {
          params: { path: { fountain_id: fountainId, photo_id: photoId } },
        }),
      );
    },
    onSuccess: () => {
      void photosQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
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
    mutationFn: async (reason: string): Promise<void> => {
      if (fountainId == null) throw new Error("missing fountain id");
      unwrap(
        await client.DELETE("/api/v1/admin/fountains/{fountain_id}", {
          params: { path: { fountain_id: fountainId }, query: { reason: reason.trim() || null } },
        }),
      );
    },
    onSuccess: refreshAdminAfterWrite,
  });

  const adminNoteMutation = useMutation({
    mutationFn: async ({
      noteId,
      isHidden,
      reason,
    }: {
      noteId: string;
      isHidden: boolean;
      reason: string;
    }): Promise<AdminNoteOut> =>
      unwrap(
        await client.PATCH("/api/v1/admin/notes/{note_id}", {
          params: { path: { note_id: noteId } },
          body: { is_hidden: isHidden, moderation_reason: reason.trim() || null },
        }),
      ),
    onSuccess: refreshAdminAfterWrite,
  });

  const adminRatingDeleteMutation = useMutation({
    mutationFn: async ({
      ratingId,
      reason,
    }: {
      ratingId: string;
      reason: string;
    }): Promise<void> => {
      unwrap(
        await client.DELETE("/api/v1/admin/ratings/{rating_id}", {
          params: { path: { rating_id: ratingId } },
          body: { reason: reason.trim() },
        }),
      );
    },
    onSuccess: refreshAdminAfterWrite,
  });

  const refetchAll = () => {
    void detailQuery.refetch();
    void notesQuery.refetch();
    void viewerQuery.refetch();
    void photosQuery.refetch();
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
        {detailQuery.data
          ? (() => {
              // Narrow `detailQuery.data` to a local so the contribution nodes (which read
              // `detail.dimensions` / `detail.condition_points_eligible_at`) typecheck.
              const detail = detailQuery.data;
              // Each tab's contribution controls get their own auth-gated ContributePanel,
              // mirroring web's per-tab ContributeSection. Only how the forms are grouped
              // changes; the mutations/handlers are unchanged.
              const wrapContribution = (children: ReactNode) => (
                <ContributePanel
                  authStatus={auth.status}
                  onSignIn={async () => {
                    await auth.signIn();
                  }}
                >
                  {children}
                </ContributePanel>
              );
              const infoContribution = wrapContribution(
                <>
                  <RatingContributionForm
                    fountainId={fountainId}
                    dimensions={detail.dimensions}
                    viewerAwardState={detail.viewer_award_state}
                    pending={ratingMutation.isPending}
                    edits={ratingEdits}
                    onStarPress={(ratingTypeId, value) =>
                      setRatingEdits((current) => ({ ...current, [ratingTypeId]: value }))
                    }
                    onSubmit={async (body) => {
                      try {
                        const saved = await ratingMutation.mutateAsync(body);
                        setRatingEdits({}); // draft saved
                        // Hand the SERVER's award to the form so a 0-point save says so (#204).
                        return { ok: true as const, pointsAwarded: awardedPoints(saved) };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                  <PhotoUploadButton
                    viewerAwardState={detail.viewer_award_state}
                    pending={photoUploadMutation.isPending || addingPhoto}
                    message={photoUploadMessage}
                    onPick={(asset) => {
                      void pickAndUploadPhoto(asset, detail.dimensions);
                    }}
                  />
                </>,
              );
              const detailsContribution = wrapContribution(
                <>
                  <AttributeContributionForm
                    fountainId={fountainId}
                    attributeTypes={attributeTypesQuery.data ?? []}
                    viewerAwardState={detail.viewer_award_state}
                    pending={attributeMutation.isPending}
                    isLoading={attributeTypesQuery.isLoading}
                    isError={attributeTypesQuery.isError}
                    onRetry={() => void attributeTypesQuery.refetch()}
                    onSubmit={async (body) => {
                      try {
                        const saved = await attributeMutation.mutateAsync(body);
                        return { ok: true as const, pointsAwarded: awardedPoints(saved) };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                  <ConditionContributionForm
                    fountainId={fountainId}
                    pending={conditionMutation.isPending}
                    conditionPointsEligibleAt={detail.condition_points_eligible_at}
                    onSubmit={async (body) => {
                      try {
                        const saved = await conditionMutation.mutateAsync(body);
                        return { ok: true as const, pointsAwarded: awardedPoints(saved) };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                  <NoteContributionForm
                    fountainId={fountainId}
                    viewerAwardState={detail.viewer_award_state}
                    pending={noteMutation.isPending}
                    onSubmit={async (body) => {
                      try {
                        const saved = await noteMutation.mutateAsync(body);
                        return { ok: true as const, pointsAwarded: awardedPoints(saved) };
                      } catch (error) {
                        return handleMutationError(error);
                      }
                    }}
                  />
                </>,
              );
              const photosContribution = wrapContribution(
                <PhotoUploadButton
                  viewerAwardState={detail.viewer_award_state}
                  pending={photoUploadMutation.isPending || addingPhoto}
                  message={photoUploadMessage}
                  onPick={(asset) => {
                    void pickAndUploadPhoto(asset, detail.dimensions);
                  }}
                />,
              );
              return (
                <FountainDetail
                  detail={detail}
                  notes={displayNotes}
                  notesError={notesQuery.isError}
                  onRetryNotes={() => void notesQuery.refetch()}
                  photos={photosQuery.data}
                  apiBaseUrl={config.apiBaseUrl}
                  onReportPhoto={
                    auth.status === "authenticated"
                      ? (photo) => setReportTarget({ contentType: "photo", contentId: photo.id })
                      : undefined
                  }
                  onDeletePhoto={auth.status === "authenticated" ? confirmDeletePhoto : undefined}
                  onReportNote={
                    auth.status === "authenticated"
                      ? (note) => setReportTarget({ contentType: "note", contentId: note.id })
                      : undefined
                  }
                  onReportFountain={
                    auth.status === "authenticated"
                      ? () => setReportTarget({ contentType: "fountain", contentId: fountainId })
                      : undefined
                  }
                  adminControls={
                    adminDetail ? (
                      <AdminControls
                        detail={adminDetail}
                        pending={
                          adminUpdateMutation.isPending ||
                          adminDeleteMutation.isPending ||
                          adminNoteMutation.isPending ||
                          adminRatingDeleteMutation.isPending
                        }
                        onUpdate={async (patch) => {
                          await adminUpdateMutation.mutateAsync(patch);
                        }}
                        onDelete={async (reason) => {
                          await adminDeleteMutation.mutateAsync(reason);
                        }}
                        onSetNoteHidden={async (noteId, isHidden, reason) => {
                          await adminNoteMutation.mutateAsync({
                            noteId,
                            isHidden,
                            reason,
                          });
                        }}
                        onDeleteRating={async (ratingId, reason) => {
                          await adminRatingDeleteMutation.mutateAsync({ ratingId, reason });
                        }}
                      />
                    ) : undefined
                  }
                  infoContribution={infoContribution}
                  detailsContribution={detailsContribution}
                  photosContribution={photosContribution}
                  refreshing={
                    detailQuery.isRefetching || notesQuery.isRefetching || photosQuery.isRefetching
                  }
                  onRefresh={refetchAll}
                  now={now}
                  webBaseUrl={config.webBaseUrl}
                />
              );
            })()
          : null}
        <WaterCelebration triggerKey={celebrationKey} points={celebrationPoints} />
      </QueryStateView>
      <ReportContentButton
        key={reportTarget ? `${reportTarget.contentType}:${reportTarget.contentId}` : "closed"}
        contentType={reportTarget?.contentType ?? "photo"}
        categories={REPORT_CATEGORIES[reportTarget?.contentType ?? "photo"]}
        visible={reportTarget != null}
        pending={reportMutation.isPending}
        onSubmit={submitReport}
        onClose={() => setReportTarget(null)}
      />
    </ScreenContainer>
  );
}

function AdminControls({
  detail,
  pending,
  onUpdate,
  onDelete,
  onSetNoteHidden,
  onDeleteRating,
}: {
  detail: AdminFountainDetail;
  pending: boolean;
  onUpdate: (patch: AdminFountainPatch) => Promise<void>;
  onDelete: (reason: string) => Promise<void>;
  onSetNoteHidden: (noteId: string, isHidden: boolean, reason: string) => Promise<void>;
  onDeleteRating: (ratingId: string, reason: string) => Promise<void>;
}) {
  const [latitude, setLatitude] = useState(String(detail.location.latitude));
  const [longitude, setLongitude] = useState(String(detail.location.longitude));
  const [isWorking, setIsWorking] = useState(detail.is_working);
  const [placementNote, setPlacementNote] = useState(detail.placement_note ?? "");
  const [comments, setComments] = useState(detail.comments ?? "");
  const [moderationReason, setModerationReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Which button is in flight, so only the tapped one spins while `pending` disables them all
  // (Save and Hide share one mutation, so isPending alone can't tell them apart) (#212).
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setActiveAction(key);
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
    } finally {
      setActiveAction(null);
    }
  };

  const save = () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage("Latitude and longitude must be numbers.");
      return;
    }
    void run("save", () =>
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
            void run("delete", () => onDelete(moderationReason));
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
          accessibilityState={{ disabled: pending, busy: activeAction === "save" }}
          disabled={pending}
          onPress={save}
          style={[styles.adminPrimaryButton, pending ? styles.disabled : null]}
        >
          {activeAction === "save" ? (
            <ActivityIndicator size="small" color={colors.onBrand} />
          ) : null}
          <Text style={styles.adminPrimaryText}>Save edits</Text>
        </Pressable>
      </View>
      <View style={styles.adminForm}>
        <Text style={styles.adminLabel}>Moderation reason</Text>
        <TextInput
          value={moderationReason}
          onChangeText={setModerationReason}
          editable={!pending}
          maxLength={500}
          multiline
          placeholder="Required for rating removal; optional for other actions"
          style={[styles.adminInput, styles.adminMultiline]}
        />
      </View>
      <View style={styles.adminButtonRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, busy: activeAction === "hide" }}
          disabled={pending}
          onPress={() => {
            void run("hide", () =>
              onUpdate({
                is_hidden: !detail.is_hidden,
                moderation_reason: moderationReason.trim() || null,
              }),
            );
          }}
          style={[styles.adminOutlineButton, pending ? styles.disabled : null]}
        >
          {activeAction === "hide" ? (
            <ActivityIndicator size="small" color={colors.brandBlue} />
          ) : null}
          <Text style={styles.adminOutlineText}>
            {detail.is_hidden ? "Unhide fountain" : "Hide fountain"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, busy: activeAction === "delete" }}
          disabled={pending}
          onPress={confirmDelete}
          style={[styles.adminDangerButton, pending ? styles.disabled : null]}
        >
          {activeAction === "delete" ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : null}
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
                accessibilityState={{ disabled: pending, busy: activeAction === `note:${note.id}` }}
                disabled={pending}
                onPress={() => {
                  void run(`note:${note.id}`, () =>
                    onSetNoteHidden(note.id, !note.is_hidden, moderationReason),
                  );
                }}
                style={[styles.adminSmallButton, pending ? styles.disabled : null]}
              >
                {activeAction === `note:${note.id}` ? (
                  <ActivityIndicator size="small" color={colors.brandBlue} />
                ) : null}
                <Text style={styles.adminOutlineText}>{note.is_hidden ? "Unhide" : "Hide"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {detail.ratings.length > 0 ? (
        <View style={styles.adminNotes}>
          <Text style={styles.adminMeta}>MODERATE RATINGS</Text>
          {detail.ratings.map((rating) => (
            <View key={rating.id} style={styles.adminNoteRow}>
              <Text style={styles.adminNoteBody}>
                {rating.rating_type_name}: {rating.stars}/5 · {rating.contributor}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={pending || moderationReason.trim().length === 0}
                onPress={() => {
                  void run(`rating:${rating.id}`, () =>
                    onDeleteRating(rating.id, moderationReason),
                  );
                }}
                style={[styles.adminDangerButton, pending ? styles.disabled : null]}
              >
                {activeAction === `rating:${rating.id}` ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : null}
                <Text style={styles.adminDangerText}>Remove rating</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  notFoundTitle: { ...typography.title, color: colors.brandBlue },
  notFoundNote: { ...typography.body, color: colors.textMuted },
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.brandBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminPrimaryText: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
  adminOutlineButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderColor: colors.brandBlue,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminOutlineText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  adminDangerButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderColor: colors.brandBlue,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
  },
  disabled: { opacity: 0.6 },
});
