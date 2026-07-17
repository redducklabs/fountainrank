// Pure one-time-center camera policy (spec §6). The map camera auto-centers on the user exactly
// once - the first resolved fix - and never again; live watch updates move the blue dot but not the
// camera. Explicit user actions (locate press, use-current-location, add-mode entry) always command
// the camera. This is a pure decision function so the "exactly one command" invariants (including
// the combined locate-press-first-fix case) are node-tested; the screen owns the state and executes
// the returned commands.

import type { LngLat } from "../add-fountain/placement";
import { INITIAL_USER_ZOOM, PLACE_MIN_ZOOM } from "./constants";

/** A camera move for the screen to execute (fed to `setFlyTo`). */
export type CameraCommand = { center: LngLat; zoom: number; framedAboveSheet?: boolean };

/** The one-shot: whether the initial auto-center has already been consumed. */
export type CameraState = { hasInitiallyCentered: boolean };

export const initialCameraState: CameraState = { hasInitiallyCentered: false };

/**
 * Camera-relevant events. A `fix` is a resolved position from any producer (the source is
 * informational - the first fix centers regardless of which producer delivered it). The explicit
 * actions carry the coordinates the user's gesture targets; a `locatePress` may resolve WITHOUT
 * coordinates (denial/failure), which commands nothing and leaves the one-shot unconsumed.
 */
export type CameraEvent =
  | { type: "fix"; source: "initial" | "watch" | "refresh"; coords: LngLat }
  | { type: "locatePress"; coords: LngLat | null }
  | { type: "useCurrentLocation"; coords: LngLat }
  | { type: "addModeEntry"; target: LngLat };

export type CameraPolicyResult = { state: CameraState; command: CameraCommand | null };

/**
 * Decides the next camera state + command for an event (spec §6):
 * - `fix`: the FIRST resolved fix (regardless of source/arrival order) emits one initial-center
 *   command and consumes the one-shot; every later fix (live watch movement) commands nothing.
 * - `locatePress` WITH coords: always recenters and consumes the one-shot - so a press that yields
 *   the first fix emits exactly one command (this branch), and the subsequent `fix` event, seeing
 *   the one-shot consumed, adds none. WITHOUT coords (denied/failed): commands nothing and leaves
 *   the one-shot unconsumed for a later genuine first fix.
 * - `useCurrentLocation` / `addModeEntry`: always command (framed above the add sheet) and consume
 *   the one-shot, so a subsequent first fix never yanks the camera away from the user's placement.
 */
export function nextCameraPolicy(state: CameraState, event: CameraEvent): CameraPolicyResult {
  switch (event.type) {
    case "fix":
      if (state.hasInitiallyCentered) return { state, command: null };
      return {
        state: { hasInitiallyCentered: true },
        command: { center: event.coords, zoom: INITIAL_USER_ZOOM },
      };
    case "locatePress":
      if (event.coords === null) return { state, command: null };
      return {
        state: { hasInitiallyCentered: true },
        command: { center: event.coords, zoom: INITIAL_USER_ZOOM },
      };
    case "useCurrentLocation":
      return {
        state: { hasInitiallyCentered: true },
        command: { center: event.coords, zoom: PLACE_MIN_ZOOM, framedAboveSheet: true },
      };
    case "addModeEntry":
      return {
        state: { hasInitiallyCentered: true },
        command: { center: event.target, zoom: PLACE_MIN_ZOOM, framedAboveSheet: true },
      };
  }
}
