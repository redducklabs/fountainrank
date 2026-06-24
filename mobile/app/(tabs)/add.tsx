import type { components } from "@fountainrank/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AddFountainForm } from "../../components/add-fountain/AddFountainForm";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ApiError, unwrap } from "../../lib/api";
import type { AddFountainInput } from "../../lib/add-fountain/payloads";
import {
  addFountainGate,
  duplicateFountainId,
  mapAddFountainError,
  type AddFountainResult,
} from "../../lib/add-fountain/state";
import { useForegroundLocation } from "../../hooks/useForegroundLocation";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];

export default function AddScreen() {
  const { client, config } = useApi();
  const auth = useAuth();
  const router = useRouter();
  const location = useForegroundLocation();
  const queryClient = useQueryClient();
  const [catalogsEnabled, setCatalogsEnabled] = useState(false);

  const gate = addFountainGate(auth.status);

  const ratingTypesQuery = useQuery({
    queryKey: ["rating-types"],
    enabled: auth.status === "authenticated" && catalogsEnabled,
    queryFn: async (): Promise<RatingTypeOut[]> => unwrap(await client.GET("/api/v1/rating-types")),
  });

  const attributeTypesQuery = useQuery({
    queryKey: ["attribute-types"],
    enabled: auth.status === "authenticated" && catalogsEnabled,
    queryFn: async (): Promise<AttributeTypeOut[]> =>
      unwrap(await client.GET("/api/v1/attribute-types")),
  });

  const addMutation = useMutation({
    mutationFn: async (body: AddFountainInput): Promise<AddFountainResult> => {
      const result = await client.POST("/api/v1/fountains", { body });
      if (result.response.status === 201 && result.data) {
        return { ok: true, fountainId: result.data.id };
      }
      if (result.response.status === 409) {
        const fountainId = duplicateFountainId(result.error as { fountain_id?: unknown });
        return fountainId
          ? { ok: false, error: "duplicate", fountainId }
          : { ok: false, error: "server" };
      }
      if (result.response.status === 401) throw new ApiError(401);
      if (result.response.status === 422) throw new ApiError(422);
      throw new ApiError(result.response.status);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["fountains", "bbox"] });
      if (result.ok)
        void queryClient.invalidateQueries({ queryKey: ["fountain", result.fountainId] });
    },
  });

  const submit = async (input: AddFountainInput): Promise<AddFountainResult> => {
    try {
      return await addMutation.mutateAsync(input);
    } catch (error) {
      const mapped = mapAddFountainError(error);
      if (mapped === "unauthenticated") auth.markReauthRequired();
      return { ok: false, error: mapped };
    }
  };

  const signIn = async () => {
    await auth.signIn();
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Add a fountain</Text>
        {gate.state === "ready" ? (
          <AddFountainForm
            config={config}
            userLocation={location.coords}
            ratingCatalog={{
              data: ratingTypesQuery.data ?? [],
              isLoading: ratingTypesQuery.isLoading,
              isError: ratingTypesQuery.isError,
              onRetry: () => void ratingTypesQuery.refetch(),
            }}
            attributeCatalog={{
              data: attributeTypesQuery.data ?? [],
              isLoading: attributeTypesQuery.isLoading,
              isError: attributeTypesQuery.isError,
              onRetry: () => void attributeTypesQuery.refetch(),
            }}
            pending={addMutation.isPending}
            onNeedCatalogs={() => setCatalogsEnabled(true)}
            onSubmit={submit}
            onViewFountain={(fountainId) => router.push(`/fountains/${fountainId}`)}
          />
        ) : (
          <View style={styles.stateBox}>
            <Text style={styles.note}>{gate.message}</Text>
            {(gate.state === "sign_in" || gate.state === "reauth") && (
              <Text accessibilityRole="button" onPress={() => void signIn()} style={styles.link}>
                Sign in
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, gap: spacing.md },
  title: { ...typography.title, color: colors.brandBlue },
  stateBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  note: { ...typography.body, color: colors.textMuted },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
});
