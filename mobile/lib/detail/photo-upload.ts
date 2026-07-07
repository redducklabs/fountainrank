import { isAuthSessionError } from "../auth/state";
import { mapContributionError, type ContributionError } from "../contributions/state";

/** The minimal shape `buildPhotoUpload` needs from an `expo-image-picker`
 *  `ImagePickerAsset` — kept narrow so this stays unit-testable without the native module. */
export type PickedPhotoAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

/** Build the `{ uri, type }` descriptor for `client.uploadMultipart(...)`, which streams the file
 *  via the native `expo-file-system` uploader (see `mobile/lib/api.ts`). We deliberately do NOT
 *  build a `FormData` here: React Native's New Architecture rejects the `{ uri, name, type }`
 *  FormData file-part shape (`Error: Unsupported FormDataPart implementation`), so a `fetch`-based
 *  multipart upload throws before the request leaves the device. Falls back to a generic JPEG mime
 *  type when the picker didn't supply one (`launchImageLibraryAsync({ quality: 0.9 })` without
 *  `allowsEditing` always emits JPEG); the native uploader derives the filename from the `uri`. */
export function buildPhotoUpload(asset: PickedPhotoAsset): { uri: string; type: string } {
  const type = asset.mimeType?.trim() || "image/jpeg";
  return { uri: asset.uri, type };
}

/** Thrown by the upload mutation for a non-2xx `uploadMultipart` result, carrying both the
 *  HTTP status and the (best-effort) parsed error `detail` body - the upload endpoint has two
 *  distinct 409 shapes (`display_name_required` vs `photo_limit_fountain`/`photo_limit_user`)
 *  that only the body disambiguates (mirrors the web `uploadPhoto` action). */
export class PhotoUploadError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail?: unknown,
  ) {
    super(`photo upload failed with status ${status}`);
    this.name = "PhotoUploadError";
  }
}

const PHOTO_LIMIT_DETAILS: ReadonlySet<unknown> = new Set([
  "photo_limit_fountain",
  "photo_limit_user",
]);

/** Map an upload failure to the shared `ContributionError` union. Delegates to
 *  `mapContributionError` for auth-session failures and anything that isn't a
 *  `PhotoUploadError` (e.g. a thrown `ApiError` from an earlier guard), and otherwise applies
 *  the upload endpoint's specific status/detail mapping (design §8.1, mirrors the web
 *  `uploadPhoto` action's `mapStatus`-plus-409-disambiguation logic). */
export function mapPhotoUploadError(error: unknown): ContributionError {
  if (isAuthSessionError(error)) {
    return "unauthenticated";
  }
  if (!(error instanceof PhotoUploadError)) {
    return mapContributionError(error);
  }
  const { status, detail } = error;
  if (status === 401) return "unauthenticated";
  if (status === 404) return "not_found";
  if (status === 422) return "validation";
  if (status === 413 || status === 415) return "file_invalid";
  if (status === 429) return "rate_limited";
  if (status === 409) {
    return PHOTO_LIMIT_DETAILS.has(detail) ? "photo_limit" : "needs_name";
  }
  return "server";
}
