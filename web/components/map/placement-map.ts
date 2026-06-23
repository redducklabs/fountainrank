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

export interface PlacementMap {
  getZoom(): number;
  getCenter(): LngLat;
  getViewport(): ViewportBounds;
  flyToFix(center: LngLat): void;
  subscribe(h: { onClick: (p: LngLat) => void; onMoveEnd: () => void }): () => void;
  setPin(p: LngLat | null, onDragEnd: (p: LngLat) => void): void;
  setRing(bound: Bound | null): void;
  teardown(): void;
}

export function createPlacementMap(map: maplibregl.Map): PlacementMap {
  let marker: maplibregl.Marker | null = null;

  function ensureRing() {
    if (map.getSource(RING_SOURCE)) return;
    map.addSource(RING_SOURCE, { type: "geojson", data: ringFeatureCollection(null) });
    map.addLayer({
      id: RING_LAYER,
      type: "line",
      source: RING_SOURCE,
      paint: { "line-color": "#0A357E", "line-opacity": 0.4, "line-dasharray": [2, 2] },
    });
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
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      if (!marker) {
        marker = new maplibregl.Marker({ draggable: true, color: "#0A357E" });
        marker.on("dragend", () => {
          const ll = marker!.getLngLat();
          onDragEnd({ lng: ll.lng, lat: ll.lat });
        });
        marker.setLngLat([p.lng, p.lat]).addTo(map);
      } else {
        marker.setLngLat([p.lng, p.lat]);
      }
    },
    setRing: (bound) => {
      ensureRing();
      const src = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(ringFeatureCollection(bound));
    },
    teardown: () => {
      marker?.remove();
      marker = null;
      if (map.getLayer(RING_LAYER)) map.removeLayer(RING_LAYER);
      if (map.getSource(RING_SOURCE)) map.removeSource(RING_SOURCE);
    },
  };
}
