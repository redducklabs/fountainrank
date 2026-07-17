// Pure toast timing + content helpers for the actionable toast (spec §3/§4). The MobileToast
// component gains an optional action (e.g. "Open settings"); these node-tested helpers own the
// dismiss-window and the settings-open-failure replacement so the component stays a thin renderer.

/** Auto-dismiss window for a plain toast. */
export const TOAST_AUTO_DISMISS_MS = 3200;
/** A toast WITH an action stays longer so the user has time to reach for it (spec §3). */
export const TOAST_AUTO_DISMISS_WITH_ACTION_MS = 6000;

export function toastAutoDismissMs(hasAction: boolean): number {
  return hasAction ? TOAST_AUTO_DISMISS_WITH_ACTION_MS : TOAST_AUTO_DISMISS_MS;
}

/** The action label for the "location denied permanently" toast. */
export const OPEN_SETTINGS_ACTION_LABEL = "Open settings";

/**
 * The plain REPLACEMENT toast shown when `Linking.openSettings()` rejects (spec §3). It carries no
 * action (the OS cannot open Settings, so re-offering the action is pointless) and nothing about the
 * failure is logged beyond the event name.
 */
export const SETTINGS_OPEN_FAILED_TEXT =
  "Couldn't open Settings. Enable location access in your device settings.";
