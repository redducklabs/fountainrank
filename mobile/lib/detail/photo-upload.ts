import { isAuthSessionError } from "../auth/state";
import { mapContributionError, type ContributionError } from "../contributions/state";

/** The minimal shape `buildPhotoUpload` needs from an `expo-image-picker`
 *  `ImagePickerAsset` — kept narrow so this stays unit-testable without the native module. */
export type PickedPhotoAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  width: number;
  height: number;
};

type PhotoUploadAsset = Pick<PickedPhotoAsset, "uri" | "fileName" | "mimeType">;

type PhotoManipulationAction = { resize: { width: number; height: number } };
type PhotoManipulationOptions = { compress: number; format: "jpeg" };

export type PhotoPreparationDependencies = {
  manipulateAsync: (
    uri: string,
    actions: PhotoManipulationAction[],
    options: PhotoManipulationOptions,
  ) => Promise<{ uri: string }>;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; size?: number }>;
  deleteAsync: (uri: string, options: { idempotent: true }) => Promise<void>;
};

const MAX_LONG_EDGE = 2048;
const MAX_UPLOAD_BYTES = 1_500_000;
const JPEG_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

/** A stable error type for the privacy-safe photo-preparation logging seam. */
export class PhotoPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoPreparationError";
  }
}

function resizeAction(asset: PickedPhotoAsset): PhotoManipulationAction[] {
  if (
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0
  ) {
    throw new PhotoPreparationError("photo dimensions are invalid");
  }
  const longEdge = Math.max(asset.width, asset.height);
  if (longEdge <= MAX_LONG_EDGE) return [];

  const scale = MAX_LONG_EDGE / longEdge;
  return [
    {
      resize: {
        width: Math.max(1, Math.round(asset.width * scale)),
        height: Math.max(1, Math.round(asset.height * scale)),
      },
    },
  ];
}

/**
 * Pixel-re-render a picked image to JPEG before its existing native upload. The native
 * manipulator applies the image's orientation when it decodes/re-renders pixels; JPEG output
 * contains no source EXIF metadata. Each oversized generated candidate is removed immediately.
 */
export async function preparePhotoForUpload(
  asset: PickedPhotoAsset,
  dependencies: PhotoPreparationDependencies,
): Promise<{ uri: string; type: "image/jpeg" }> {
  const actions = resizeAction(asset);
  const generatedUris = new Set<string>();

  try {
    for (const quality of JPEG_QUALITIES) {
      const result = await dependencies.manipulateAsync(asset.uri, actions, {
        compress: quality,
        format: "jpeg",
      });
      // A manipulator must produce a distinct generated file. Treat the source URI as a terminal
      // failure so cleanup can never delete a user's selected asset.
      if (result.uri === asset.uri) {
        throw new PhotoPreparationError("photo manipulator did not create a generated file");
      }
      generatedUris.add(result.uri);

      const info = await dependencies.getInfoAsync(result.uri);
      if (!info.exists || typeof info.size !== "number") {
        throw new PhotoPreparationError("generated photo size is unavailable");
      }
      if (info.size <= MAX_UPLOAD_BYTES) {
        return { uri: result.uri, type: "image/jpeg" };
      }

      await dependencies.deleteAsync(result.uri, { idempotent: true });
      generatedUris.delete(result.uri);
    }
    throw new PhotoPreparationError("unable to meet the upload size limit");
  } catch (error) {
    await Promise.all(
      [...generatedUris].map(async (uri) => {
        try {
          await dependencies.deleteAsync(uri, { idempotent: true });
        } catch {
          // Preserve the preparation failure while best-effort cleanup removes every known temporary.
        }
      }),
    );
    if (error instanceof PhotoPreparationError) throw error;
    throw new PhotoPreparationError("photo preparation failed");
  }
}

/** Prepare a generated JPEG, keep it alive for the native upload, then release only that generated
 * cache file after the upload settles. Cleanup is best-effort so a cache deletion failure cannot
 * replace the upload's success value or its actionable transport error. */
export async function prepareAndUploadPhoto<T>(
  asset: PickedPhotoAsset,
  dependencies: PhotoPreparationDependencies,
  upload: (prepared: { uri: string; type: "image/jpeg" }) => Promise<T>,
): Promise<T> {
  const prepared = await preparePhotoForUpload(asset, dependencies);
  try {
    return await upload(prepared);
  } finally {
    try {
      await dependencies.deleteAsync(prepared.uri, { idempotent: true });
    } catch {
      // The upload has already settled; cache cleanup must not change its observable outcome.
    }
  }
}

/** Build the `{ uri, type }` descriptor for `client.uploadMultipart(...)`, which streams the file
 *  via the native `expo-file-system` uploader (see `mobile/lib/api.ts`). We deliberately do NOT
 *  build a `FormData` here: React Native's New Architecture rejects the `{ uri, name, type }`
 *  FormData file-part shape (`Error: Unsupported FormDataPart implementation`), so a `fetch`-based
 *  multipart upload throws before the request leaves the device. Falls back to a generic JPEG mime
 *  type when the picker didn't supply one (`launchImageLibraryAsync({ quality: 1 })` without
 *  `allowsEditing` always emits JPEG); the native uploader derives the filename from the `uri`. */
export function buildPhotoUpload(asset: PhotoUploadAsset): { uri: string; type: string } {
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
