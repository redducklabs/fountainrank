import { isAuthSessionError } from "../auth/state";
import { mapContributionError, type ContributionError } from "../contributions/state";

/** The minimal shape `buildPhotoFormData` needs from an `expo-image-picker`
 *  `ImagePickerAsset` — kept narrow so this stays unit-testable without the native module. */
export type PickedPhotoAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

/** Build the multipart body for `client.uploadMultipart(...)`. React Native's `fetch`
 *  recognizes the `{ uri, name, type }` shape as a file part (unlike web, where a `Blob`/`File`
 *  is required) - see `mobile/lib/api.ts`'s `uploadMultipart` for the shared sanitized path
 *  this is sent through. Falls back to a generic JPEG name/type when the picker didn't supply
 *  one (`launchImageLibraryAsync({ quality: 0.9 })` without `allowsEditing` always emits JPEG). */
export function buildPhotoFormData(asset: PickedPhotoAsset): FormData {
  const formData = new FormData();
  const name = asset.fileName?.trim() || `photo-${Date.now()}.jpg`;
  const type = asset.mimeType?.trim() || "image/jpeg";
  // React Native's FormData accepts this file-descriptor object even though it isn't a real
  // `Blob` - cast through `unknown` since `FormData.append`'s DOM typing only allows `Blob`.
  formData.append("file", { uri: asset.uri, name, type } as unknown as Blob);
  return formData;
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
