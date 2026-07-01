import { Ionicons } from "@expo/vector-icons";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { components } from "@fountainrank/api-client";
import { addFountainPointsPreview, totalPreviewPoints } from "@fountainrank/contributions";

import { AttributeFields } from "../../components/add-fountain/AttributeFields";
import { WaterCelebration } from "../../components/feedback/WaterCelebration";
import { FountainMap, type MapFlyTo } from "../../components/map/FountainMap";
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
  centerOfViewport,
  inBound,
  nudgePoint,
  placementEntryTarget,
  type GpsFix,
  type LngLat,
  type ViewportBounds,
} from "../../lib/add-fountain/placement";
import {
  addFountainErrorText,
  addFountainGate,
  addFountainReducer,
  classifyAddConflict,
  initialAddFountainState,
  mapAddFountainError,
  type AddFountainResult,
  type AddFountainState,
} from "../../lib/add-fountain/state";
import { isMapConfigured } from "../../lib/config";
import { isAtCap, normalizeBounds, type RawBounds, shouldLoadPins } from "../../lib/map/bounds";
import { buildClusterIndex, clustersForViewport } from "../../lib/map/cluster";
import { DEFAULT_ZOOM, INITIAL_USER_ZOOM, PLACE_MIN_ZOOM } from "../../lib/map/constants";
import {
  buildBboxQuery,
  DEFAULT_FILTERS,
  type FountainFilters,
  fountainsQueryKey,
} from "../../lib/map/filters";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { subscribeMapAddMode } from "../../lib/navigation/add-tab";
import { resolveViewState, type ViewState } from "../../lib/view-state";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type FountainPin = components["schemas"]["FountainPin"];
type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];
type BboxResult = { pins: FountainPin[]; truncated: boolean };

// Approx height of the top filter-chip bar; used to drop the native compass below
// it so it isn't hidden behind the chips (#105).
const FILTER_BAR_HEIGHT = 44;
const MAP_HEADER_HEIGHT = 72;

