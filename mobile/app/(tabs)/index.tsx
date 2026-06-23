import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { components } from "@fountainrank/api-client";

import { FountainMap } from "../../components/map/FountainMap";
import { MapFilters } from "../../components/map/MapFilters";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useForegroundLocation } from "../../hooks/useForegroundLocation";
import { unwrap } from "../../lib/api";
import { isMapConfigured } from "../../lib/config";
import { isAtCap, normalizeBounds, type RawBounds, shouldLoadPins } from "../../lib/map/bounds";
import { DEFAULT_ZOOM } from "../../lib/map/constants";
import {
  buildBboxQuery,
  DEFAULT_FILTERS,
  type FountainFilters,
  fountainsQueryKey,
} from "../../lib/map/filters";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { resolveViewState, type ViewState } from "../../lib/view-state";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

type FountainPin = components["schemas"]["FountainPin"];

export default function MapScreen() {
  const { client, config } = useApi();
  const router = useRouter();
  const location = useForegroundLocation();

  const [filters, setFilters] = useState<FountainFilters>(DEFAULT_FILTERS);
  const [region, setRegion] = useState<{ bounds: RawBounds; zoom: number } | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);

  const norm = region ? normalizeBounds(region.bounds) : null;
  const params = norm && !norm.skip ? norm.params : null;
  const zoom = region?.zoom ?? DEFAULT_ZOOM;
  const enabled = isMapConfigured(config) && params != null && shouldLoadPins(zoom);

  const pinsQuery = useQuery({
    queryKey: params ? fountainsQueryKey(params, filters) : ["fountains", "bbox", "idle"],
    enabled,
    queryFn: async (): Promise<FountainPin[]> =>
      unwrap(
        await client.GET("/api/v1/fountains/bbox", {
          params: { query: buildBboxQuery(params!, filters) },
        }),
      ),
  });

  // FountainPin[] is directly assignable to PinInput[] (ranking_score/current_status
  // are optional), so no per-pin normalization is needed at the call site.
  const featureCollection = useMemo(
    () => pinsToFeatureCollection(pinsQuery.data ?? []),
    [pinsQuery.data],
  );

  // Honest "map unavailable" state when no basemap style URL is configured.
  if (!isMapConfigured(config)) {
    return (
      <ScreenContainer includeTopInset>
        <View style={styles.centered}>
          <Text style={styles.title}>Map unavailable</Text>
          <Text style={styles.note}>The map is not configured for this build.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const belowZoom = region != null && !shouldLoadPins(zoom);
  const capped = pinsQuery.data != null && isAtCap(pinsQuery.data.length);
  // Reuse the shared resolver so offline-vs-error classification stays single-sourced.
  // isLoading (= isPending && isFetching) is true only on the FIRST load, so a
  // background refetch doesn't flash the spinner. `isEmpty` is gated on isSuccess so
  // the "no fountains" banner only appears after an enabled bbox query actually
  // returned an empty array — never before the first request, and never for a
  // disabled (idle / antimeridian-skipped / below-zoom) query.
  const viewState: ViewState = resolveViewState({
    isLoading: enabled && pinsQuery.isLoading,
    isError: pinsQuery.isError,
    error: pinsQuery.error,
    isEmpty: pinsQuery.isSuccess && (pinsQuery.data?.length ?? 0) === 0,
  });

  return (
    <View style={styles.fill}>
      <FountainMap
        styleUrl={config.basemapStyleUrl!}
        featureCollection={featureCollection}
        userCoords={location.coords}
        recenterKey={recenterKey}
        showUserLocation={location.status === "granted"}
        onRegionChange={(bounds, z) => setRegion({ bounds, zoom: z })}
        onPinPress={(id) => router.push(`/fountains/${id}`)}
      />

      <View style={styles.filterBar} pointerEvents="box-none">
        <MapFilters filters={filters} onChange={setFilters} />
      </View>

      {location.coords ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Center on my location"
          onPress={() => setRecenterKey((k) => k + 1)}
          style={styles.locate}
        >
          <Text style={styles.locateGlyph}>◎</Text>
        </Pressable>
      ) : null}

      <MapOverlay
        belowZoom={belowZoom}
        viewState={viewState}
        capped={capped}
        onRetry={() => void pinsQuery.refetch()}
      />
    </View>
  );
}

function MapOverlay(props: {
  belowZoom: boolean;
  viewState: ViewState;
  capped: boolean;
  onRetry: () => void;
}) {
  const loading = props.viewState === "loading";
  const retryable = props.viewState === "offline" || props.viewState === "error";

  let message: string | null = null;
  if (props.belowZoom) message = "Zoom in to see fountains";
  else if (props.viewState === "offline") message = "You appear to be offline";
  else if (props.viewState === "error") message = "Couldn't load fountains";
  else if (props.viewState === "empty") message = "No fountains in this area";
  else if (props.viewState === "ready" && props.capped)
    message = "Showing the first 500 — zoom in for more";

  if (!loading && message == null) return null;

  return (
    <View style={styles.banner} pointerEvents="box-none">
      {loading ? <ActivityIndicator color={colors.brandBlue} /> : null}
      {message ? (
        <Text style={styles.bannerText} onPress={retryable ? props.onRetry : undefined}>
          {message}
          {retryable ? " — tap to retry" : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  filterBar: { position: "absolute", top: spacing.sm, left: 0, right: 0 },
  locate: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.lg + 56,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  locateGlyph: { ...typography.heading, color: colors.brandBlue },
  banner: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerText: { ...typography.meta, color: colors.text },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
});
