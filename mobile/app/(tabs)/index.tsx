import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { components } from "@fountainrank/api-client";

import { FountainMap } from "../../components/map/FountainMap";
import { AttributeFields } from "../../components/add-fountain/AttributeFields";
import { MapFilters } from "../../components/map/MapFilters";
import { RatingFields } from "../../components/add-fountain/RatingFields";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useForegroundLocation } from "../../hooks/useForegroundLocation";
import { ApiError, unwrap } from "../../lib/api";
import {
  buildAddFountainPayload,
  buildObservationsFromValues,
  buildRatingsFromStars,
  type AddFountainInput,
} from "../../lib/add-fountain/payloads";
import {
  boundFromFix,
  canPlace,
  inBound,
  type LngLat,
  type ViewportBounds,
} from "../../lib/add-fountain/placement";
import {
  addFountainErrorText,
  addFountainGate,
  addFountainReducer,
  duplicateFountainId,
  initialAddFountainState,
  mapAddFountainError,
  type AddFountainResult,
  type AddFountainState,
} from "../../lib/add-fountain/state";
import { isMapConfigured } from "../../lib/config";
import { isAtCap, normalizeBounds, type RawBounds, shouldLoadPins } from "../../lib/map/bounds";
import { DEFAULT_ZOOM, PLACE_MIN_ZOOM } from "../../lib/map/constants";
import { addFountainPointsPreview, totalPreviewPoints } from "../../lib/contributions/points";
import {
  buildBboxQuery,
  DEFAULT_FILTERS,
  type FountainFilters,
  fountainsQueryKey,
} from "../../lib/map/filters";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { resolveViewState, type ViewState } from "../../lib/view-state";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";

type FountainPin = components["schemas"]["FountainPin"];
type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];

