// MapLibre paint is applied in JS, so map colors are TS constants keyed by resolved theme
// (NOT CSS @theme vars). `pillBg`/`selectedPin` are theme-suffixed icon-image NAMES that
// MapBrowser addImage's under the same name. Dark values are brightened so pins/labels
// hold contrast on the dark basemap land (spec §3.1 map-token table; tuned in the a11y task).
export type MapColors = {
  cluster: string; // clusters circle-color
  clusterStroke: string; // clusters circle-stroke-color
  clusterCount: string; // cluster-count text-color
  pillText: string; // pins-pill text-color
  pillBg: string; // pins-pill icon-image name
  halo: string; // selected-halo circle-color
  selectedPin: string; // selected-pin icon-image name
  ring: string; // placement-map add-bound ring line-color
  marker: string; // placement-map draggable marker color
};

export const MAP_COLORS: Record<"light" | "dark", MapColors> = {
  light: {
    cluster: "#0C44A0",
    clusterStroke: "#FFFFFF",
    clusterCount: "#FFFFFF",
    pillText: "#0A357E",
    pillBg: "pill-bg",
    halo: "#0C44A0",
    selectedPin: "pin-selected",
    ring: "#0A357E",
    marker: "#0A357E",
  },
  dark: {
    cluster: "#4C82F0",
    clusterStroke: "#0B1220",
    clusterCount: "#FFFFFF",
    pillText: "#E7F0FF",
    pillBg: "pill-bg-dark",
    halo: "#5FC5F0",
    selectedPin: "pin-selected-dark",
    ring: "#4C82F0",
    marker: "#4C82F0",
  },
};

export function mapColorsFor(theme: "light" | "dark"): MapColors {
  return MAP_COLORS[theme];
}
