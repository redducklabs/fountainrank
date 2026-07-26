import type { components } from "@fountainrank/api-client";

type FountainPin = components["schemas"]["FountainPin"];

export const FAR_NEAREST_THRESHOLD_M = 50_000;

export function formatNearestDistance(distanceM: number): string {
  if (distanceM < 1_000) return `${Math.max(1, Math.round(distanceM))} m`;
  const km = distanceM / 1_000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-US")} km`;
}

export function requiresFarNearestConfirmation(distanceM: number): boolean {
  return distanceM > FAR_NEAREST_THRESHOLD_M;
}

export function mergeNearestPin(pins: FountainPin[], nearest: FountainPin | null): FountainPin[] {
  if (!nearest) return pins;
  return [nearest, ...pins.filter((pin) => pin.id !== nearest.id)];
}
