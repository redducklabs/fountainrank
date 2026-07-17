import { Ionicons } from "@expo/vector-icons";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  ActivityIndicator,
  BackHandler,
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

import { awardedPoints } from "../../lib/awarded-points";

import { AttributeFields } from "../../components/add-fountain/AttributeFields";
import { WaterCelebration } from "../../components/feedback/WaterCelebration";
import { FountainMap, type MapFlyTo } from "../../components/map/FountainMap";
import { MapFilters } from "../../components/map/MapFilters";
import { SearchOverlay } from "../../components/map/SearchOverlay";
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
  centerOfViewport,
  placementEntryTarget,
  type GpsFix,
  type LngLat,
  type ViewportBounds,
} from "../../lib/add-fountain/placement";
import {
  createPlacementCoordinator,
  type PlacementCoordinator,
} from "../../lib/add-fountain/placement-coordinator";
import {
  addFountainErrorText,
  addFountainGate,
  addFountainReducer,
  classifyAddConflict,
  classifyAddSubmitFailure,
  initialAddFountainState,
  type AddFountainResult,
  type AddFountainState,
} from "../../lib/add-fountain/state";
import { logEvent } from "../../lib/log";
import { isMapConfigured } from "../../lib/config";
import { handleAddSuccess } from "../../lib/add-fountain/seed";
import { isAtCap, normalizeBounds, type RawBounds, shouldLoadPins } from "../../lib/map/bounds";
import {
  initialCameraState,
  nextCameraPolicy,
  type CameraEvent,
} from "../../lib/map/camera-policy";
import { buildClusterIndex, clustersForViewport } from "../../lib/map/cluster";
import { BBOX_STALE_TIME_MS, DEFAULT_ZOOM, PLACE_MIN_ZOOM } from "../../lib/map/constants";
import { locateButtonDescriptor, type LocateButtonDescriptor } from "../../lib/map/locate-button";
import {
  OPEN_SETTINGS_ACTION_LABEL,
  SETTINGS_OPEN_FAILED_TEXT,
  toastAutoDismissMs,
} from "../../lib/map/toast";
import {
  buildBboxQuery,
  DEFAULT_FILTERS,
  type FountainFilters,
  fountainsQueryKey,
} from "../../lib/map/filters";
import { resolveMapOverlay } from "../../lib/map/overlay";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { shouldClearSearchMarker } from "../../lib/map-search/marker";
import {
  deriveDebounceKey,
  initialSearchState,
  nextRequestSeq,
  searchReducer,
  type SearchResultItem,
} from "../../lib/map-search/state";
import { mapGeocodeError, searchGeocode } from "../../lib/map-search/query";
import { subscribeMapAddMode } from "../../lib/navigation/add-tab";
import { subscribeMapSearch } from "../../lib/navigation/map-search";
import { resolveViewState, type ViewState } from "../../lib/view-state";
import { useApi } from "../../providers/api-provider";
import { useAuth } from "../../providers/auth-provider";
import { colors, spacing, typography } from "../../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type FountainPin = components["schemas"]["FountainPin"];
type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];
type BboxResult = { pins: FountainPin[]; truncated: boolean };
// An actionable toast (spec §3): the optional action renders a tappable label and extends the
// auto-dismiss window; tapping it dismisses the toast and invokes the handler.
type ToastAction = { label: string; onPress: () => void | Promise<void> };
type ToastState = { tone: "err" | "ok"; text: string; nonce: number; action?: ToastAction };

