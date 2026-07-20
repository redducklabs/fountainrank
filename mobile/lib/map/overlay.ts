import type { ViewState } from "../view-state";

/**
 * The persistent stale-pins copy (spec §5): shown when the bbox query is in error BUT still holds
 * previously loaded pins (`isError && data != null`). The map keeps rendering the saved pins, so
 * this is a non-blocking "we're showing you slightly old data" notice, not the full error overlay.
 */
export const STALE_PINS_MESSAGE = "Couldn't refresh fountains — showing saved data";

export type MapOverlayModel =
  | { kind: "hidden" }
  | {
      kind: "banner";
      /** Which spinner (if any) to show alongside the message. */
      spinner: "loading" | "updating" | null;
      /** The banner message, or `null` for a spinner-only banner. */
      message: string | null;
      /** Whether the message is a tappable retry affordance. */
      retryable: boolean;
      /** True only for the stale-pins state (drives the alert styling/announcement). */
      stale: boolean;
      // Accessibility contract: a stale-pins banner is a polite live-region ALERT so a screen
      // reader announces "showing saved data" without interrupting; every other banner is silent
      // (the refetch/loading spinner already carries its own progressbar label).
      accessibilityRole: "alert" | undefined;
      accessibilityLiveRegion: "polite" | "none";
    };

/**
 * Pure decision for the mobile map's status overlay (spec §5). Node-safe so the banner's copy and
 * accessibility contract are testable without rendering the React Native component.
 *
 * The `stalePins` input is `pinsQuery.isError && pinsQuery.data != null` — an already-cached
 * viewport whose refetch failed but that still holds pins. It takes precedence over the
 * offline/error message, because the map is still showing usable (if slightly stale) data. The
 * NEW-key error shape (`isError && data == null`, so `stalePins` is false) keeps the existing full
 * offline/error overlay.
 *
 * `locating` is `status === "locating"` (the mount-time first fix, spec §5). It replaces the
 * misleading below-zoom hint with "Locating you…" while the app is silently about to fly to the
 * user. Priority: stale-pins > offline/error > locating > below-zoom > empty/capped — so a real
 * offline/error state still wins, and the below-zoom hint returns once the first fix
 * resolves/denies. (below-zoom and offline/error never actually co-occur: the bbox query is
 * disabled below the pin-load zoom, so it can't be offline/error while below-zoom.)
 */
export function resolveMapOverlay(input: {
  belowZoom: boolean;
  viewState: ViewState;
  refetching: boolean;
  capped: boolean;
  stalePins: boolean;
  locating: boolean;
}): MapOverlayModel {
  const loading = input.viewState === "loading";
  const refetching = input.refetching && !loading;

  if (input.stalePins) {
    return {
      kind: "banner",
      spinner: refetching ? "updating" : null,
      message: STALE_PINS_MESSAGE,
      retryable: true,
      stale: true,
      accessibilityRole: "alert",
      accessibilityLiveRegion: "polite",
    };
  }

  const retryable = input.viewState === "offline" || input.viewState === "error";
  let message: string | null = null;
  if (input.viewState === "offline") message = "You appear to be offline";
  else if (input.viewState === "error") message = "Couldn't load fountains";
  else if (input.locating) message = "Locating you…";
  else if (input.belowZoom) message = "Zoom in to see fountains";
  else if (input.viewState === "empty") message = "No fountains in this area";
  else if (input.viewState === "ready" && input.capped)
    message = "Showing the first 500 — zoom in for more";

  if (!loading && !refetching && message == null) return { kind: "hidden" };
  return {
    kind: "banner",
    spinner: loading ? "loading" : refetching ? "updating" : null,
    message,
    retryable,
    stale: false,
    accessibilityRole: undefined,
    accessibilityLiveRegion: "none",
  };
}
