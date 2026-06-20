/// <reference types="@types/geojson" />
import type {
  CircleLayerSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, GOLD_THRESHOLD, PILL_MIN_ZOOM } from "./constants";

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

export function clusterCircleLayer(): CircleLayerSpecification {
  return {
    id: "clusters",
    type: "circle",
    source: "fountains",
    filter: isCluster,
    paint: {
      "circle-color": "#0C44A0",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28],
    },
  };
}

export function clusterCountLayer(): SymbolLayerSpecification {
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
    paint: { "text-color": "#ffffff" },
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

export function pillLayer(): SymbolLayerSpecification {
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
      "icon-image": "pill-bg",
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
    paint: { "text-color": "#0A357E" },
  };
}

// Mirrors selectedSwapIcon: working & not-gold -> pin-selected, else the base icon.
export const SELECTED_ICON_EXPR = [
  "case",
  [
    "all",
    ["get", "is_working"],
    ["<=", ["coalesce", ["get", "ranking_score"], -1], GOLD_THRESHOLD],
  ],
  "pin-selected",
  ["get", "icon"],
] as const;

const byId = (id: string): FilterSpecification => [
  "all",
  ["!", ["has", "point_count"]],
  ["==", ["get", "id"], id],
];

export function selectedHaloLayer(id: string): CircleLayerSpecification {
  return {
    id: "selected-halo",
    type: "circle",
    source: "fountains",
    filter: byId(id),
    paint: {
      "circle-radius": 26,
      "circle-color": "#0C44A0",
      "circle-opacity": 0.18,
      "circle-translate": [0, -18],
    },
  };
}

export function selectedPinLayer(id: string): SymbolLayerSpecification {
  return {
    id: "selected-pin",
    type: "symbol",
    source: "fountains",
    filter: byId(id),
    layout: {
      "icon-image": SELECTED_ICON_EXPR as unknown as string,
      "icon-anchor": "bottom",
      "icon-size": 0.56,
      "icon-allow-overlap": true,
    },
  };
}
