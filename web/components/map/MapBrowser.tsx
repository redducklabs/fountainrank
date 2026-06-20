"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import maplibregl, {
  addProtocol,
  removeProtocol,
  type FilterSpecification,
  type MapLayerMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
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
import { CapHint, EmptyHint, ErrorToast, LoadingBar, ZoomInHint } from "./MapStates";

type Status = "idle" | "loading" | "empty" | "error" | "belowZoom" | "capped";
const activeIdFromPath = (p: string | null) => p?.match(/^\/fountains\/([^/?#]+)/)?.[1] ?? "";

export default function MapBrowser() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [pins, setPins] = useState<FountainPin[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const activeId = activeIdFromPath(pathname);

  useEffect(() => {
    const protocol = new Protocol();
    // v5: addProtocol/removeProtocol are standalone named exports (not on the maplibregl namespace object).
    addProtocol("pmtiles", protocol.tile);
    const map = new maplibregl.Map({
      container: ref.current!,
      style: BASEMAP.styleUrl,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    mapRef.current = map;
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
      const src = m.getSource("fountains") as GeoJSONSource | undefined;
      if (!shouldLoadPins(m.getZoom())) {
        src?.setData(EMPTY_FC);
        setPins([]);
        setStatus("belowZoom");
        return; // clear stale pins (spec §6.1)
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
        setPins(data);
        // Normalise ranking_score: the API schema marks it optional (?), but PinInput requires
        // number | null. Map undefined → null so pinsToFeatureCollection is type-safe.
        const pinInputs = data.map((p) => ({ ...p, ranking_score: p.ranking_score ?? null }));
        src?.setData(pinsToFeatureCollection(pinInputs));
        setStatus(isAtCap(data.length) ? "capped" : data.length === 0 ? "empty" : "idle");
      } catch (e) {
        logMapError("bbox-fetch-failed", { name: (e as Error).name });
        setStatus("error");
      }
    }

    return () => {
      clearTimeout(timer);
      map.remove();
      removeProtocol("pmtiles");
      mapRef.current = null;
    };
  }, [router]);

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
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {status === "loading" && <LoadingBar />}
      {status === "belowZoom" && <ZoomInHint />}
      {status === "empty" && <EmptyHint />}
      {status === "capped" && <CapHint />}
      {status === "error" && <ErrorToast onRetry={retry} />}
      <FountainsInViewList
        pins={pins}
        activeId={activeId}
        onOpen={(id) => router.push(`/fountains/${id}`)}
      />
    </div>
  );
}
