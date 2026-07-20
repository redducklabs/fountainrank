"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import maplibregl, {
  type LayerSpecification,
  type MapLayerMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import { createPlacementMap, type PlacementMap } from "./placement-map";
import { useAddFountainMode } from "./useAddFountainMode";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleUrlFor, themedPinAssets, themedPillBg } from "../../lib/map/style";
import { mapColorsFor } from "../../lib/map/colors";
import { fetchBbox, fetchPublicFountain, type FountainPin } from "../../lib/fountains";
import { resolveApiBaseUrl } from "../../lib/api";
import { CONTRIBUTION_EVENT, contributionPoints } from "../../lib/contribution-event";
import { pinsToFeatureCollection, type PinInput } from "../../lib/map/pins";
import { normalizeBounds, shouldLoadPins, isAtCap } from "../../lib/map/bounds";
import {
  EMPTY_FC,
  fountainsSource,
  clusterCircleLayer,
  clusterCountLayer,
  pinLayer,
  pillLayer,
  selectedHaloLayer,
  selectedPinLayer,
  selectedFountainFilter,
} from "../../lib/map/layers";
import {
  DEBOUNCE_MS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  GEOLOCATE_TIMEOUT_MS,
  NEIGHBORHOOD_ZOOM,
} from "../../lib/map/constants";
import { resolveActiveId } from "../../lib/map/active-id";
import { hrefWithoutFocus } from "../../lib/map/focus-url";
import {
  detailToPin,
  focusCameraAction,
  mergeFocusedPin,
  shouldMoveToStartupLocation,
} from "../../lib/map/focus";
import { logMapError } from "../../lib/map/log";
import { deriveCameraAction, parseFlyToParam } from "../../lib/search/flyto";
import { FountainsInViewList } from "./FountainsInViewList";
import {
  CapHint,
  EmptyHint,
  ErrorToast,
  LoadingBar,
  UnsupportedHint,
  WaterCelebration,
  ZoomInHint,
} from "./MapStates";

type Status = "idle" | "loading" | "empty" | "error" | "belowZoom" | "capped";

// MapLibre v5 needs a WebGL2 context. Probe once with default attributes (matching the map's
// powerPreference:'default' below) so we can render a graceful hint instead of throwing/crashing.
function isWebglSupported(): boolean {
  if (typeof window === "undefined" || !("WebGL2RenderingContext" in window)) return false;
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

// Diagnostic only (shown behind ?debug): the GPU vendor/renderer string. On Android this
// reveals the GLES driver (Adreno/Mali/...) so we can correlate a mobile-only blank basemap
// with the device's GPU.
function webglInfo(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "no-webgl2";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = String(
      dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    );
    const renderer = String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    return `${vendor} | ${renderer}`;
  } catch {
    return "probe-failed";
  }
}

// next-themes exposes `resolvedTheme` as an arbitrary string ("light" | "dark" | undefined
// before hydration). Collapse it to the two map flavors — anything that isn't "dark" is light.
const resolveTheme = (t?: string): "light" | "dark" => (t === "dark" ? "dark" : "light");

// SSR-safe mount detection via useSyncExternalStore (NOT a mount useEffect+setState, which the
// project's react-hooks/set-state-in-effect lint rule forbids — see ThemeToggle/AnalyticsConsent
// for the established pattern). Server snapshot is `false` so the map is not built during SSR /
// first paint (before next-themes resolves the theme); the client snapshot is `true`, flipping to
// build the map at the already-resolved theme (no light→dark basemap flash for dark users).
function subscribeMounted(): () => void {
  return () => {};
}
function getMountedSnapshot(): boolean {
  return true;
}
function getServerMountedSnapshot(): boolean {
  return false;
}

