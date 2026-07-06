/// <reference types="@types/geojson" />
import { GOLD_THRESHOLD } from "./constants";
import { formatPill } from "./format";

export type PinLike = { is_working: boolean; ranking_score: number | null };
export type PinInput = PinLike & {
  id: string;
  location: { latitude: number; longitude: number };
  average_rating: number | null;
  rating_count?: number;
};
export type PinProps = {
  id: string;
  is_working: boolean;
  ranking_score: number | null;
  average_rating: number | null;
  icon: string;
  pill: string | null;
};

export function basePinIcon(
  p: PinLike,
): "pin-broken" | "pin-gold" | "pin-unrated" | "pin-standard" {
  if (!p.is_working) return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  if (p.ranking_score == null) return "pin-unrated";
  return "pin-standard";
}
export function selectedSwapIcon(p: PinLike): "pin-selected" | null {
  // Only rated, working, non-gold pins swap to the "selected" art. Unrated keeps
  // its muted icon (the halo still applies via the selected-halo layer).
  return p.is_working && p.ranking_score != null && p.ranking_score <= GOLD_THRESHOLD
    ? "pin-selected"
    : null;
}
export function pinsToFeatureCollection(
  pins: PinInput[],
  theme: "light" | "dark" = "light",
): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps> {
  const suffix = theme === "dark" ? "-dark" : "";
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.location.longitude, p.location.latitude] },
      properties: {
        id: String(p.id),
        is_working: p.is_working,
        ranking_score: p.ranking_score ?? null,
        average_rating: p.average_rating ?? null,
        icon: `${basePinIcon(p)}${suffix}`,
        pill: formatPill(p.average_rating ?? null),
      },
    })),
  };
}