// Approx height of the top filter-chip bar; used to drop the native compass below
// it so it isn't hidden behind the chips (#105).
const FILTER_BAR_HEIGHT = 44;
const MAP_HEADER_HEIGHT = 72;
// Spec §7.1: debounce the geocode call ~300ms after the user stops typing.
const SEARCH_DEBOUNCE_MS = 300;

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
  // Camera policy state (spec §6). Refs, not render-read state: the one-shot is read only inside
  // effects/callbacks (never during render), consistent with the React-Compiler rule. `locateActive`
  // marks a locate gesture as owning the camera so the incoming refresh fix doesn't double-center.
  const cameraStateRef = useRef(initialCameraState);
  const locateActiveRef = useRef(false);
  const runCamera = useCallback((event: CameraEvent) => {
    const { state, command } = nextCameraPolicy(cameraStateRef.current, event);
    cameraStateRef.current = state;
    if (command) {
      setFlyTo({
        center: command.center,
        zoom: command.zoom,
        framedAboveSheet: command.framedAboveSheet,
      });
    }
  }, []);
  const [addState, addDispatch] = useReducer(addFountainReducer, initialAddFountainState);
  const [ratings, setRatings] = useState<Record<number, number | undefined>>({});
  const [attributes, setAttributes] = useState<Record<number, string | undefined>>({});
  const [comments, setComments] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [addMessage, setAddMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | null>(null);
  const regionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchState, searchDispatch] = useReducer(searchReducer, initialSearchState);
  // The transient "searched location" marker (spec §7.1) - set on result select,
  // cleared via `shouldClearSearchMarker` (see setRegionDebounced/openSearch/
  // onMapPress/onPinPress below).
  const [searchMarker, setSearchMarker] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  // Mirrors the latest render's value into a ref (in an effect - not during render,
  // react-hooks/refs) so the debounce effect below (which only re-runs when the
  // debounce KEY changes, not on every keystroke/response) can still read the current
  // seq/region without those unrelated changes tearing down and restarting its own
  // in-flight request (see that effect's comment). Declared with no dependency array
  // so it runs after every render, and - because effects run in declaration order -
  // always before the debounce effect further down on the same commit.
  const searchStateRef = useRef(searchState);
  useEffect(() => {
    searchStateRef.current = searchState;
  });
  const regionRef = useRef(region);
  useEffect(() => {
    regionRef.current = region;
  });
  const gate = addFountainGate(auth.status);

  const norm = region ? normalizeBounds(region.bounds) : null;
  const params = norm && !norm.skip ? norm.params : null;
  const zoom = region?.zoom ?? DEFAULT_ZOOM;
  const enabled = isMapConfigured(config) && params != null && shouldLoadPins(zoom);

  const pinsQuery = useQuery({
    queryKey: params ? fountainsQueryKey(params, filters) : ["fountains", "bbox", "idle"],
    enabled,
    placeholderData: keepPreviousData,
    // Scoped to this query (global defaults unchanged): skip a redundant refetch on pan-back to
    // a fresh, non-invalidated viewport. The post-add invalidation still overrides this (spec §4).
    staleTime: BBOX_STALE_TIME_MS,
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
        return {
          ok: true,
          fountainId: result.data.id,
          pointsAwarded: awardedPoints(result.data),
          // The POST already returned the full FountainDetail — carry it so onSuccess can seed
          // the detail + map-pin caches with no second round-trip (spec §3).
          detail: result.data,
        };
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
    // Seed the detail + map-pin caches from the create response, THEN invalidate (spec §3), so
    // the new fountain renders instantly and cannot vanish on a failed refetch.
    onSuccess: (result) => handleAddSuccess(queryClient, result),
  });

  const showToast = useCallback((tone: "err" | "ok", text: string, action?: ToastAction) => {
    setToast({ tone, text, nonce: Date.now(), action });
  }, []);

  const resetAddDraft = useCallback(() => {
    addDispatch({ type: "reset" });
    setRatings({});
    setAttributes({});
    setComments("");
    setShowMoreDetails(false);
    setAddMessage(null);
  }, []);

  // The placement coordinator (spec §6): every placement callback binds DIRECTLY to one of its
  // methods. It shares the reducer's `evaluatePlacement` validator, so its immediate toast/camera
  // effects and the reducer's authoritative transition can never diverge. Constructed inside an
  // effect (never during render) and held in a ref, because it captures `runCamera` (which reads the
  // camera-state ref) - the same React-Compiler `react-hooks/refs`-safe pattern as `createGuardedSubmit`.
  const placementCoordinatorRef = useRef<PlacementCoordinator | null>(null);
  useEffect(() => {
    placementCoordinatorRef.current = createPlacementCoordinator({
      dispatch: addDispatch,
      clearMessage: () => setAddMessage(null),
      runCamera,
      toastOutOfArea: () =>
        showToast("err", "You can only add fountains near your current location."),
      toastZoomIn: () => showToast("err", "Zoom in a little more to drop the pin here."),
    });
  }, [runCamera, showToast]);

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

  // Center on the user the first time a fix resolves (spec §6). The camera policy centers exactly
  // once; later live-watch fixes move the blue dot but not the camera. Skipped while a locate gesture
  // owns the camera, so a locate press that yields the first fix moves the camera exactly once.
  useEffect(() => {
    if (!location.coords) return;
    if (locateActiveRef.current) return;
    runCamera({
      type: "fix",
      source: "watch",
      coords: { lng: location.coords.longitude, lat: location.coords.latitude },
    });
  }, [location.coords, runCamera]);

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

  const setRegionDebounced = useCallback(
    (bounds: RawBounds, z: number, userInteraction: boolean) => {
      if (regionTimerRef.current) clearTimeout(regionTimerRef.current);
      regionTimerRef.current = setTimeout(() => setRegion({ bounds, zoom: z }), 250);
      // Spec §7.1: a region change only clears the search-result marker when it was a
      // user gesture (pan/zoom) - NOT the programmatic `setFlyTo` that placed it.
      // Checked immediately (not debounced) so the marker disappears as soon as the
      // user starts panning, same as the native region-change event itself.
      if (shouldClearSearchMarker({ userInteraction, cause: "region" })) {
        setSearchMarker(null);
      }
    },
    [],
  );

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
      // Pre-bound seed acceptance: the reset above cleared the bound, so the coordinator accepts and
      // recenters via the camera policy.
      placementCoordinatorRef.current?.enterSeed(target);
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

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchDispatch({ type: "reset" });
  }, []);

  const openSearch = useCallback(() => {
    searchDispatch({ type: "reset" });
    setSearchOpen(true);
    // Spec §7.1: starting a new search clears any marker left by a previous one.
    if (shouldClearSearchMarker({ userInteraction: true, cause: "newSearch" })) {
      setSearchMarker(null);
    }
  }, []);

  useEffect(() => {
    return subscribeMapSearch(openSearch);
  }, [openSearch]);

  // Android hardware-back dismisses the overlay (and, via the debounce effect's
  // cleanup below reacting to `searchOpen` flipping to false, aborts any in-flight
  // request) instead of leaving the app/falling through to the default back behavior.
  useEffect(() => {
    if (!searchOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [searchOpen, closeSearch]);

  const handleSearchQueryChange = useCallback((text: string) => {
    searchDispatch({ type: "queryChanged", query: text });
  }, []);

  const handleSearchSelect = useCallback(
    (result: SearchResultItem) => {
      closeSearch();
      setFlyTo({ center: { lat: result.latitude, lng: result.longitude }, zoom: PLACE_MIN_ZOOM });
      // Spec §7.1: drop the transient marker at the selected location. The
      // immediately-following region change from this same `setFlyTo` is
      // programmatic (`userInteraction: false`), so it will NOT clear the marker
      // we just set (see setRegionDebounced) - only a subsequent user gesture will.
      setSearchMarker({ latitude: result.latitude, longitude: result.longitude });
    },
    [closeSearch],
  );

  // Debounced, abortable geocode request (spec §7.1). Keyed off `deriveDebounceKey`
  // (not the raw query) so an edit that normalizes to the same trimmed text - e.g. a
  // trailing space typed then removed - doesn't restart the timer/cancel the in-flight
  // request for an unchanged effective query. Deliberately does NOT depend on
  // `searchState`/`region` directly: both change as a *result* of this very effect
  // (dispatching requestStarted/resultsReceived, or the map panning while a search is
  // open) and including them would tear down and restart the debounce/abort purely
  // because of the response it just received. `searchStateRef`/`regionRef` (updated
  // every render, above) give this effect the current seq/bias without that.
  const searchDebounceKey = deriveDebounceKey(searchState.query);
  useEffect(() => {
    if (!searchOpen) return;
    if (searchDebounceKey == null) return;
    const controller = new AbortController();
    const seq = nextRequestSeq(searchStateRef.current);
    const timer = setTimeout(() => {
      searchDispatch({ type: "requestStarted", seq });
      const bias = regionRef.current ? centerOfViewport(regionRef.current.bounds) : null;
      searchGeocode(client, {
        q: searchDebounceKey,
        lat: bias?.lat,
        lng: bias?.lng,
        signal: controller.signal,
      })
        .then((results) => {
          searchDispatch({ type: "resultsReceived", seq, results });
        })
        .catch((error: unknown) => {
          // An aborted request's rejection carries no useful reason - the request was
          // superseded/cancelled, not "failed"; the stale-seq guard in the reducer
          // would drop it anyway, but skip the dispatch entirely for clarity.
          if (controller.signal.aborted) return;
          searchDispatch({ type: "requestFailed", seq, reason: mapGeocodeError(error) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, searchDebounceKey, searchOpen]);

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
        onPinPress={(id) => {
          // Spec §7.1: selecting a fountain pin clears the search-result marker.
          if (shouldClearSearchMarker({ userInteraction: true, cause: "pinSelect" })) {
            setSearchMarker(null);
          }
          router.push(`/fountains/${id}`);
        }}
        // Tapping a cluster flies to the zoom that breaks it apart. supercluster's
        // getClusterExpansionZoom is synchronous (unlike the native Promise) and
        // operates on the same JS index that produced the cluster.
        onClusterPress={(clusterId, center) =>
          setFlyTo({ center, zoom: clusterIndex.getClusterExpansionZoom(clusterId) })
        }
        // #102: only render the draft layer in add mode, so after a successful add
        // its no-onPress layer can't sit over the new real pin and swallow taps.
        draftPin={addMode ? addState.pin : null}
        searchMarker={searchMarker}
        // Fires on every plain map press (independent of add-mode placement below) -
        // clears the search-result marker on a tap (spec §7.1).
        onMapPress={() => {
          if (shouldClearSearchMarker({ userInteraction: true, cause: "press" })) {
            setSearchMarker(null);
          }
        }}
        onMapPressForPlacement={
          gate.state === "ready" && addMode && addState.phase === "placing"
            ? (point) =>
                placementCoordinatorRef.current?.mapTap(point, addState.bound, region?.zoom ?? 0)
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

      <LocateButton
        descriptor={locateButtonDescriptor({
          status: location.status,
          refreshing: location.refreshing,
          canAskAgain: location.canAskAgain,
        })}
        bottom={insets.bottom + spacing.lg + 56}
        onPress={async () => {
          // A locate gesture owns the camera for its duration (spec §6), so the fix effect skips the
          // incoming refresh fix and the combined "press yields the first fix" case still moves the
          // camera exactly once regardless of effect/microtask ordering.
          locateActiveRef.current = true;
          try {
            // Recenter on the best-known fix IMMEDIATELY so the button always responds (#144). Then
            // upgrade to the fresh fix if one resolves; `refresh()` is timeout-bounded in the hook,
            // so it always settles and never bricks later presses.
            const known = location.coords;
            if (known) {
              runCamera({
                type: "locatePress",
                coords: { lng: known.longitude, lat: known.latitude },
              });
            }
            // Branch on the SAME call's rich outcome (spec §3), never separately-scheduled state.
            const outcome = await location.refresh();
            if (outcome.kind === "granted") {
              runCamera({
                type: "locatePress",
                coords: { lng: outcome.coords.longitude, lat: outcome.coords.latitude },
              });
            } else if (outcome.kind === "denied" && !outcome.canAskAgain) {
              // The OS will not re-prompt: offer an explicit "Open settings" action (not an automatic
              // redirect). On the SAME press (fresh outcome), and the open-failure falls back to a
              // plain replacement toast (spec §3).
              showToast("err", "Location access is off. Open Settings to enable it.", {
                label: OPEN_SETTINGS_ACTION_LABEL,
                onPress: async () => {
                  const result = await location.openSettings();
                  if (result.kind === "failed") showToast("err", SETTINGS_OPEN_FAILED_TEXT);
                },
              });
            }
          } finally {
            locateActiveRef.current = false;
          }
        }}
      />

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
            const point = { lng: location.coords.longitude, lat: location.coords.latitude };
            placementCoordinatorRef.current?.useCurrentLocation(point, addState.bound);
          }}
          onPlaceAtCenter={() => {
            if (!region) return;
            placementCoordinatorRef.current?.placeAtCenter(
              centerOfViewport(region.bounds),
              addState.bound,
            );
          }}
          onNudge={(direction) =>
            placementCoordinatorRef.current?.nudge(direction, addState.pin, addState.bound)
          }
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
            addDispatch({ type: "submitStart" });
            try {
              const result = await addMutation.mutateAsync(payload.value);
              if (result.ok) {
                addDispatch({ type: "created", fountainId: result.fountainId });
                // The server's award (bonuses included) — not the client-side preview total this
                // used to celebrate (#204). Gate on a real award, like every other path.
                if (result.pointsAwarded > 0) {
                  setCelebrationPoints(result.pointsAwarded);
                  setCelebrationKey((key) => key + 1);
                }
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
              const { error: mapped, outcome } = classifyAddSubmitFailure(error);
              if (mapped === "unauthenticated") auth.markReauthRequired();
              // Mark the outcome-unknown branch distinctly from an ordinary failure so it is
              // diagnosable from logs (spec §2). The draft is preserved by `submitError` (the
              // panel stays on the details step), so an unchanged retry reconciles.
              if (outcome) {
                logEvent(
                  outcome.reason === "deadline"
                    ? {
                        event: "add_fountain_outcome_unknown",
                        reason: "deadline",
                        timeout_ms: outcome.timeout_ms,
                      }
                    : { event: "add_fountain_outcome_unknown", reason: "network_failure" },
                );
              }
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
          refetching={enabled && pinsQuery.isFetching && !pinsQuery.isLoading}
          capped={capped}
          // isError with retained pins → the stale-pins banner keeps showing saved data (#244);
          // isError with no data (new-key failure) → the full offline/error overlay (spec §5).
          stalePins={pinsQuery.isError && pinsQuery.data != null}
          // Spec §5: while acquiring the first fix, show "Locating you…" instead of the misleading
          // below-zoom hint (a real offline/error still wins).
          locating={location.status === "locating"}
          onRetry={() => void pinsQuery.refetch()}
        />
      )}
      <MobileToast toast={toast} onDismiss={() => setToast(null)} />
      <WaterCelebration triggerKey={celebrationKey} points={celebrationPoints} />

      {searchOpen ? (
        <SearchOverlay
          state={searchState}
          topInset={insets.top}
          onQueryChange={handleSearchQueryChange}
          onSelect={handleSearchSelect}
          onClose={closeSearch}
        />
      ) : null}
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
          <Image
            source={require("../../assets/logo-pin.png")}
            style={{ width: 34, height: 34 }}
            resizeMode="contain"
          />
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

function MobileToast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const action = toast?.action;
  useEffect(() => {
    if (!toast) return;
    // An action present extends the dismiss window so the user can reach for it (spec §3).
    const timer = setTimeout(onDismiss, toastAutoDismissMs(action != null));
    AccessibilityInfo.announceForAccessibility(toast.text);
    return () => clearTimeout(timer);
  }, [onDismiss, toast, action]);

  if (!toast) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.toast, toast.tone === "err" ? styles.toastErr : styles.toastOk]}
    >
      <Text style={styles.toastText}>{toast.text}</Text>
      {toast.action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          onPress={() => {
            // Tapping the action dismisses the toast and invokes it (spec §3).
            onDismiss();
            void toast.action!.onPress();
          }}
          style={styles.toastAction}
        >
          <Text style={styles.toastActionText}>{toast.action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LocateButton({
  descriptor,
  bottom,
  onPress,
}: {
  descriptor: LocateButtonDescriptor;
  bottom: number;
  onPress: () => void | Promise<void>;
}) {
  // The button is always mounted (no coords gate, spec §4). It consumes the descriptor's fields
  // directly - the only screen-side mapping is the structural tone → theme color.
  return (
    <Pressable
      accessibilityRole={descriptor.accessibilityRole}
      accessibilityLabel={descriptor.accessibilityLabel}
      accessibilityHint={descriptor.accessibilityHint}
      accessibilityState={descriptor.accessibilityState}
      onPress={() => {
        void onPress();
      }}
      style={[styles.locate, { bottom }]}
    >
      {descriptor.visual.kind === "spinner" ? (
        <ActivityIndicator size="small" color={colors.brandBlue} />
      ) : (
        <Ionicons
          name="locate"
          size={22}
          color={descriptor.visual.tone === "brand" ? colors.brandBlue : colors.textMuted}
        />
      )}
    </Pressable>
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
          <Text style={styles.note}>{placementInstruction(region?.zoom, state.pin)}</Text>
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
            // Eligibility derives from an ACCEPTED pin (spec §6): a pin only enters state via a
            // bound-validated action, so `state.pin != null` already means it was placeable when
            // dropped. It stays submittable even if the live bound later moves away (walked-away).
            disabled={!state.pin || pending}
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
            <PrimaryAction
              label="Add fountain"
              disabled={pending}
              pending={pending}
              onPress={onSubmit}
            />
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
  pending = false,
  onPress,
}: {
  label: string;
  disabled: boolean;
  pending?: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: pending }}
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
      {pending ? <ActivityIndicator size="small" color={colors.onBrand} /> : null}
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

function placementInstruction(zoom: number | undefined, pin: LngLat | null) {
  // Once a pin is accepted it stays selected/submittable (spec §6) regardless of the live bound, so
  // the guidance keys off the pin's existence, not a live in-bound recheck.
  if (!pin && (zoom ?? 0) < PLACE_MIN_ZOOM) {
    return "Zoom in, then tap the map or use a placement button.";
  }
  if (!pin) return "Tap the map, use current location, or place at map center.";
  return "Location selected. You can nudge the pin before continuing.";
}

function MapOverlay(props: {
  belowZoom: boolean;
  viewState: ViewState;
  refetching: boolean;
  capped: boolean;
  stalePins: boolean;
  locating: boolean;
  onRetry: () => void;
}) {
  // The overlay's copy + accessibility contract is a pure decision (`resolveMapOverlay`), unit
  // tested node-safe; this component is a thin renderer of that model. A background refetch (a
  // filter change or a pan after the first load) doesn't flip `isLoading`, so it shows a quiet
  // banner spinner (#212); a failed refetch with retained pins shows the stale-pins alert (#244).
  const model = resolveMapOverlay(props);
  if (model.kind === "hidden") return null;

  return (
    <View
      style={styles.banner}
      pointerEvents="box-none"
      accessibilityRole={model.accessibilityRole}
      accessibilityLiveRegion={model.accessibilityLiveRegion}
    >
      {model.spinner ? (
        <ActivityIndicator
          color={colors.brandBlue}
          accessibilityRole="progressbar"
          accessibilityLabel={
            model.spinner === "updating" ? "Updating fountains" : "Loading fountains"
          }
        />
      ) : null}
      {model.message ? (
        <Text style={styles.bannerText} onPress={model.retryable ? props.onRetry : undefined}>
          {model.message}
          {model.retryable ? " — tap to retry" : ""}
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
    alignItems: "center",
    justifyContent: "center",
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
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
  toastAction: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  toastActionText: { ...typography.body, color: colors.brandBlue, fontWeight: "800" },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
});