export default function MapScreen() {
  const { client, config } = useApi();
  const auth = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const location = useForegroundLocation();
  const insets = useSafeAreaInsets();

  // The map View is full-bleed (not a SafeAreaView), so position the native map
  // ornaments to avoid our overlays and the device safe areas (#104, #105).
  const attributionPosition = { bottom: insets.bottom + spacing.sm, left: spacing.sm };
  const topChromeHeight = insets.top + MAP_HEADER_HEIGHT;
  const compassPosition = {
    top: topChromeHeight + spacing.sm + FILTER_BAR_HEIGHT + spacing.md,
    left: spacing.sm,
  };

  const [filters, setFilters] = useState<FountainFilters>(DEFAULT_FILTERS);
  const [region, setRegion] = useState<{ bounds: RawBounds; zoom: number } | null>(null);
  // The screen owns all camera intent; FountainMap just executes the latest fly
  // command (see MapFlyTo). A fresh object re-issues the fly even to the same spot.
  const [flyTo, setFlyTo] = useState<MapFlyTo | null>(null);
  const didInitialCenterRef = useRef(false);
  const [addState, addDispatch] = useReducer(addFountainReducer, initialAddFountainState);
  const [ratings, setRatings] = useState<Record<number, number | undefined>>({});
  const [attributes, setAttributes] = useState<Record<number, string | undefined>>({});
  const [comments, setComments] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [addMessage, setAddMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [toast, setToast] = useState<{ tone: "err" | "ok"; text: string; nonce: number } | null>(
    null,
  );
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | null>(null);
  const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gate = addFountainGate(auth.status);

  const norm = region ? normalizeBounds(region.bounds) : null;
  const params = norm && !norm.skip ? norm.params : null;
  const zoom = region?.zoom ?? DEFAULT_ZOOM;
  const enabled = isMapConfigured(config) && params != null && shouldLoadPins(zoom);

  const pinsQuery = useQuery({
    queryKey: params ? fountainsQueryKey(params, filters) : ["fountains", "bbox", "idle"],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<BboxResult> => {
      const result = await client.GET("/api/v1/fountains/bbox", {
        params: { query: buildBboxQuery(params!, filters) },
      });
      return {
        pins: unwrap(result),
        truncated: result.response?.headers.get("x-fountainrank-truncated") === "true",
      };
    },
  });

  const contributionsQuery = useQuery({
    queryKey: ["me", "contributions"],
    enabled: auth.status === "authenticated",
    queryFn: async () => unwrap(await client.GET("/api/v1/me/contributions")),
  });
  const refetchContributions = contributionsQuery.refetch;

  useFocusEffect(
    useCallback(() => {
      if (auth.status === "authenticated") {
        void refetchContributions();
      }
    }, [auth.status, refetchContributions]),
  );

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
        const conflict = classifyAddConflict(result.error);
        if (conflict.kind === "needs_name") return { ok: false, error: "needs_name" };
        if (conflict.kind === "duplicate") {
          return { ok: false, error: "duplicate", fountainId: conflict.fountainId };
        }
        return { ok: false, error: "server" };
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

  const showToast = useCallback((tone: "err" | "ok", text: string) => {
    setToast({ tone, text, nonce: Date.now() });
  }, []);

  const resetAddDraft = useCallback(() => {
    addDispatch({ type: "reset" });
    setRatings({});
    setAttributes({});
    setComments("");
    setShowMoreDetails(false);
    setAddMessage(null);
  }, []);

  useEffect(() => {
    if (!addMode) return;
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
  }, [addMode, location.coords, region]);

  useEffect(() => {
    return () => {
      if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
    };
  }, []);

  // Center on the user the first time coords resolve (they arrive after first
  // render, so initialViewState can't). Once only; location is fetched a single
  // time and denial leaves the camera at the default world view.
  useEffect(() => {
    if (didInitialCenterRef.current || !location.coords) return;
    didInitialCenterRef.current = true;
    setFlyTo({
      center: { lng: location.coords.longitude, lat: location.coords.latitude },
      zoom: INITIAL_USER_ZOOM,
    });
  }, [location.coords]);

  // Clustering runs in JS (native clustering is broken on this stack — see
  // lib/map/cluster.ts). The index is rebuilt only when the bbox query returns new
  // data; `keepPreviousData` holds the data stable between fetches so the index — and
  // therefore the rendered clusters — don't flicker while panning. FountainPin[] is
  // directly assignable to PinInput[] (ranking_score/current_status are optional), so
  // no per-pin normalization is needed at the call site.
  const clusterIndex = useMemo(
    () => buildClusterIndex(pinsQuery.data?.pins ?? []),
    [pinsQuery.data],
  );
  // Recompute the visible clusters/points whenever the index OR the viewport changes
  // (pan/zoom). Before the first region is known there is nothing to cluster.
  const featureCollection = useMemo(
    () =>
      region
        ? clustersForViewport(clusterIndex, region.bounds, region.zoom)
        : pinsToFeatureCollection([]),
    [clusterIndex, region],
  );

  const setRegionDebounced = useCallback((bounds: RawBounds, z: number) => {
    if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
    regionTimerRef.current = setTimeout(() => setRegion({ bounds, zoom: z }), 250);
  }, []);

  const enterAddMode = useCallback(() => {
    resetAddDraft();
    setAddMode(true);
    // #97/#98: always zoom to placement zoom AND seed a draft pin, using the user's
    // location when available and the viewport center otherwise — so a user with
    // location denied/approximate can still place (previously they were stuck below
    // PLACE_MIN_ZOOM and every tap was silently rejected).
    if (region) {
      const fix: GpsFix = location.coords
        ? {
            ok: true,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
          }
        : { ok: false };
      const target = placementEntryTarget(fix, region.bounds);
      setFlyTo({ center: target, zoom: PLACE_MIN_ZOOM, framedAboveSheet: true });
      addDispatch({ type: "dropPin", point: target });
    }
    if (!location.coords && (location.status === "denied" || location.status === "unavailable")) {
      showToast(
        "err",
        "Location is unavailable — drop the pin on the map and adjust with the nudge buttons.",
      );
    }
  }, [location.coords, location.status, region, resetAddDraft, showToast]);

  const handleAddTabRequest = useCallback(() => {
    if (gate.state === "ready") {
      enterAddMode();
    } else if (gate.state === "sign_in" || gate.state === "reauth") {
      void auth.signIn();
    }
  }, [auth, enterAddMode, gate.state]);

  useEffect(() => {
    return subscribeMapAddMode(handleAddTabRequest);
  }, [handleAddTabRequest]);

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
  const capped =
    pinsQuery.data != null && (pinsQuery.data.truncated || isAtCap(pinsQuery.data.pins.length));
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
    isEmpty: pinsQuery.isSuccess && (pinsQuery.data?.pins.length ?? 0) === 0,
  });

  const rejectOutOfArea = () => {
    showToast("err", "You can only add fountains near your current location.");
  };

  return (
    <View style={styles.fill}>
      <FountainMap
        styleUrl={config.basemapStyleUrl!}
        featureCollection={featureCollection}
        flyTo={flyTo}
        attributionPosition={attributionPosition}
        compassPosition={compassPosition}
        showUserLocation={location.status === "granted"}
        onRegionChange={setRegionDebounced}
        onPinPress={(id) => router.push(`/fountains/${id}`)}
        // Tapping a cluster flies to the zoom that breaks it apart. supercluster's
        // getClusterExpansionZoom is synchronous (unlike the native Promise) and
        // operates on the same JS index that produced the cluster.
        onClusterPress={(clusterId, center) =>
          setFlyTo({ center, zoom: clusterIndex.getClusterExpansionZoom(clusterId) })
        }
        // #102: only render the draft layer in add mode, so after a successful add
        // its no-onPress layer can't sit over the new real pin and swallow taps.
        draftPin={addMode ? addState.pin : null}
        onMapPressForPlacement={
          gate.state === "ready" && addMode && addState.phase === "placing"
            ? (point) => {
                if (!canPlace(region?.zoom ?? 0, addState.bound)) {
                  // #97: the usual cause is being below placement zoom — say that
                  // instead of the misleading "near your current location" message.
                  showToast("err", "Zoom in a little more to drop the pin here.");
                  return;
                }
                if (addState.bound && !inBound(point, addState.bound)) {
                  rejectOutOfArea();
                  return;
                }
                setAddMessage(null);
                addDispatch({ type: "dropPin", point });
              }
            : undefined
        }
      />

      <MapTopBar
        topInset={insets.top}
        totalPoints={
          auth.status === "authenticated"
            ? (contributionsQuery.data?.stats.total_points ?? 0)
            : null
        }
        onPointsPress={() => {
          const c = region ? centerOfViewport(region.bounds) : null;
          router.push(
            c
              ? { pathname: "/leaderboard", params: { lat: String(c.lat), lng: String(c.lng) } }
              : "/leaderboard",
          );
        }}
      />

      <View
        style={[styles.filterBar, { top: topChromeHeight + spacing.sm }]}
        pointerEvents="box-none"
      >
        <MapFilters filters={filters} onChange={setFilters} />
      </View>

      {location.coords ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Center on my location"
          onPress={() => {
            if (!location.coords) return;
            setFlyTo({
              center: { lng: location.coords.longitude, lat: location.coords.latitude },
              zoom: INITIAL_USER_ZOOM,
            });
          }}
          style={[styles.locate, { bottom: insets.bottom + spacing.lg + 56 }]}
        >
          <Text style={styles.locateGlyph}>◎</Text>
        </Pressable>
      ) : null}

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
            if (!location.coords) {
              showToast(
                "err",
                "Location is unavailable, so placement is limited to this map area.",
              );
              return;
            }
            setAddMessage(null);
            const point = { lng: location.coords.longitude, lat: location.coords.latitude };
            addDispatch({ type: "dropPin", point });
            // #100: recenter the camera on the user (previously it didn't move) and
            // frame the target above the add sheet.
            setFlyTo({ center: point, zoom: PLACE_MIN_ZOOM, framedAboveSheet: true });
          }}
          onPlaceAtCenter={() => {
            if (!region) return;
            const point = centerOfViewport(region.bounds);
            if (addState.bound && !inBound(point, addState.bound)) {
              rejectOutOfArea();
              return;
            }
            setAddMessage(null);
            addDispatch({ type: "dropPin", point });
          }}
          onNudge={(direction) => {
            if (addState.pin && addState.bound) {
              const next = nudgePoint(addState.pin, direction);
              if (!inBound(next, addState.bound)) {
                rejectOutOfArea();
                return;
              }
            }
            addDispatch({ type: "nudge", direction });
          }}
          onNext={() => addDispatch({ type: "next" })}
          onBack={() => addDispatch({ type: "back" })}
          onSetWorking={(isWorking) => addDispatch({ type: "setWorking", isWorking })}
          onCancel={() => {
            resetAddDraft();
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
            const awardedPoints = totalPreviewPoints(
              addFountainPointsPreview({
                ratingsCount: buildRatingsFromStars(ratingTypesQuery.data ?? [], ratings).length,
                observationsCount: buildObservationsFromValues(
                  attributeTypesQuery.data ?? [],
                  attributes,
                ).length,
                hasComment: comments.trim().length > 0,
              }),
            );
            addDispatch({ type: "submitStart" });
            try {
              const result = await addMutation.mutateAsync(payload.value);
              if (result.ok) {
                addDispatch({ type: "created", fountainId: result.fountainId });
                setCelebrationPoints(awardedPoints);
                setCelebrationKey((key) => key + 1);
                setAddMode(false);
                router.push(`/fountains/${result.fountainId}`);
                return;
              }
              if (result.error === "duplicate") {
                addDispatch({ type: "duplicate", fountainId: result.fountainId });
                setAddMessage({ tone: "err", text: "A fountain already exists here." });
                return;
              }
              if (result.error === "needs_name") {
                // The name gate: retrying won't help — close add mode and send to the account
                // capture screen (kill Anonymous). The backend already rejected the write.
                addDispatch({ type: "reset" });
                setAddMode(false);
                router.push("/account");
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

      {/* #101: hide the empty/capped/below-zoom banner while adding, so it can't
          cover the add panel / Add button. */}
      {addMode ? null : (
        <MapOverlay
          belowZoom={belowZoom}
          viewState={viewState}
          capped={capped}
          onRetry={() => void pinsQuery.refetch()}
        />
      )}
      <MobileToast toast={toast} onDismiss={() => setToast(null)} />
      <WaterCelebration triggerKey={celebrationKey} points={celebrationPoints} />
    </View>
  );
}

function MapTopBar({
  topInset,
  totalPoints,
  onPointsPress,
}: {
  topInset: number;
  totalPoints: number | null;
  onPointsPress: () => void;
}) {
  return (
    <View style={[styles.mapTopBar, { paddingTop: topInset + spacing.sm }]}>
      <View style={styles.brandLockup}>
        <View style={styles.brandMark}>
          <Image source={require("../../assets/icon.png")} style={{ width: 24, height: 24 }} resizeMode="contain" />
        </View>
        <View>
          <Text style={styles.brandName}>FountainRank</Text>
          <Text style={styles.brandSubline}>Map</Text>
        </View>
      </View>
      {totalPoints != null ? <PointsChip total={totalPoints} onPress={onPointsPress} /> : null}
    </View>
  );
}

function PointsChip({ total, onPress }: { total: number; onPress: () => void }) {
  const [scale] = useState(() => new Animated.Value(0.94));
  const [display, setDisplay] = useState(total);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          setDisplay(total);
          return;
        }
        setDisplay(0);
        const steps = 12;
        let frame = 0;
        timer = setInterval(() => {
          if (cancelled) return;
          frame += 1;
          setDisplay(Math.round((total * frame) / steps));
          if (frame >= steps && timer) {
            clearInterval(timer);
            timer = null;
          }
        }, 30);
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.08, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
        ]).start();
      })
      .catch(() => {
        if (!cancelled) setDisplay(total);
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [scale, total]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View leaderboard — ${total} points`}
      onPress={onPress}
      style={styles.pointsChipWrap}
    >
      <Animated.View style={[styles.pointsChip, { transform: [{ scale }] }]}>
        <Text style={styles.pointsLabel}>Points</Text>
        <Text style={styles.pointsText}>{display}</Text>
      </Animated.View>
    </Pressable>
  );
}

function MobileToast({
  toast,
  onDismiss,
}: {
  toast: { tone: "err" | "ok"; text: string; nonce: number } | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 3200);
    AccessibilityInfo.announceForAccessibility(toast.text);
    return () => clearTimeout(timer);
  }, [onDismiss, toast]);

  if (!toast) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.toast, toast.tone === "err" ? styles.toastErr : styles.toastOk]}
    >
      <Text style={styles.toastText}>{toast.text}</Text>
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
  mapTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: MAP_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.brandBlue,
    borderBottomColor: colors.brandYellow,
    borderBottomWidth: 2,
  },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E4DA4",
    borderColor: colors.brandYellow,
    borderWidth: 1,
  },
  brandName: { ...typography.heading, color: colors.onBrand, fontWeight: "800" },
  brandSubline: { ...typography.meta, color: "#BFDBFE", fontWeight: "700" },
  filterBar: { position: "absolute", left: 0, right: 0 },
  pointsChipWrap: {},
  pointsChip: {
    backgroundColor: "#06306F",
    borderColor: colors.brandYellow,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 76,
    alignItems: "center",
  },
  pointsLabel: { ...typography.meta, color: colors.onBrand, fontWeight: "700" },
  pointsText: { fontSize: 22, lineHeight: 26, color: colors.brandYellow, fontWeight: "800" },
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
    backgroundColor: "#EFF6FF",
    borderColor: colors.brandBlue,
    borderWidth: 2,
    borderRadius: 8,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  pointsPreviewTitle: { ...typography.heading, color: colors.brandBlue, fontWeight: "800" },
  pointsPreviewLine: { ...typography.meta, color: colors.text, fontWeight: "600" },
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
  toast: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    top: spacing.lg,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
  },
  toastErr: { backgroundColor: "#FEE2E2", borderColor: colors.danger },
  toastOk: { backgroundColor: "#D1FAE5", borderColor: "#047857" },
  toastText: { ...typography.body, color: colors.text, fontWeight: "700" },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
});
