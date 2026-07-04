// Pure helpers for sharing a fountain (#168). Kept free of `react-native` imports so the
// node/vitest pure-helper suite can exercise them without RN module resolution — the caller
// passes `Platform.OS` in.

/** Build the public web URL for a fountain, tolerating a trailing slash on the base. */
export function fountainShareUrl(webBaseUrl: string, id: string): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/fountains/${id}`;
}

/**
 * Platform-aware `Share.share` payload. Android's share sheet ignores the `url` slot, so the
 * URL must ride in `message` there or targets receive an empty share; iOS uses the native `url`.
 */
export function shareContent(
  url: string,
  platformOS: string,
): { url: string } | { message: string } {
  return platformOS === "android" ? { message: url } : { url };
}