export default function MapScreen() {
  const { client, config } = useApi();
  const auth = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const location = useForegroundLocation();

  const [filters, setFilters] = useState<FountainFilters>(DEFAULT_FILTERS);
  const [region, setRegion] = useState<{ bounds: RawBounds; zoom: number } | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const [addState, addDispatch] = useReducer(addFountainReducer, initialAddFountainState);
  const [ratings, setRatings] = useState<Record<number, number | undefined>>({});
  const [attributes, setAttributes] = useState<Record<number, string | undefined>>({});
  const [comments, setComments] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [addMessage, setAddMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const gate = addFountainGate(auth.status);

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

  const contributionsQuery = useQuery({
    queryKey: ["me", "contributions"],
    enabled: auth.status === "authenticated",
    queryFn: async () => unwrap(await client.GET("/api/v1/me/contributions")),
  });

  const ratingTypesQuery = useQuery({
    queryKey: ["rating-types"],
    enabled: auth.status === "authenticated" && addState.phase === "details",
    queryFn: async (): Promise<RatingTypeOut[]> => unwrap(await client.GET("/api/v1/rating-types")),
  });

  const attributeTypesQuery = useQuery({
    queryKey: ["attribute-types"],
    enabled: auth.status === "authenticated" && showMoreDetails,
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
      void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: ["fountain", result.fountainId] });
      }
    },
  });

  useEffect(() => {
    if (!region) return;
    const bounds: ViewportBounds = region.bounds;
    const fix =
      location.coords != null
        ? {
            ok: true as const,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
          }
        : ({ ok: false } as const);
    addDispatch({ type: "setBound", bound: boundFromFix(fix, bounds) });
  }, [location.coords, region]);

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
        draftPin={addState.pin}
        onMapPressForPlacement={
          gate.state === "ready" && addMode && addState.phase === "placing"
            ? (point) => {
                if (!canPlace(region?.zoom ?? 0, addState.bound)) return;
                setAddMessage(null);
                addDispatch({ type: "dropPin", point });
              }
            : undefined
        }
      />

      <View style={styles.filterBar} pointerEvents="box-none">
        <MapFilters filters={filters} onChange={setFilters} />
      </View>

      {auth.status === "authenticated" ? (
        <View style={styles.pointsChip}>
          <Text style={styles.pointsText}>
            {contributionsQuery.data?.stats.total_points ?? 0} pts
          </Text>
        </View>
      ) : null}

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a fountain"
        onPress={() => {
          setAddMessage(null);
          if (gate.state === "ready") {
            setAddMode(true);
            setShowMoreDetails(false);
          } else if (gate.state === "sign_in" || gate.state === "reauth") {
            void auth.signIn();
          }
        }}
        style={styles.addButton}
      >
        <Text style={styles.addButtonText}>＋</Text>
      </Pressable>

      {gate.state === "ready" && addMode ? (
        <MapAddPanel
          state={addState}
          userLocation={location.coords}
          region={region}
          ratings={ratings}
          attributes={attributes}
          comments={comments}
          ratingTypes={ratingTypesQuery.data ?? []}
          attributeTypes={attributeTypesQuery.data ?? []}
          ratingsLoading={ratingTypesQuery.isLoading}
          attributesLoading={attributeTypesQuery.isLoading}
          showMoreDetails={showMoreDetails}
          pending={addMutation.isPending || addState.phase === "submitting"}
          message={addMessage}
          onSetRatings={setRatings}
          onSetAttributes={setAttributes}
          onSetComments={setComments}
          onToggleMore={() => setShowMoreDetails((current) => !current)}
          onUseCurrentLocation={() => {
            if (!location.coords) return;
            setAddMessage(null);
            addDispatch({
              type: "dropPin",
              point: { lng: location.coords.longitude, lat: location.coords.latitude },
            });
          }}
          onPlaceAtCenter={() => {
            if (!region) return;
            setAddMessage(null);
            addDispatch({
              type: "dropPin",
              point: centerOfBounds(region.bounds),
            });
          }}
          onNudge={(direction) => addDispatch({ type: "nudge", direction })}
          onNext={() => addDispatch({ type: "next" })}
          onBack={() => addDispatch({ type: "back" })}
          onSetWorking={(isWorking) => addDispatch({ type: "setWorking", isWorking })}
          onCancel={() => {
            addDispatch({ type: "reset" });
            setRatings({});
            setAttributes({});
            setComments("");
            setShowMoreDetails(false);
            setAddMessage(null);
            setAddMode(false);
          }}
          onSubmit={async () => {
            setAddMessage(null);
            if (!addState.pin) {
              setAddMessage({ tone: "err", text: "Choose where the fountain is." });
              return;
            }
            const payload = buildAddFountainPayload({
              location: { latitude: addState.pin.lat, longitude: addState.pin.lng },
              is_working: addState.isWorking,
              comments,
              ratings: buildRatingsFromStars(ratingTypesQuery.data ?? [], ratings),
              observations: buildObservationsFromValues(attributeTypesQuery.data ?? [], attributes),
            });
            if (!payload.ok) {
              setAddMessage({ tone: "err", text: "Please check the fountain details." });
              return;
            }
            addDispatch({ type: "submitStart" });
            try {
              const result = await addMutation.mutateAsync(payload.value);
              if (result.ok) {
                addDispatch({ type: "created", fountainId: result.fountainId });
                setAddMode(false);
                router.push(`/fountains/${result.fountainId}`);
                return;
              }
              if (result.error === "duplicate") {
                addDispatch({ type: "duplicate", fountainId: result.fountainId });
                setAddMessage({ tone: "err", text: "A fountain already exists here." });
                return;
              }
              addDispatch({ type: "submitError", error: result.error });
              setAddMessage({ tone: "err", text: addFountainErrorText(result.error) });
            } catch (error) {
              const mapped = mapAddFountainError(error);
              if (mapped === "unauthenticated") auth.markReauthRequired();
              addDispatch({ type: "submitError", error: mapped });
              setAddMessage({ tone: "err", text: addFountainErrorText(mapped) });
            }
          }}
          onViewDuplicate={(id) => router.push(`/fountains/${id}`)}
        />
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

function MapAddPanel({
  state,
  userLocation,
  region,
  ratings,
  attributes,
  comments,
  ratingTypes,
  attributeTypes,
  ratingsLoading,
  attributesLoading,
  showMoreDetails,
  pending,
  message,
  onSetRatings,
  onSetAttributes,
  onSetComments,
  onToggleMore,
  onUseCurrentLocation,
  onPlaceAtCenter,
  onNudge,
  onNext,
  onBack,
  onSetWorking,
  onCancel,
  onSubmit,
  onViewDuplicate,
}: {
  state: AddFountainState;
  userLocation: { latitude: number; longitude: number; accuracy: number | null } | null;
  region: { bounds: RawBounds; zoom: number } | null;
  ratings: Record<number, number | undefined>;
  attributes: Record<number, string | undefined>;
  comments: string;
  ratingTypes: RatingTypeOut[];
  attributeTypes: AttributeTypeOut[];
  ratingsLoading: boolean;
  attributesLoading: boolean;
  showMoreDetails: boolean;
  pending: boolean;
  message: { tone: "ok" | "err"; text: string } | null;
  onSetRatings: (ratings: Record<number, number | undefined>) => void;
  onSetAttributes: (attributes: Record<number, string | undefined>) => void;
  onSetComments: (comments: string) => void;
  onToggleMore: () => void;
  onUseCurrentLocation: () => void;
  onPlaceAtCenter: () => void;
  onNudge: (direction: "n" | "s" | "e" | "w") => void;
  onNext: () => void;
  onBack: () => void;
  onSetWorking: (isWorking: boolean) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
  onViewDuplicate: (id: string) => void;
}) {
  const pinInBound = state.pin != null && state.bound != null && inBound(state.pin, state.bound);
  const placeable = canPlace(region?.zoom ?? 0, state.bound) && pinInBound;
  const ratingsCount = buildRatingsFromStars(ratingTypes, ratings).length;
  const observationsCount = buildObservationsFromValues(attributeTypes, attributes).length;
  const preview = addFountainPointsPreview({
    ratingsCount,
    observationsCount,
    hasComment: comments.trim().length > 0,
  });

  if (state.phase === "duplicate" && state.duplicateId) {
    return (
      <View style={styles.addPanel}>
        <PanelHeader title="A fountain already exists here" onCancel={onCancel} />
        <Text style={styles.note}>Open the existing fountain and add your rating or comment.</Text>
        <PrimaryAction
          label="View existing fountain"
          disabled={false}
          onPress={() => onViewDuplicate(state.duplicateId!)}
        />
        <LiveMessage message={message} />
      </View>
    );
  }

  return (
    <View style={styles.addPanel}>
      <PanelHeader title="Add a fountain" onCancel={onCancel} />
      {state.phase === "placing" ? (
        <View style={styles.panelSection}>
          <Text style={styles.note}>
            {placementInstruction(placeable, region?.zoom, state.pin)}
          </Text>
          {state.pin ? (
            <Text
              style={styles.coord}
            >{`${state.pin.lat.toFixed(5)}, ${state.pin.lng.toFixed(5)}`}</Text>
          ) : null}
          <View style={styles.actions}>
            <SecondaryAction
              label="Use current location"
              disabled={!userLocation || pending}
              onPress={onUseCurrentLocation}
            />
            <SecondaryAction
              label="Place at map center"
              disabled={!region || pending}
              onPress={onPlaceAtCenter}
            />
          </View>
          <View style={styles.nudgeRow}>
            {(["n", "s", "e", "w"] as const).map((direction) => (
              <SecondaryAction
                key={direction}
                label={direction.toUpperCase()}
                disabled={!state.pin || pending}
                onPress={() => onNudge(direction)}
              />
            ))}
          </View>
          <PrimaryAction
            label="Next"
            disabled={!state.pin || !placeable || pending}
            onPress={onNext}
          />
        </View>
      ) : (
        <ScrollView style={styles.detailsScroll} contentContainerStyle={styles.panelSection}>
          <Text style={styles.label}>Is it working?</Text>
          <View style={styles.actions}>
            <ChoiceAction
              label="Yes"
              selected={state.isWorking}
              disabled={pending}
              onPress={() => onSetWorking(true)}
            />
            <ChoiceAction
              label="No"
              selected={!state.isWorking}
              disabled={pending}
              onPress={() => onSetWorking(false)}
            />
          </View>
          {ratingsLoading ? <Text style={styles.note}>Rating options loading...</Text> : null}
          <RatingFields
            ratingTypes={ratingTypes}
            values={ratings}
            disabled={pending}
            onChange={onSetRatings}
          />
          <Text style={styles.label}>Comment</Text>
          <TextInput
            accessibilityLabel="Comment"
            editable={!pending}
            multiline
            value={comments}
            onChangeText={onSetComments}
            style={[styles.input, styles.textArea]}
          />
          <PointsPreview lines={preview} />
          <SecondaryAction
            label={showMoreDetails ? "Hide More Details" : "More Details"}
            disabled={pending}
            onPress={onToggleMore}
          />
          {showMoreDetails ? (
            attributesLoading ? (
              <Text style={styles.note}>Detail options loading...</Text>
            ) : (
              <AttributeFields
                attributeTypes={attributeTypes}
                values={attributes}
                disabled={pending}
                onChange={onSetAttributes}
              />
            )
          ) : null}
          <View style={styles.actions}>
            <SecondaryAction label="Back" disabled={pending} onPress={onBack} />
            <PrimaryAction label="Add fountain" disabled={pending} onPress={onSubmit} />
          </View>
        </ScrollView>
      )}
      <LiveMessage message={message} />
    </View>
  );
}

function PanelHeader({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <View style={styles.panelHeader}>
      <Text style={styles.panelTitle}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onCancel}>
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </View>
  );
}

function PointsPreview({
  lines,
}: {
  lines: { label: string; points: number; conditional?: boolean }[];
}) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.pointsPreview}>
      <Text
        style={styles.pointsPreviewTitle}
      >{`+${totalPreviewPoints(lines)} possible points`}</Text>
      {lines.map((line) => (
        <Text key={`${line.label}-${line.points}`} style={styles.pointsPreviewLine}>
          {`+${line.points} ${line.label}${line.conditional ? " (conditional)" : ""}`}
        </Text>
      ))}
    </View>
  );
}

