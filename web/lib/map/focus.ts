import type { FountainDetail, FountainPin } from "../fountains";
import { CLUSTER_MAX_ZOOM, FOCUSED_PIN_ZOOM } from "./constants";

export type FocusCameraAction = { center: [number, number]; zoom: number };

export function focusCameraAction(fountain: Pick<FountainDetail, "location">): FocusCameraAction {
  return {
    center: [fountain.location.longitude, fountain.location.latitude],
    zoom: FOCUSED_PIN_ZOOM,
  };
}

export function detailToPin(fountain: FountainDetail): FountainPin {
  return {
    id: fountain.id,
    location: fountain.location,
    is_working: fountain.is_working,
    average_rating: fountain.average_rating,
    rating_count: fountain.rating_count,
    ranking_score: fountain.ranking_score,
    current_status: fountain.current_status,
    last_verified_at: fountain.last_verified_at,
  };
}

export function mergeFocusedPin(pins: FountainPin[], focused: FountainPin | null): FountainPin[] {
  if (!focused) return pins;
  return [...pins.filter((pin) => String(pin.id) !== String(focused.id)), focused];
}

export const focusZoomClearsClusters = FOCUSED_PIN_ZOOM > CLUSTER_MAX_ZOOM;

/** Startup location may move the camera only when no explicit fountain owns it. */
export function shouldMoveToStartupLocation(focusId: string): boolean {
  return focusId === "";
}
