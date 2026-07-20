import { describe, expect, it, vi } from "vitest";

import {
  PHOTO_PICKER_OPTIONS,
  selectPhoto,
  type PhotoPickerDependencies,
} from "./photo-picker";

function dependencies(): PhotoPickerDependencies {
  return {
    requestCameraPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
    requestMediaLibraryPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
    launchCameraAsync: vi.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///camera.jpg", fileName: "camera.jpg", mimeType: "image/jpeg" }],
    }),
    launchImageLibraryAsync: vi.fn().mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///library.jpg", fileName: "library.jpg", mimeType: "image/jpeg" }],
    }),
  };
}

describe("selectPhoto", () => {
  it("routes camera selection through camera permission and forwards its asset", async () => {
    const deps = dependencies();
    await expect(selectPhoto("camera", deps)).resolves.toEqual({
      kind: "picked",
      asset: { uri: "file:///camera.jpg", fileName: "camera.jpg", mimeType: "image/jpeg" },
    });
    expect(deps.requestCameraPermissionsAsync).toHaveBeenCalledOnce();
    expect(deps.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(deps.launchCameraAsync).toHaveBeenCalledWith(PHOTO_PICKER_OPTIONS);
    expect(deps.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it("routes library selection only through library permission", async () => {
    const deps = dependencies();
    await expect(selectPhoto("library", deps)).resolves.toMatchObject({
      kind: "picked",
      asset: { uri: "file:///library.jpg" },
    });
    expect(deps.requestMediaLibraryPermissionsAsync).toHaveBeenCalledOnce();
    expect(deps.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(deps.launchImageLibraryAsync).toHaveBeenCalledWith(PHOTO_PICKER_OPTIONS);
    expect(deps.launchCameraAsync).not.toHaveBeenCalled();
  });

  it.each(["camera", "library"] as const)(
    "returns source-specific denial without launching %s",
    async (source) => {
      const deps = dependencies();
      const permission =
        source === "camera"
          ? deps.requestCameraPermissionsAsync
          : deps.requestMediaLibraryPermissionsAsync;
      vi.mocked(permission).mockResolvedValue({ granted: false });
      await expect(selectPhoto(source, deps)).resolves.toEqual({ kind: "denied", source });
      expect(deps.launchCameraAsync).not.toHaveBeenCalled();
      expect(deps.launchImageLibraryAsync).not.toHaveBeenCalled();
    },
  );

  it.each(["camera", "library"] as const)("treats a canceled %s picker as a no-op", async (source) => {
    const deps = dependencies();
    const launch = source === "camera" ? deps.launchCameraAsync : deps.launchImageLibraryAsync;
    vi.mocked(launch).mockResolvedValue({ canceled: true, assets: [] });
    await expect(selectPhoto(source, deps)).resolves.toEqual({ kind: "canceled" });
  });
});
