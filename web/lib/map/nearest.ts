export const FAR_NEAREST_THRESHOLD_M = 50_000;

export function formatNearestDistance(distanceM: number): string {
  if (distanceM < 1_000) return `${Math.max(1, Math.round(distanceM))} m`;
  const km = distanceM / 1_000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-US")} km`;
}

export function requiresFarNearestConfirmation(distanceM: number): boolean {
  return distanceM > FAR_NEAREST_THRESHOLD_M;
}
