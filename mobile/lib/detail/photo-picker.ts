import type { PickedPhotoAsset } from "./photo-upload";

export type PhotoSource = "camera" | "library";

type PermissionResult = { granted: boolean };
type PickerResult = {
  canceled: boolean;
  assets: PickedPhotoAsset[] | null;
};

export type PhotoPickerDependencies = {
  requestCameraPermissionsAsync: () => Promise<PermissionResult>;
  requestMediaLibraryPermissionsAsync: () => Promise<PermissionResult>;
  launchCameraAsync: (options: typeof PHOTO_PICKER_OPTIONS) => Promise<PickerResult>;
  launchImageLibraryAsync: (options: typeof PHOTO_PICKER_OPTIONS) => Promise<PickerResult>;
};

export type PhotoSelectionResult =
  | { kind: "picked"; asset: PickedPhotoAsset }
  | { kind: "denied"; source: PhotoSource }
  | { kind: "canceled" };

/** Both native sources intentionally share one policy and the caller's existing upload path. */
export const PHOTO_PICKER_OPTIONS = {
  mediaTypes: "images" as const,
  quality: 0.9,
};

export async function selectPhoto(
  source: PhotoSource,
  picker: PhotoPickerDependencies,
): Promise<PhotoSelectionResult> {
  const permission =
    source === "camera"
      ? await picker.requestCameraPermissionsAsync()
      : await picker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: "denied", source };

  const result =
    source === "camera"
      ? await picker.launchCameraAsync(PHOTO_PICKER_OPTIONS)
      : await picker.launchImageLibraryAsync(PHOTO_PICKER_OPTIONS);
  if (result.canceled || !result.assets || result.assets.length === 0) return { kind: "canceled" };

  const { uri, fileName, mimeType } = result.assets[0];
  return { kind: "picked", asset: { uri, fileName, mimeType } };
}
