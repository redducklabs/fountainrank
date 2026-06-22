"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import maplibregl, {
  type FilterSpecification,
  type MapLayerMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP, PIN_ASSETS, PILL_BG_ASSET } from "../../lib/map/style";
import { fetchBbox, type FountainPin } from "../../lib/fountains";
import { pinsToFeatureCollection } from "../../lib/map/pins";
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
} from "../../lib/map/layers";
import {
  DEBOUNCE_MS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  GEOLOCATE_TIMEOUT_MS,
  NEIGHBORHOOD_ZOOM,
} from "../../lib/map/constants";
import { logMapError } from "../../lib/map/log";
import { FountainsInViewList } from "./FountainsInViewList";
import {
  CapHint,
  EmptyHint,
  ErrorToast,
  LoadingBar,
  UnsupportedHint,
  ZoomInHint,
} from "./MapStates";

type Status = "idle" | "loading" | "empty" | "error" | "belowZoom" | "capped";
const activeIdFromPath = (p: string | null) => p?.match(/^\/fountains\/([^/?#]+)/)?.[1] ?? "";

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

export default function MapBrowser() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadSeqRef = useRef(0);
  const router = useRouter();
  const pathname = usePathname();
  const [pins, setPins] = useState<FountainPin[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [webglOk] = useState(isWebglSupported);
  const activeId = activeIdFromPath(pathname);
  // Opt-in on-screen diagnostics: visit `?debug` to surface GPU info, tile/source load
  // progress, and MapLibre's own error events (otherwise invisible). No effect for normal users.
  const debug =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
  const [diag, setDiag] = useState<{
    webgl: string;
    tiles: number;
    sourceLoaded: boolean;
    errors: string[];
  }>({ webgl: "", tiles: 0, sourceLoaded: false, errors: [] });

  useEffect(() => {
    if (!webglOk) return; // no WebGL2 → the UnsupportedHint renders; never touch MapLibre.
    // The basemap source is now a normal vector TileJSON (go-pmtiles at /tiles) — MapLibre
    // fetches it natively; no client-side pmtiles protocol needed.
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current!,
        style: BASEMAP.styleUrl,
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
    // Capture MapLibre's own errors (tile fetch/decode failures, WebGL/render errors) — these
    // are otherwise only console-logged by MapLibre and invisible to us. This is how a
    // mobile-only "gray basemap" (tiles never paint) surfaces a concrete cause.
    map.on("error", (e) => {
      const msg = (e.error?.message ?? "unknown maplibre error").slice(0, 240);
      logMapError("maplibre-error", { message: msg });
      setDiag((d) => ({ ...d, errors: [...d.errors.slice(-9), msg] }));
    });
    if (debug) {
      setDiag((d) => ({ ...d, webgl: webglInfo() }));
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

    map.on("load", async () => {
      try {
        await Promise.all(
          Object.entries(PIN_ASSETS).map(async ([name, url]) => {
            // v5: map.loadImage(url) returns Promise<GetResourceResponse<HTMLImageElement | ImageBitmap>>.
            // The resolved value has a `.data` property — use img.data.
            const img = await map.loadImage(url);
            if (!map.hasImage(name)) map.addImage(name, img.data);
          }),
        );
        // Stretchable rating-pill background (9-patch). Stretch/content coords match pill-bg.png
        // (Task 11 step 2 — adjust if the asset's content box differs).
        const pill = await map.loadImage(PILL_BG_ASSET);
        if (!map.hasImage("pill-bg"))
          map.addImage("pill-bg", pill.data, {
            stretchX: [[6, 14]],
            stretchY: [[6, 14]],
            content: [6, 6, 14, 14],
          });
      } catch (e) {
        logMapError("image-load-failed", { name: (e as Error).name });
      }
      map.addSource("fountains", fountainsSource());
      [
        clusterCircleLayer(),
        clusterCountLayer(),
        pinLayer(),
        pillLayer(),
        selectedHaloLayer(""),
        selectedPinLayer(""),
      ].forEach((l) => map.addLayer(l));
      // cluster click -> expand
      map.on("click", "clusters", (e) => {
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
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) router.push(`/fountains/${id}`);
      };
      map.on("click", "pins", openPin);
      map.on("click", "selected-pin", openPin);
      ["clusters", "pins", "selected-pin"].forEach((ly) => {
        map.on("mouseenter", ly, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", ly, () => (map.getCanvas().style.cursor = ""));
      });
      // geolocate on load (short timeout); fall back to the default view silently.
      navigator.geolocation?.getCurrentPosition(
        (pos) =>
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: NEIGHBORHOOD_ZOOM,
          }),
        () => {
          /* denied/unavailable: stay at default view */
        },
        { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
      );
      map.on("moveend", onMoveEnd);
      void load();
    });

    async function load() {
      const m = mapRef.current;
      if (!m) return;
      const seq = ++loadSeqRef.current;
      const src = m.getSource("fountains") as GeoJSONSource | undefined;
      if (!shouldLoadPins(m.getZoom())) {
        src?.setData(EMPTY_FC);
        setPins([]);
        setStatus("belowZoom");
        return; // clear stale pins (spec §6.1); seq bump already invalidates in-flight fetches
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
        const data = await fetchBbox(norm.params, crypto.randomUUID());
        if (seq !== loadSeqRef.current) return; // stale response — a newer load is in progress
        setPins(data);
        // Normalise ranking_score: the API schema marks it optional (?), but PinInput requires
        // number | null. Map undefined → null so pinsToFeatureCollection is type-safe.
        const pinInputs = data.map((p) => ({ ...p, ranking_score: p.ranking_score ?? null }));
        src?.setData(pinsToFeatureCollection(pinInputs));
        setStatus(isAtCap(data.length) ? "capped" : data.length === 0 ? "empty" : "idle");
      } catch (e) {
        if (seq !== loadSeqRef.current) return; // stale error — don't clobber newer load's state
        logMapError("bbox-fetch-failed", { name: (e as Error).name });
        setStatus("error");
      }
    }

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [router, webglOk, debug]);

  // Reflect the active route id on the selected layers (additive: halo always; icon swap via expr).
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.getLayer?.("selected-halo")) return;
    const flt: FilterSpecification = [
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "id"], activeId],
    ];
    m.setFilter("selected-halo", flt);
    m.setFilter("selected-pin", flt);
  }, [activeId, status]);

  const retry = () => mapRef.current?.fire("moveend");

  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full w-full" />
      {status === "loading" && <LoadingBar />}
      {status === "belowZoom" && <ZoomInHint />}
      {status === "empty" && <EmptyHint />}
      {status === "capped" && <CapHint />}
      {status === "error" && <ErrorToast onRetry={retry} />}
      {!webglOk && <UnsupportedHint />}
      {debug && (
        <div className="absolute left-2 top-2 z-[60] max-h-[45%] w-[92%] overflow-auto rounded bg-black/85 p-2 font-mono text-[10px] leading-tight text-emerald-300">
          <div>
            dpr {typeof window !== "undefined" ? window.devicePixelRatio : "?"} · maplibre 5.24 ·
            webglOk {String(webglOk)} · status {status}
          </div>
          <div>webgl: {diag.webgl || "…"}</div>
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
      <FountainsInViewList
        pins={pins}
        activeId={activeId}
        onOpen={(id) => router.push(`/fountains/${id}`)}
      />
    </div>
  );
}
