/**
 * Best-effort one-shot browser geolocation for the proximity guard (#3). Resolves the coordinates
 * when granted, or `null` on denial, timeout, or an unavailable API. It NEVER rejects and never
 * blocks — a caller attaches the result to a rating/condition submit and proceeds either way. The
 * coordinates are sent to the backend for a distance check and discarded; they are never stored.
 */
export function getCurrentPositionSafe(
  timeoutMs = 8000,
): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { latitude: number; longitude: number } | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
