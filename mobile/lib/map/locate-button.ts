// Pure locate-button descriptor (spec §4). The button is always mounted (no coords mount gate); its
// visual + accessibility contract is a pure function of the foreground-location state, so the four
// states are node-tested and the screen consumes the descriptor's fields WITHOUT reconstructing
// them. The returned tone/visual are structural tokens (no theme import) the component maps to
// styles.

import type { LocationStatus } from "../location";

/** The button visual: a spinner while acquiring a fix, or the locate icon in a brand/muted tone. */
export type LocateButtonVisual = { kind: "spinner" } | { kind: "icon"; tone: "brand" | "muted" };

/**
 * The busy predicate shared by the descriptor and the locate-press gate (spec §4): a fix is being
 * acquired (mount `status === "locating"`) OR a locate `refresh` is in flight. A busy press is a
 * no-op — enforced authoritatively by the session's single-flight (covering BOTH acquisition and
 * refresh) and short-circuited at the hook so it never even starts a second request. The button
 * announces busy without being `disabled`.
 */
export function isLocateBusy(status: LocationStatus, refreshing: boolean): boolean {
  return refreshing || status === "locating";
}

export type LocateButtonDescriptor = {
  visual: LocateButtonVisual;
  accessibilityRole: "button";
  accessibilityLabel: string;
  /** Present only when it adds information beyond the label (the denied/unavailable states). */
  accessibilityHint?: string;
  /**
   * `busy` while acquiring a fix: the control announces busy (a press is a no-op via the hook's
   * single-flight) but is NOT marked `disabled` - it stays a live, announced control.
   */
  accessibilityState: { busy: boolean };
};

/**
 * Maps `{ status, refreshing, canAskAgain }` to the locate-button descriptor (spec §4):
 * - acquiring (`status === "locating"` or `refreshing`): a spinner, `busy: true`, presses ignored.
 * - denied / unavailable: the muted icon, still actionable (it retries permission), with a hint that
 *   mentions Settings only when the OS will not re-prompt (`canAskAgain === false`).
 * - otherwise (granted / idle): the brand icon, "Center on my location".
 */
export function locateButtonDescriptor(input: {
  status: LocationStatus;
  refreshing: boolean;
  canAskAgain: boolean;
}): LocateButtonDescriptor {
  if (isLocateBusy(input.status, input.refreshing)) {
    return {
      visual: { kind: "spinner" },
      accessibilityRole: "button",
      accessibilityLabel: "Finding your location",
      accessibilityState: { busy: true },
    };
  }
  if (input.status === "denied" || input.status === "unavailable") {
    return {
      visual: { kind: "icon", tone: "muted" },
      accessibilityRole: "button",
      accessibilityLabel: "Location unavailable — tap to retry",
      accessibilityHint: input.canAskAgain
        ? "Retries finding your location"
        : "Location access is off — opens Settings to enable it",
      accessibilityState: { busy: false },
    };
  }
  return {
    visual: { kind: "icon", tone: "brand" },
    accessibilityRole: "button",
    accessibilityLabel: "Center on my location",
    accessibilityState: { busy: false },
  };
}