function LiveMessage({ message }: { message: { tone: "ok" | "err"; text: string } | null }) {
  if (!message) return null;
  return (
    <Text style={[styles.message, message.tone === "ok" ? styles.ok : styles.err]}>
      {message.text}
    </Text>
  );
}

function PrimaryAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.primaryAction,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={styles.primaryActionText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryAction,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={styles.secondaryActionText}>{label}</Text>
    </Pressable>
  );
}

function ChoiceAction({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choiceAction, selected ? styles.choiceSelected : null]}
    >
      <Text style={[styles.choiceText, selected ? styles.choiceTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

function placementInstruction(placeable: boolean, zoom: number | undefined, pin: LngLat | null) {
  if ((zoom ?? 0) < PLACE_MIN_ZOOM) return "Zoom in, then tap the map or use a placement button.";
  if (!pin) return "Tap the map, use current location, or place at map center.";
  if (!placeable) return "Move the pin inside the allowed placement area.";
  return "Location selected. You can nudge the pin before continuing.";
}

function centerOfBounds(bounds: RawBounds): LngLat {
  return {
    lng: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  };
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
  pointsChip: {
    position: "absolute",
    top: spacing.lg + 44,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pointsText: { ...typography.meta, color: colors.brandBlue, fontWeight: "700" },
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
  addButton: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandYellow,
    borderColor: colors.brandBlue,
    borderWidth: 1,
  },
  addButtonText: { fontSize: 30, lineHeight: 32, fontWeight: "700", color: colors.brandBlue },
  addPanel: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    maxHeight: "62%",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelTitle: { ...typography.heading, color: colors.brandBlue },
  closeText: { fontSize: 28, color: colors.textMuted },
  panelSection: { gap: spacing.sm },
  detailsScroll: { maxHeight: 420 },
  label: { ...typography.body, color: colors.textMuted, fontWeight: "700" },
  coord: { ...typography.meta, color: colors.text },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  nudgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  primaryAction: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryActionText: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
  secondaryAction: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryActionText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  choiceAction: {
    minHeight: 44,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { borderColor: colors.brandBlue, backgroundColor: colors.brandBlue },
  choiceText: { ...typography.body, color: colors.text },
  choiceTextSelected: { color: colors.onBrand, fontWeight: "700" },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    backgroundColor: colors.background,
  },
  textArea: { minHeight: 88, textAlignVertical: "top" },
  pointsPreview: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  pointsPreviewTitle: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  pointsPreviewLine: { ...typography.meta, color: colors.textMuted },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  message: { ...typography.meta },
  ok: { color: "#047857" },
  err: { color: colors.danger },
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
