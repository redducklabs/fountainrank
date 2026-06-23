import * as Location from "expo-location";
import { useEffect, useState } from "react";

export type LocationStatus = "idle" | "locating" | "granted" | "denied" | "unavailable";

export type ForegroundLocation = {
  status: LocationStatus;
  coords: { latitude: number; longitude: number } | null;
};

/**
 * Request foreground (when-in-use) location once on mount and, if granted, fetch
 * a single current position. NON-BLOCKING: denial or failure leaves the map fully
 * usable (status reflects it; coords stay null). No background location, ever
 * (spec section 20). Never logs coordinates.
 */
export function useForegroundLocation(): ForegroundLocation {
  const [state, setState] = useState<ForegroundLocation>({ status: "idle", coords: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ status: "locating", coords: null });
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          setState({ status: "denied", coords: null });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setState({
          status: "granted",
          coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        });
      } catch {
        if (!cancelled) setState({ status: "unavailable", coords: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
