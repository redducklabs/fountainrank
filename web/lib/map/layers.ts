/// <reference types="@types/geojson" />
import type {
  CircleLayerSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, GOLD_THRESHOLD, PILL_MIN_ZOOM } from "./constants";
import type { MapColors } from "./colors";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const notCluster: FilterSpecification = ["!", ["has", "point_count"]];
const isCluster: FilterSpecification = ["has", "point_count"];

export function fountainsSource(): GeoJSONSourceSpecification {
  return {
    type: "geojson",
    data: EMPTY_FC,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
  };
}

export function clusterCircleLayer(c: MapColors): CircleLayerSpecification {
  return {
    id: "clusters",
    type: "circle",
    source: "fountains",
    filter: isCluster,
    paint: {
      "circle-color": c.cluster,
      "circle-stroke-color": c.clusterStroke,
      "circle-stroke-width": 3,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28],
    },
  };
}

export function clusterCountLayer(c: MapColors): SymbolLayerSpecification {
  return {
    id: "cluster-count",
    type: "symbol",
    source: "fountains",
    filter: isCluster,
    layout: {
      "text-field": ["get", "point_count_abbreviated"] as unknown as string,
      "text-size": 13,
      "text-font": ["Noto Sans Bold"],
    },
    paint: { "text-color": c.clusterCount },
  };
}

export function pinLayer(): SymbolLayerSpecification {
  return {
    id: "pins",
    type: "symbol",
    source: "fountains",
    filter: notCluster,
    layout: {
      "icon-image": ["get", "icon"] as unknown as string,
      "icon-anchor": "bottom",
      "icon-size": 0.5,
      "icon-allow-overlap": true,
    },
  };
}

export function pillLayer(c: MapColors): SymbolLayerSpecification {
  return {
    id: "pins-pill",
    type: "symbol",
    source: "fountains",
    minzoom: PILL_MIN_ZOOM,
    filter: [
      "all",
      notCluster,
      ["has", "pill"],
      ["!=", ["get", "pill"], null],
    ] as unknown as FilterSpecification,
    layout: {
      "icon-image": c.pillBg,
      "icon-text-fit": "both",
      "icon-text-fit-padding": [2, 6, 2, 6],
      "text-field": ["get", "pill"] as unknown as string,
      "text-size": 12,
      "text-font": ["Noto Sans Bold"],
      "text-anchor": "top",
      "icon-anchor": "top",
      "text-offset": [0, 1.4],
      "icon-allow-overlap": true,
      "text-allow-overlap": true,
      "text-optional": false,
    },
    paint: { "text-color": c.pillText },
  };
}

// Mirrors selectedSwapIcon: working & RATED & not-gold -> selectedPinName, else the
// base icon. Unrated (null score coalesces to -1) is excluded by the `>= 0` bound,
// so it keeps its muted icon under the halo. Parameterized by the theme-suffixed
// selected-pin name so the same expression works in light or dark.
export function selectedIconExpr(selectedPinName: string) {
  return [
    "case",
    [
      "all",
      ["get", "is_working"],
      [">=", ["coalesce", ["get", "ranking_score"], -1], 0],
      ["<=", ["coalesce", ["get", "ranking_score"], -1], GOLD_THRESHOLD],
    ],
    selectedPinName,
    ["get", "icon"],
  ] as const;
}

const byId = (id: string): FilterSpecification => [
  "all",
  ["!", ["has", "point_count"]],
  ["==", ["get", "id"], id],
];

export function selectedHaloLayer(id: string, c: MapColors): CircleLayerSpecification {
  return {
    id: "selected-halo",
    type: "circle",
    source: "fountains",
    filter: byId(id),
    paint: {
      "circle-radius": 26,
      "circle-color": c.halo,
      "circle-opacity": 0.18,
      "circle-translate": [0, -18],
    },
  };
}

export function selectedPinLayer(id: string, selectedPinName: string): SymbolLayerSpecification {
  return {
    id: "selected-pin",
    type: "symbol",
    source: "fountains",
    filter: byId(id),
    layout: {
      "icon-image": selectedIconExpr(selectedPinName) as unknown as string,
      "icon-anchor": "bottom",
      "icon-size": 0.56,
      "icon-allow-overlap": true,
    },
  };
}
