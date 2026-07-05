import type { components } from "@fountainrank/api-client";

type PhotoOut = components["schemas"]["PhotoOut"];

/** `PhotoOut.url`/`thumbnail_url` are API-relative gated read paths
 *  (`/api/v1/photos/{id}`, `.../thumb`) — never a durable object URL (docs/style-guide.md
 *  "Fountain photos (PR 2)"). The mobile app and API are served from different origins, so
 *  the relative path needs the API base prefixed to resolve, the same way the web
 *  `PhotoCarousel` resolves it via `resolveApiBaseUrl()`. */
export function resolvePhotoUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl}${path}`;
}

/** Clamp a possibly-stale active index into range when `photos` shrinks (e.g. after an
 *  owner delete or an admin hide hands back a shorter list while the carousel's active
 *  index still points past the end). Mirrors the web carousel's render-time clamp so the
 *  component never dereferences `photos[index]` out of bounds. */
export function clampPhotoIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/** The delete control is shown only for the currently-visible photo, and only when the
 *  viewer owns it (per-viewer `PhotoOut.is_own`, computed by the backend) and a delete
 *  handler was supplied. Mirrors the web `PhotoCarousel`'s `current.is_own && onDelete` gate. */
export function shouldShowDeleteControl(
  photo: Pick<PhotoOut, "is_own">,
  hasOnDelete: boolean,
): boolean {
  return photo.is_own && hasOnDelete;
}
