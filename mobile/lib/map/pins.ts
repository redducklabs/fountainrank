/// <reference types="@types/geojson" />
import { GOLD_THRESHOLD } from "./constants";
import { formatPill } from "./format";

// ranking_score / current_status are OPTIONAL to match the generated `FountainPin`
// (both are `?: ... | null` there). Keeping them optional means a `FountainPin[]`
// from the API is directly assignable to `PinInput[]` with no per-pin normalization
// at the call site — normalization (`?? null`) is centralized in
// `pinsToFeatureCollection` below.
export type PinLike = {
  is_working: boolean;
  ranking_score?: number | null;
  current_status?: string | null;
};
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

export function basePinIcon(p: PinLike): "pin-broken" | "pin-gold" | "pin-standard" {
  if (!p.is_working || p.current_status === "not_working") return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  return "pin-standard";
}

export function pinsToFeatureCollection(
  pins: PinInput[],
): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps> {
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
        icon: basePinIcon(p),
        pill: formatPill(p.average_rating ?? null),
      },
    })),
  };
}
