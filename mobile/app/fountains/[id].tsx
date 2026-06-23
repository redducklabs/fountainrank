import type { components } from "@fountainrank/api-client";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { FountainDetail } from "../../components/fountain/FountainDetail";
import { ScreenContainer } from "../../components/ScreenContainer";
import { QueryStateView } from "../../components/states/QueryStateView";
import { apiErrorStatus, unwrap } from "../../lib/api";
import { normalizeFountainId } from "../../lib/detail/id";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];

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
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  // Reject absent/array/malformed (non-UUID) ids client-side — the backend route
  // param is a uuid.UUID, so a bad value would 422; show the honest not-found state.
  const fountainId = normalizeFountainId(id);
  const now = new Date();

  const detailQuery = useQuery({
    queryKey: ["fountain", fountainId],
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
              now={now}
            />
          ) : null}
        </ScrollView>
      </QueryStateView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.md, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  notFoundTitle: { ...typography.title, color: colors.brandBlue },
  notFoundNote: { ...typography.body, color: colors.textMuted },
});