export default function MapBrowser({
  isAuthenticated = false,
  autoEnterAdd = false,
  hadAddParam = false,
}: {
  isAuthenticated?: boolean;
  autoEnterAdd?: boolean;
  hadAddParam?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadSeqRef = useRef(0);
  const [placementMap, setPlacementMap] = useState<PlacementMap | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus") ?? "";
  const focusIdRef = useRef(focusId);
  // eslint-disable-next-line react-hooks/refs -- native MapLibre callbacks require the latest URL owner.
  focusIdRef.current = focusId;
  const pathnameRef = useRef(pathname);
  const searchRef = useRef(searchParams.toString());
  // eslint-disable-next-line react-hooks/refs -- native callbacks need the latest URL snapshot.
  pathnameRef.current = pathname;
  // eslint-disable-next-line react-hooks/refs -- native callbacks need the latest URL snapshot.
  searchRef.current = searchParams.toString();
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  // Latest-value refs so the ONE-TIME map listeners and the async load()/installOverlay read the
  // current theme / pins / selection without being re-registered (which would double-fire).
  const themeRef = useRef<"light" | "dark">("light");
  const pinsRef = useRef<PinInput[]>([]);
  const bboxPinsRef = useRef<FountainPin[]>([]);
  const focusedPinRef = useRef<FountainPin | null>(null);
  const consumedFocusRef = useRef<string | null>(null);
  const activeIdRef = useRef<string>("");
  // Generation counter bumped on every setStyle: an in-flight installOverlay/load() from a prior
  // theme aborts once it sees a newer generation (prevents seeding the new overlay with stale data
  // or installing layers on a superseded style).
  const styleGenRef = useRef(0);
  // Tracks the theme the basemap style was last setStyle-targeted to (set at map-init and on every
  // theme-swap setStyle call) — NOT the theme of the last *installed* overlay (installOverlay can
  // still be in flight when a rapid toggle fires). Guarding the swap effect on this instead of an
  // "installed" marker prevents a stale-read early-return that would strand the basemap on the
  // wrong theme mid-swap.
  const styleThemeRef = useRef<"light" | "dark">("light");
  const placementRef = useRef<PlacementMap | null>(null);
  const [pins, setPins] = useState<FountainPin[]>([]);
  const [focusedPin, setFocusedPin] = useState<FountainPin | null>(null);
  const [focusStatus, setFocusStatus] = useState<
    "idle" | "loading" | "found" | "not-found" | "error"
  >(focusId ? "loading" : "idle");
  const [pendingDetail, setPendingDetail] = useState<{ id: string; failed: boolean } | null>(null);
  const pendingDetailRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [locateStatus, setLocateStatus] = useState<"locating" | "resolved">("locating");
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | undefined>(undefined);
  const [webglOk] = useState(isWebglSupported);
  // `?focus=<id>` (from the city-list / my-fountains "See on Map" links) wins over the path so
  // the map highlights that fountain on `/`; otherwise the id comes from `/fountains/<id>`.
  const activeId = pendingDetail?.id ?? resolveActiveId(searchParams.get("focus"), pathname);
  const [syncedFocusId, setSyncedFocusId] = useState(focusId);
  if (syncedFocusId !== focusId) {
    setSyncedFocusId(focusId);
    setFocusedPin(null);
    setFocusStatus(focusId ? "loading" : "idle");
  }
  const add = useAddFountainMode(placementMap, {
    isAuthenticated,
    webglOk,
    autoEnter: autoEnterAdd,
    hadAddParam,
  });

  const clearFocus = useCallback(
    (beforeDetailNavigation = false) => {
      const ownedFocus = focusIdRef.current;
      if (!ownedFocus) return;
      focusIdRef.current = "";
      focusedPinRef.current = null;
      consumedFocusRef.current = null;
      setFocusedPin(null);
      setFocusStatus("idle");
      const base = bboxPinsRef.current;
      setPins(base);
      const inputs = base.map((pin) => ({ ...pin, ranking_score: pin.ranking_score ?? null }));
      pinsRef.current = inputs;
      (mapRef.current?.getSource("fountains") as GeoJSONSource | undefined)?.setData(
        pinsToFeatureCollection(inputs, themeRef.current),
      );
      const cleanHref = hrefWithoutFocus(pathnameRef.current, searchRef.current);
      if (beforeDetailNavigation) {
        // Clean the current map history entry synchronously before pushing detail. Otherwise closing
        // the intercepted detail would Back-navigate to the stale deep-link focus and resurrect it.
        window.history.replaceState(window.history.state, "", cleanHref);
      } else {
        router.replace(cleanHref, { scroll: false });
      }
    },
    [router],
  );

  const openDetail = useCallback(
    (id: string) => {
      if (pendingDetailRef.current) return;
      clearFocus(true);
      pendingDetailRef.current = id;
      setPendingDetail({ id, failed: false });
      try {
        router.push(`/fountains/${id}`);
        pendingTimerRef.current = setTimeout(() => {
          logMapError("detail-navigation-timeout", { id });
          pendingDetailRef.current = null;
          setPendingDetail({ id, failed: true });
        }, 15000);
      } catch (error) {
        logMapError("detail-navigation-failed", { id, name: (error as Error).name });
        pendingDetailRef.current = null;
        setPendingDetail({ id, failed: true });
      }
    },
    [clearFocus, router],
  );

  useEffect(() => {
    if (!pendingDetailRef.current || !pathname.startsWith(`/fountains/${pendingDetailRef.current}`))
      return;
    pendingDetailRef.current = null;
    setPendingDetail(null);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
  }, [pathname]);
  // Suppress browse nav while add-mode is active (ref avoids stale closure).
  const addActiveRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs
  addActiveRef.current = add.active;
  // Opt-in on-screen diagnostics: visit `?debug` to surface GPU info, tile/source load
  // progress, and MapLibre's own error events (otherwise invisible). No effect for normal users.
  const debug =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
  const [diag, setDiag] = useState<{
    webgl: string;
    apiBase: string;
    tiles: number;
    sourceLoaded: boolean;
    errors: string[];
  }>(() => ({
    webgl: debug ? webglInfo() : "",
    apiBase: resolveApiBaseUrl(),
    tiles: 0,
    sourceLoaded: false,
    errors: [],
  }));

  useEffect(() => {
    // Wait for `mounted` so next-themes has resolved the theme before building the map — the map
    // is created ONCE at the resolved flavor (no light→dark basemap flash for dark users). Theme
    // changes AFTER build swap the style in place (Step 6 effect); they never rebuild the map.
    if (!webglOk || !mounted) return; // no WebGL2 → the UnsupportedHint renders; never touch MapLibre.
    // The basemap source is now a normal vector TileJSON (go-pmtiles at /tiles) — MapLibre
    // fetches it natively; no client-side pmtiles protocol needed.
    themeRef.current = resolveTheme(resolvedTheme);
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current!,
        style: styleUrlFor(themeRef.current),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        // MapLibre defaults powerPreference to 'high-performance', which makes WebGL context
        // creation FAIL on some setups (e.g. Firefox → EGL_NO_CONFIG / "Exhausted GL driver
        // options") even when WebGL works on other sites. 'default' lets the browser pick any GPU.
        canvasContextAttributes: { powerPreference: "default" },
      });
    } catch (err) {
      // Pre-check passed but init still threw (rare) — catch so it can't go uncaught and crash
      // the page; the map area stays blank but the page renders.
      logMapError("webgl-init-failed", { name: (err as Error)?.name });
      return;
    }
    mapRef.current = map;
    styleThemeRef.current = themeRef.current; // basemap was built targeting themeRef's theme
    // Capture MapLibre's own errors (tile fetch/decode failures, WebGL/render errors) — these
    // are otherwise only console-logged by MapLibre and invisible to us. This is how a
    // mobile-only "gray basemap" (tiles never paint) surfaces a concrete cause.
    map.on("error", (e) => {
      const msg = (e.error?.message ?? "unknown maplibre error").slice(0, 240);
      logMapError("maplibre-error", { message: msg });
      setDiag((d) => ({ ...d, errors: [...d.errors.slice(-9), msg] }));
    });
    if (debug) {
      map.on("data", (ev) => {
        // The "data" listener is typed as the base MapDataEvent; the source-data fields live
        // on MapSourceDataEvent. Narrow structurally to read sourceId/tile/isSourceLoaded.
        const e = ev as unknown as {
          dataType?: string;
          sourceId?: string;
          isSourceLoaded?: boolean;
          tile?: unknown;
        };
        if (e.dataType === "source" && e.sourceId === "protomaps") {
          setDiag((d) => ({
            ...d,
            tiles: e.tile ? d.tiles + 1 : d.tiles,
            sourceLoaded: e.isSourceLoaded === true ? true : d.sourceLoaded,
          }));
        }
      });
    }
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
        trackUserLocation: false,
        showUserLocation: true,
      }),
      "top-right",
    );

    let timer: ReturnType<typeof setTimeout>;
    const onMoveEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), DEBOUNCE_MS);
    };

    // ── One-time wiring (layer-id–scoped listeners survive setStyle; attach exactly once) ──
    // map.on(type, layerId, listener) registers a MAP-LEVEL delegated listener that filters
    // `layerId` through map.getLayer() on every event, so it can be bound BEFORE the overlay
    // layers exist, tolerates them being absent mid-swap, and is NOT removed by setStyle. Do NOT
    // move these into installOverlay — that would re-register per swap and double-fire nav/loads.
    map.on("click", "clusters", (e) => {
      if (addActiveRef.current) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      const cid = f?.properties?.cluster_id as number | undefined;
      const src = map.getSource("fountains") as GeoJSONSource;
      // v5: GeoJSONSource.getClusterExpansionZoom returns Promise<number>.
      if (cid != null)
        src.getClusterExpansionZoom(cid).then((z) =>
          map.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: z,
          }),
        );
    });
    // pin click -> open detail route (soft nav; map stays mounted)
    const openPin = (e: MapLayerMouseEvent) => {
      if (addActiveRef.current) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) openDetail(id);
    };
    map.on("click", "pins", openPin);
    map.on("click", "selected-pin", openPin);
    ["clusters", "pins", "selected-pin"].forEach((ly) => {
      map.on("mouseenter", ly, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", ly, () => (map.getCanvas().style.cursor = ""));
    });
    map.on("moveend", onMoveEnd);

    // Geolocate ONCE at startup (not on style swaps): map.once("load") fires only on the initial
    // load; setStyle emits style.load, never load again.
    map.once("load", () => {
      if (!navigator.geolocation) {
        logMapError("startup-geolocation-unavailable");
        setLocateStatus("resolved");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocateStatus("resolved");
          if (shouldMoveToStartupLocation(focusIdRef.current)) {
            map.flyTo({
              center: [pos.coords.longitude, pos.coords.latitude],
              zoom: NEIGHBORHOOD_ZOOM,
            });
          }
        },
        (error) => {
          logMapError("startup-geolocation-failed", { code: error.code });
          setLocateStatus("resolved");
        },
        { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
      );
    });

    // Per-style install: fires on the initial style.load AND after every setStyle swap.
    map.on("style.load", () => {
      void installOverlay(map, styleGenRef.current);
    });

    // Load the themed pin/pill images, (re)create the source+layers, and seed them from the latest
    // pins/selection. Runs on every style.load; `gen` aborts the install if a newer setStyle
    // superseded this generation mid-flight.
    async function installOverlay(m: maplibregl.Map, gen: number) {
      const theme = themeRef.current;
      const colors = mapColorsFor(theme);
      try {
        await Promise.all(
          themedPinAssets(theme).map(async ({ name, url }) => {
            // v5: map.loadImage(url) resolves to { data } (HTMLImageElement | ImageBitmap).
            const img = await m.loadImage(url);
            if (gen !== styleGenRef.current) return; // superseded by a newer setStyle
            if (!m.hasImage(name)) m.addImage(name, img.data);
          }),
        );
        // Stretchable rating-pill background (9-patch); stretch/content coords match pill-bg.png.
        const pill = themedPillBg(theme);
        const pillImg = await m.loadImage(pill.url);
        if (gen !== styleGenRef.current) return;
        if (!m.hasImage(pill.name))
          m.addImage(pill.name, pillImg.data, {
            stretchX: [[6, 14]],
            stretchY: [[6, 14]],
            content: [6, 6, 14, 14],
          });
      } catch (e) {
        logMapError("image-load-failed", { name: (e as Error).name });
      }
      if (gen !== styleGenRef.current) return;
      if (!m.getSource("fountains")) m.addSource("fountains", fountainsSource());
      const src = m.getSource("fountains") as GeoJSONSource | undefined;
      src?.setData(pinsToFeatureCollection(pinsRef.current, theme)); // seed from latest pins
      const c = colors;
      (
        [
          clusterCircleLayer(c),
          clusterCountLayer(c),
          pinLayer(),
          pillLayer(c),
          selectedHaloLayer(activeIdRef.current, c),
          selectedPinLayer(activeIdRef.current, c.selectedPin),
        ] as LayerSpecification[]
      ).forEach((l) => {
        if (!m.getLayer(l.id)) m.addLayer(l);
      });
      applyActiveFilter(m, activeIdRef.current);

      // Placement map: create ONCE (first install — matches the old "after load" timing that
      // useAddFountainMode/flyto depend on); re-establish its themed ring/marker on later swaps.
      if (!placementRef.current) {
        const pm = createPlacementMap(m, colors);
        placementRef.current = pm;
        setPlacementMap(pm);
      } else {
        placementRef.current.reinstall(colors);
      }
      void load(); // reconcile any pan/zoom that happened during the swap
    }

    function applyActiveFilter(m: maplibregl.Map, id: string) {
      if (!m.getLayer("selected-halo")) return;
      const flt = selectedFountainFilter(id);
      m.setFilter("selected-halo", flt);
      m.setFilter("selected-pin", flt);
    }

    async function load() {
      const m = mapRef.current;
      if (!m) return;
      const seq = ++loadSeqRef.current;
      const gen = styleGenRef.current;
      if (!shouldLoadPins(m.getZoom())) {
        (m.getSource("fountains") as GeoJSONSource | undefined)?.setData(EMPTY_FC);
        pinsRef.current = []; // a later swap re-seeds empty, not stale (spec §6.1)
        bboxPinsRef.current = [];
        setPins([]);
        setStatus("belowZoom");
        return; // seq bump already invalidates in-flight fetches
      }
      const b = m.getBounds();
      const norm = normalizeBounds({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
      if (norm.skip) return; // antimeridian/degenerate: keep prior pins
      setStatus("loading");
      try {
        // crypto.randomUUID throws if unavailable (older browsers / non-secure contexts);
        // that would surface as this catch's "Couldn't load fountains" without a request ever
        // being sent. Fall back so the per-request id never blocks the fetch.
        const reqId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await fetchBbox(norm.params, reqId);
        // Stale if a newer load started OR a style swap superseded this generation.
        if (seq !== loadSeqRef.current || gen !== styleGenRef.current) return;
        bboxPinsRef.current = result.pins;
        const data = mergeFocusedPin(result.pins, focusedPinRef.current);
        setPins(data);
        // Normalise ranking_score: the API schema marks it optional (?), but PinInput requires
        // number | null. Map undefined → null so pinsToFeatureCollection is type-safe.
        const pinInputs = data.map((p) => ({ ...p, ranking_score: p.ranking_score ?? null }));
        pinsRef.current = pinInputs;
        // Re-read the source AFTER the guards — a setStyle during the fetch replaced it, and the
        // pre-fetch reference would point at the removed (dead) source.
        const src = m.getSource("fountains") as GeoJSONSource | undefined;
        src?.setData(pinsToFeatureCollection(pinInputs, themeRef.current));
        setStatus(
          result.truncated || isAtCap(data.length)
            ? "capped"
            : data.length === 0
              ? "empty"
              : "idle",
        );
      } catch (e) {
        if (seq !== loadSeqRef.current || gen !== styleGenRef.current) return; // stale — don't clobber
        const detail = `${(e as Error).name}: ${(e as Error).message}`;
        logMapError("bbox-fetch-failed", { detail });
        setDiag((d) => ({ ...d, errors: [...d.errors.slice(-9), `bbox-fetch: ${detail}`] }));
        setStatus("error");
      }
    }

    return () => {
      clearTimeout(timer);
      placementRef.current?.teardown();
      placementRef.current = null;
      map.remove();
      mapRef.current = null;
      setPlacementMap(null);
    };
    // resolvedTheme is intentionally NOT a dependency: after build, a theme change swaps the style
    // in place (the setStyle effect below), never rebuilds the map — a rebuild would drop the
    // camera + re-trigger geolocation. It is read via themeRef at build time instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, webglOk, debug, mounted, openDetail]);

  // Theme change → swap the basemap style in place (camera preserved; no rebuild, no geolocation
  // re-trigger). Bumping styleGenRef first makes any in-flight installOverlay/load() from the prior
  // theme abort; the style.load handler then re-installs pins/layers/selection at the new theme.
  useEffect(() => {
    const theme = resolveTheme(resolvedTheme);
    themeRef.current = theme;
    const m = mapRef.current;
    if (!m) return;
    if (styleThemeRef.current === theme) return; // basemap already targeting this theme
    styleThemeRef.current = theme;
    styleGenRef.current += 1;
    m.setStyle(styleUrlFor(theme));
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isAuthenticated) return;
    function showCelebration(e: Event) {
      const awarded = contributionPoints(e);
      if (awarded <= 0) return; // (#204) a verified 0 must not animate on the map either
      setCelebrationPoints(awarded);
      setCelebrationKey((key) => key + 1);
    }
    window.addEventListener(CONTRIBUTION_EVENT, showCelebration);
    return () => {
      window.removeEventListener(CONTRIBUTION_EVENT, showCelebration);
    };
  }, [isAuthenticated]);

  // Reflect the active route id on the selected layers (additive: halo always; icon swap via expr).
  // Recording activeIdRef here lets installOverlay re-apply the selection after a theme swap.
  useEffect(() => {
    activeIdRef.current = activeId;
    const m = mapRef.current;
    if (!m || !m.getLayer?.("selected-halo")) return;
    const flt = selectedFountainFilter(activeId);
    m.setFilter("selected-halo", flt);
    m.setFilter("selected-pin", flt);
  }, [activeId, status]);

  // Resolve deep-linked focus independently of bbox timing. The public detail endpoint enforces
  // hidden/deleted visibility and supplies the exact coordinates used for the one authoritative
  // focus camera move.
  useEffect(() => {
    if (!focusId) {
      focusedPinRef.current = null;
      consumedFocusRef.current = null;
      return;
    }
    focusedPinRef.current = null;
    const controller = new AbortController();
    const requestId =
      typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
    void fetchPublicFountain(focusId, requestId).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind === "not-found") {
        focusedPinRef.current = null;
        setFocusedPin(null);
        setFocusStatus("not-found");
        return;
      }
      if (result.kind === "error") {
        logMapError("focus-resolution-failed", { id: focusId, status: result.status });
        focusedPinRef.current = null;
        setFocusedPin(null);
        setFocusStatus("error");
        return;
      }
      const pin = detailToPin(result.fountain);
      focusedPinRef.current = pin;
      setFocusedPin(pin);
      setFocusStatus("found");
    });
    return () => controller.abort();
  }, [focusId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!focusedPin || !placementMap || !map || consumedFocusRef.current === focusId) return;
    consumedFocusRef.current = focusId;
    map.flyTo(focusCameraAction(focusedPin));
  }, [focusId, focusedPin, placementMap]);

  // Re-seed immediately when exact focus data resolves instead of waiting for the next moveend.
  useEffect(() => {
    if (!focusedPin) return;
    const merged = mergeFocusedPin(pins, focusedPin);
    const inputs = merged.map((pin) => ({ ...pin, ranking_score: pin.ranking_score ?? null }));
    pinsRef.current = inputs;
    (mapRef.current?.getSource("fountains") as GeoJSONSource | undefined)?.setData(
      pinsToFeatureCollection(inputs, themeRef.current),
    );
  }, [focusedPin, pins]);

  // Header-search handoff (design doc §4.2/§4.3): consumes the `flyto`/`bbox` query params
  // HeaderSearch writes on select, applies the resulting camera move, then strips ONLY those
  // two params (preserving any others, e.g. `add`) via `router.replace`.
  //
  // Invalid/malformed params are cleared IMMEDIATELY, without waiting on `placementMap` - an
  // invalid value must never linger in the URL until the map finishes loading (or forever, if
  // the map constructor throws after the WebGL probe). Only a VALID camera target defers to
  // `placementMap` becoming non-null - the same "the map finished loading and its layers/pins
  // exist" signal `useAddFountainMode` already uses to defer its own `?add=1` strip until the
  // map adapter exists (see its comment) - so a flyto that arrives before `load` has fired can't
  // be silently dropped or applied against a not-yet-sized map; `placementMap` is already an
  // effect dep, so it re-runs once the map becomes ready. When WebGL isn't supported
  // `placementMap` can never become non-null (the map is never created), so a valid target's
  // wait is skipped too and the params are still cleared immediately (with no map to apply the
  // move to) - otherwise they'd linger in the URL forever with no map that could ever consume
  // them.
  //
  // `consumedFlyToRef` remembers the raw `flyto`+`bbox` string this effect just consumed so a
  // duplicate effect run against the SAME still-present params (e.g. while `router.replace`'s
  // navigation is in flight) can't re-apply the camera move or double-fire the replace, and so
  // it can never hijack a subsequent manual pan. It resets to `null` once the params are
  // actually gone from the URL, so selecting the same result again later still works. Note it
  // is only set once a param is actually consumed (invalid → immediately; valid → once the map
  // is ready), so a valid target awaiting `placementMap` is retried on every re-run instead of
  // being marked consumed prematurely.
  const consumedFlyToRef = useRef<string | null>(null);
  useEffect(() => {
    const flytoRaw = searchParams.get("flyto");
    const bboxRaw = searchParams.get("bbox");
    if (flytoRaw === null && bboxRaw === null) {
      consumedFlyToRef.current = null;
      return;
    }
    const rawKey = `${flytoRaw ?? ""} ${bboxRaw ?? ""}`;
    if (consumedFlyToRef.current === rawKey) return; // already consumed this exact value

    const parsed = parseFlyToParam({ flyto: flytoRaw, bbox: bboxRaw });
    if (parsed && webglOk && !placementMap) return; // valid target: wait for the map to be ready
    if (parsed && focusId && focusStatus === "loading") return; // exact focus decides first

    consumedFlyToRef.current = rawKey;
    const map = mapRef.current;
    if (parsed && map && (!focusId || focusStatus === "not-found" || focusStatus === "error")) {
      const action = deriveCameraAction(parsed);
      if (action.kind === "fit") {
        map.fitBounds(action.bounds, {
          maxZoom: action.maxZoom,
          padding: action.padding,
          duration: 1000,
        });
      } else {
        map.flyTo({ center: action.center, zoom: action.zoom });
      }
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("flyto");
    params.delete("bbox");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, webglOk, placementMap, router, pathname, focusId, focusStatus]);

  const retry = () => mapRef.current?.fire("moveend");

  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full w-full" />
      {status === "loading" && <LoadingBar />}
      {status === "belowZoom" && locateStatus === "resolved" && <ZoomInHint />}
      {locateStatus === "locating" && !focusId && (
        <div
          role="status"
          aria-busy="true"
          className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-surface-raised px-4 py-2 text-sm shadow"
        >
          Locating you…
        </div>
      )}
      {status === "empty" && <EmptyHint />}
      {status === "capped" && <CapHint />}
      {status === "error" && <ErrorToast onRetry={retry} />}
      {focusStatus === "loading" && (
        <div
          role="status"
          aria-busy="true"
          className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-surface-raised px-4 py-2 text-sm shadow"
        >
          Locating selected fountain…
          <button type="button" className="ml-2 underline" onClick={() => clearFocus()}>
            Dismiss
          </button>
        </div>
      )}
      {focusStatus === "not-found" && (
        <div
          role="status"
          className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-surface-raised px-4 py-2 text-sm shadow"
        >
          That fountain is no longer available.
          <button type="button" className="ml-2 underline" onClick={() => clearFocus()}>
            Dismiss
          </button>
        </div>
      )}
      {focusStatus === "error" && (
        <div
          role="alert"
          className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-surface-raised px-4 py-2 text-sm shadow"
        >
          Couldn&rsquo;t load the selected fountain.
          <button type="button" className="ml-2 underline" onClick={() => clearFocus()}>
            Dismiss
          </button>
        </div>
      )}
      {focusedPin && (
        <button
          type="button"
          aria-label={`Selected fountain at ${focusedPin.location.latitude.toFixed(5)}, ${focusedPin.location.longitude.toFixed(5)}. ${focusedPin.is_working ? "Working" : "Out of order"}. Open details`}
          onClick={() => openDetail(String(focusedPin.id))}
          className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-xl border-2 border-brand bg-surface-raised px-4 py-3 text-left shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span className="block text-xs font-bold uppercase tracking-wide text-brand-ink">
            Selected fountain
          </span>
          <span className="block text-sm font-semibold">
            {focusedPin.is_working ? "Working" : "Out of order"} · Open details
          </span>
        </button>
      )}
      {pendingDetail?.failed && (
        <aside
          role="alert"
          className="absolute inset-x-2 bottom-2 z-50 rounded-2xl border border-border bg-surface-raised p-5 shadow-xl md:inset-x-auto md:bottom-4 md:right-4 md:w-96"
        >
          <p className="font-semibold">Couldn&rsquo;t open fountain details.</p>
          <button
            type="button"
            className="mt-3 rounded-full bg-brand px-4 py-2 font-semibold text-white"
            onClick={() => {
              const id = pendingDetail.id;
              pendingDetailRef.current = null;
              setPendingDetail(null);
              openDetail(id);
            }}
          >
            Retry
          </button>
          <button
            type="button"
            className="ml-2 mt-3 rounded-full border border-border px-4 py-2 font-semibold"
            onClick={() => setPendingDetail(null)}
          >
            Dismiss
          </button>
        </aside>
      )}
      {pendingDetail && !pendingDetail.failed && (
        <div
          role="status"
          aria-busy="true"
          className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-surface-raised px-4 py-2 text-sm font-semibold shadow-lg"
        >
          Opening fountain details…
        </div>
      )}
      {!webglOk && <UnsupportedHint />}
      <WaterCelebration triggerKey={celebrationKey} points={celebrationPoints} />
      {webglOk && add.fab}
      {add.panel}
      {debug && (
        <div className="absolute left-2 top-2 z-[60] max-h-[45%] w-[92%] overflow-auto rounded bg-black/85 p-2 font-mono text-[10px] leading-tight text-emerald-300">
          <div>
            dpr {typeof window !== "undefined" ? window.devicePixelRatio : "?"} · maplibre 5.24 ·
            webglOk {String(webglOk)} · status {status}
          </div>
          <div>webgl: {diag.webgl || "…"}</div>
          <div>api: {diag.apiBase}</div>
          <div>
            basemap tiles seen: {diag.tiles} · sourceLoaded: {String(diag.sourceLoaded)}
          </div>
          <div>errors ({diag.errors.length}):</div>
          {diag.errors.length === 0 ? (
            <div>• none</div>
          ) : (
            diag.errors.map((e, i) => <div key={i}>• {e}</div>)
          )}
        </div>
      )}
      {!add.active && <FountainsInViewList pins={pins} activeId={activeId} onOpen={openDetail} />}
    </div>
  );
}
