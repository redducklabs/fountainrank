import type { AddFountainError } from "./add-fountain";
import { clampToBound, type Bound, type LngLat } from "./map/placement";

export const NUDGE_STEP_M = 5;

export type AddPhase =
  | "idle"
  | "placing"
  | "details"
  | "submitting"
  | "done"
  | "duplicate"
  | "error";

export type AddState = {
  phase: AddPhase;
  bound: Bound | null;
  pin: LngLat | null;
  working: boolean;
  newId: string | null;
  duplicateId: string | null;
  errorKind: AddFountainError | null;
};

export const initialAddState: AddState = {
  phase: "idle",
  bound: null,
  pin: null,
  working: true,
  newId: null,
  duplicateId: null,
  errorKind: null,
};

export type AddAction =
  | { type: "ENTER" }
  | { type: "CANCEL" }
  | { type: "SET_BOUND"; bound: Bound }
  | { type: "DROP_PIN"; point: LngLat }
  | { type: "NUDGE"; dir: "n" | "s" | "e" | "w" }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SET_WORKING"; working: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_DONE"; fountainId: string }
  | { type: "SUBMIT_DUPLICATE"; fountainId: string }
  | { type: "SUBMIT_ERROR"; errorKind: AddFountainError };

function nudged(pin: LngLat, dir: "n" | "s" | "e" | "w"): LngLat {
  const dLat = NUDGE_STEP_M / 111320;
  const dLng = NUDGE_STEP_M / (111320 * Math.cos((pin.lat * Math.PI) / 180));
  if (dir === "n") return { lng: pin.lng, lat: pin.lat + dLat };
  if (dir === "s") return { lng: pin.lng, lat: pin.lat - dLat };
  if (dir === "e") return { lng: pin.lng + dLng, lat: pin.lat };
  return { lng: pin.lng - dLng, lat: pin.lat };
}

export function addReducer(state: AddState, action: AddAction): AddState {
  switch (action.type) {
    case "ENTER":
      return { ...initialAddState, phase: "placing" };
    case "CANCEL":
      return initialAddState;
    case "SET_BOUND":
      // Only update the bound; NEVER silently move an already-placed pin — a placed coordinate is
      // the user's choice (the hook also freezes bound recomputation once a pin exists).
      return { ...state, bound: action.bound };
    case "DROP_PIN":
      return {
        ...state,
        pin: state.bound ? clampToBound(action.point, state.bound) : action.point,
      };
    case "NUDGE": {
      if (!state.pin) return state;
      const moved = nudged(state.pin, action.dir);
      return { ...state, pin: state.bound ? clampToBound(moved, state.bound) : moved };
    }
    case "NEXT":
      return state.pin && state.phase === "placing" ? { ...state, phase: "details" } : state;
    case "BACK":
      return state.phase === "details" ? { ...state, phase: "placing" } : state;
    case "SET_WORKING":
      return { ...state, working: action.working };
    case "SUBMIT_START":
      return { ...state, phase: "submitting", errorKind: null };
    case "SUBMIT_DONE":
      return { ...state, phase: "done", newId: action.fountainId };
    case "SUBMIT_DUPLICATE":
      return { ...state, phase: "duplicate", duplicateId: action.fountainId };
    case "SUBMIT_ERROR":
      return { ...state, phase: "error", errorKind: action.errorKind };
    default:
      return state;
  }
}
