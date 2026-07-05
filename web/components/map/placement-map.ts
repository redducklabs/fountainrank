import maplibregl from "maplibre-gl";
import { PLACE_MIN_ZOOM } from "../../lib/map/constants";
import {
  ringFeatureCollection,
  type Bound,
  type LngLat,
  type ViewportBounds,
} from "../../lib/map/placement";

const RING_SOURCE = "add-bound";
const RING_LAYER = "add-bound-line";

type PlacementColors = { ring: string; marker: string };

export interface PlacementMap {
  getZoom(): number;
  getCenter(): LngLat;
  getViewport(): ViewportBounds;
  flyToFix(center: LngLat): void;
  subscribe(h: { onClick: (p: LngLat) => void; onMoveEnd: () => void }): () => void;
  setPin(p: LngLat | null, onDragEnd: (p: LngLat) => void): void;
  setRing(bound: Bound | null): void;
  reinstall(colors: PlacementColors): void;
  teardown(): void;
}

export function createPlacementMap(map: maplibregl.Map, colors: PlacementColors): PlacementMap {
  let marker: maplibregl.Marker | null = null;
  let ringColor = colors.ring;
  let markerColor = colors.marker;
  let ringActive = false;
  let lastBound: Bound | null = null;
  let lastPin: LngLat | null = null;
  let lastDragEnd: ((p: LngLat) => void) | null = null;

  function ensureRing() {
    ringActive = true;
    // Ensure the source and layer INDEPENDENTLY — a partial state (source present but layer
    // gone, e.g. after a teardown error or a future edit) must still restore the layer.
    if (!map.getSource(RING_SOURCE)) {
      map.addSource(RING_SOURCE, { type: "geojson", data: ringFeatureCollection(lastBound) });
    }
    if (!map.getLayer(RING_LAYER)) {
      map.addLayer({
        id: RING_LAYER,
        type: "line",
        source: RING_SOURCE,
        paint: { "line-color": ringColor, "line-opacity": 0.4, "line-dasharray": [2, 2] },
      });
    }
  }

  function placeMarker(p: LngLat) {
    marker = new maplibregl.Marker({ draggable: true, color: markerColor });
    marker.on("dragend", () => {
      const ll = marker!.getLngLat();
      lastPin = { lng: ll.lng, lat: ll.lat };
      lastDragEnd?.({ lng: ll.lng, lat: ll.lat });
    });
    marker.setLngLat([p.lng, p.lat]).addTo(map);
  }

  return {
    getZoom: () => map.getZoom(),
    getCenter: () => {
      const c = map.getCenter();
      return { lng: c.lng, lat: c.lat };
    },
    getViewport: () => {
      const b = map.getBounds();
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    },
    flyToFix: (center) =>
      map.easeTo({
        center: [center.lng, center.lat],
        zoom: Math.max(map.getZoom(), PLACE_MIN_ZOOM),
      }),
    subscribe: ({ onClick, onMoveEnd }) => {
      const click = (e: maplibregl.MapMouseEvent) =>
        onClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      const move = () => onMoveEnd();
      map.on("click", click);
      map.on("moveend", move);
      return () => {
        map.off("click", click);
        map.off("moveend", move);
      };
    },
    setPin: (p, onDragEnd) => {
      lastPin = p;
      lastDragEnd = onDragEnd;
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      if (!marker) {
        placeMarker(p);
      } else {
        marker.setLngLat([p.lng, p.lat]);
      }
    },
    setRing: (bound) => {
      lastBound = bound;
      ensureRing();
      const src = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(ringFeatureCollection(bound));
    },
    // Called by MapBrowser after a setStyle swap: setStyle drops the ring source/layer (and
    // requires the new theme's colors); the DOM marker survives but keeps its old color.
    reinstall: (next) => {
      ringColor = next.ring;
      markerColor = next.marker;
      if (ringActive) {
        if (map.getLayer(RING_LAYER)) {
          map.setPaintProperty(RING_LAYER, "line-color", ringColor);
        } else {
          ensureRing(); // source/layer were removed by setStyle — re-add with lastBound
        }
        const src = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
        src?.setData(ringFeatureCollection(lastBound));
      }
      if (marker && lastPin) {
        marker.remove();
        marker = null;
        placeMarker(lastPin); // recreate at the same spot with the new color
      }
    },
    teardown: () => {
      marker?.remove();
      marker = null;
      ringActive = false;
      if (map.getLayer(RING_LAYER)) map.removeLayer(RING_LAYER);
      if (map.getSource(RING_SOURCE)) map.removeSource(RING_SOURCE);
    },
  };
}
