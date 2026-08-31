import { describe, expect, it, vi } from "vitest";

import { AuthSessionError } from "../auth/state";
import { ApiError } from "../api";
import {
  buildPhotoUpload,
  mapPhotoUploadError,
  PhotoUploadError,
  preparePhotoForUpload,
  prepareAndUploadPhoto,
  type PhotoPreparationDependencies,
} from "./photo-upload";

const source = {
  uri: "file:///source.jpg",
  fileName: "source.jpg",
  mimeType: "image/jpeg",
  width: 4000,
  height: 2000,
};

function preparationDependencies(sizes: Record<string, number>): PhotoPreparationDependencies & {
  manipulateAsync: ReturnType<typeof vi.fn>;
  getInfoAsync: ReturnType<typeof vi.fn>;
  deleteAsync: ReturnType<typeof vi.fn>;
} {
  let output = 0;
  return {
    manipulateAsync: vi.fn(async () => ({ uri: `file:///generated-${++output}.jpg` })),
    getInfoAsync: vi.fn(async (uri: string) => ({ exists: true, size: sizes[uri] })),
    deleteAsync: vi.fn(async () => undefined),
  };
}

describe("buildPhotoUpload", () => {
  it("passes the asset's uri and mimeType through (fileName is not needed - the native uploader derives it)", () => {
    expect(
      buildPhotoUpload({ uri: "file:///photo.png", fileName: "sunset.png", mimeType: "image/png" }),
    ).toEqual({ uri: "file:///photo.png", type: "image/png" });
  });

  it("falls back to a generic JPEG type when the picker omits the mime type", () => {
    expect(buildPhotoUpload({ uri: "file:///photo.jpg" })).toEqual({
      uri: "file:///photo.jpg",
      type: "image/jpeg",
    });
  });

  it("treats a blank mime type as the JPEG fallback", () => {
    expect(buildPhotoUpload({ uri: "file:///photo.jpg", mimeType: "   " })).toEqual({
      uri: "file:///photo.jpg",
      type: "image/jpeg",
    });
  });
});

describe("preparePhotoForUpload", () => {
  it("scales a photo whose long edge exceeds 2048 pixels and returns a JPEG descriptor", async () => {
    const deps = preparationDependencies({ "file:///generated-1.jpg": 1_500_000 });

    await expect(preparePhotoForUpload(source, deps)).resolves.toEqual({
      uri: "file:///generated-1.jpg",
      type: "image/jpeg",
    });
    expect(deps.manipulateAsync).toHaveBeenCalledWith(
      source.uri,
      [{ resize: { width: 2048, height: 1024 } }],
      { compress: 0.85, format: "jpeg" },
    );
  });

  it("does not enlarge a small photo while still re-rendering it as JPEG", async () => {
    const small = { ...source, width: 1200, height: 800 };
    const deps = preparationDependencies({ "file:///generated-1.jpg": 900_000 });

    await expect(preparePhotoForUpload(small, deps)).resolves.toEqual({
      uri: "file:///generated-1.jpg",
      type: "image/jpeg",
    });
    expect(deps.manipulateAsync).toHaveBeenCalledWith(small.uri, [], {
      compress: 0.85,
      format: "jpeg",
    });
  });

  it("tries bounded JPEG qualities in order and accepts the exact byte boundary", async () => {
    const deps = preparationDependencies({
      "file:///generated-1.jpg": 1_600_000,
      "file:///generated-2.jpg": 1_500_000,
    });

    await expect(preparePhotoForUpload(source, deps)).resolves.toEqual({
      uri: "file:///generated-2.jpg",
      type: "image/jpeg",
    });
    expect(deps.manipulateAsync).toHaveBeenNthCalledWith(
      1,
      source.uri,
      [{ resize: { width: 2048, height: 1024 } }],
      { compress: 0.85, format: "jpeg" },
    );
    expect(deps.manipulateAsync).toHaveBeenNthCalledWith(
      2,
      source.uri,
      [{ resize: { width: 2048, height: 1024 } }],
      { compress: 0.75, format: "jpeg" },
    );
  });

  it("deletes only oversized generated files and never deletes the source asset", async () => {
    const deps = preparationDependencies({
      "file:///generated-1.jpg": 1_600_000,
      "file:///generated-2.jpg": 1_400_000,
    });

    await preparePhotoForUpload(source, deps);

    expect(deps.deleteAsync).toHaveBeenCalledWith("file:///generated-1.jpg", { idempotent: true });
    expect(deps.deleteAsync).not.toHaveBeenCalledWith(source.uri, expect.anything());
  });

  it("cleans every generated oversized file and rejects after the bounded attempts fail", async () => {
    const sizes = Object.fromEntries(
      [1, 2, 3, 4, 5].map((index) => [`file:///generated-${index}.jpg`, 1_500_001]),
    );
    const deps = preparationDependencies(sizes);

    await expect(preparePhotoForUpload(source, deps)).rejects.toThrow(
      "unable to meet the upload size limit",
    );
    expect(deps.deleteAsync).toHaveBeenCalledTimes(5);
    expect(deps.deleteAsync).not.toHaveBeenCalledWith(source.uri, expect.anything());
  });

  it("converts a native processing failure into a stable preparation error", async () => {
    const deps = preparationDependencies({});
    vi.mocked(deps.manipulateAsync).mockRejectedValueOnce(new Error("native failure"));

    await expect(preparePhotoForUpload(source, deps)).rejects.toMatchObject({
      name: "PhotoPreparationError",
    });
  });
});

describe("prepareAndUploadPhoto", () => {
  it("deletes the accepted generated JPEG after a successful upload", async () => {
    const deps = preparationDependencies({ "file:///generated-1.jpg": 1_400_000 });
    const upload = vi.fn(async () => "uploaded");

    await expect(prepareAndUploadPhoto(source, deps, upload)).resolves.toBe("uploaded");

    expect(upload).toHaveBeenCalledWith({
      uri: "file:///generated-1.jpg",
      type: "image/jpeg",
    });
    expect(deps.deleteAsync).toHaveBeenCalledWith("file:///generated-1.jpg", {
      idempotent: true,
    });
    expect(deps.deleteAsync).not.toHaveBeenCalledWith(source.uri, expect.anything());
  });

  it("deletes the accepted generated JPEG and preserves the upload error after failure", async () => {
    const deps = preparationDependencies({ "file:///generated-1.jpg": 1_400_000 });
    const failure = new Error("upload failed");
    const upload = vi.fn().mockRejectedValue(failure);

    await expect(prepareAndUploadPhoto(source, deps, upload)).rejects.toBe(failure);

    expect(deps.deleteAsync).toHaveBeenCalledWith("file:///generated-1.jpg", {
      idempotent: true,
    });
    expect(deps.deleteAsync).not.toHaveBeenCalledWith(source.uri, expect.anything());
  });

  it("does not let a cache cleanup failure replace a settled upload result", async () => {
    const deps = preparationDependencies({ "file:///generated-1.jpg": 1_400_000 });
    vi.mocked(deps.deleteAsync).mockRejectedValue(new Error("cleanup failed"));

    await expect(prepareAndUploadPhoto(source, deps, async () => "uploaded")).resolves.toBe(
      "uploaded",
    );
  });
});

describe("mapPhotoUploadError", () => {
  it("maps an auth session error to unauthenticated", () => {
    expect(mapPhotoUploadError(new AuthSessionError("token_unavailable"))).toBe("unauthenticated");
  });

  it("maps 401/404/422/413/415/429 to their friendly codes", () => {
    expect(mapPhotoUploadError(new PhotoUploadError(401))).toBe("unauthenticated");
    expect(mapPhotoUploadError(new PhotoUploadError(404))).toBe("not_found");
    expect(mapPhotoUploadError(new PhotoUploadError(422))).toBe("validation");
    expect(mapPhotoUploadError(new PhotoUploadError(413))).toBe("file_invalid");
    expect(mapPhotoUploadError(new PhotoUploadError(415))).toBe("file_invalid");
    expect(mapPhotoUploadError(new PhotoUploadError(429))).toBe("rate_limited");
  });

  it("disambiguates the two 409 shapes via the detail body", () => {
    expect(mapPhotoUploadError(new PhotoUploadError(409, "photo_limit_fountain"))).toBe(
      "photo_limit",
    );
    expect(mapPhotoUploadError(new PhotoUploadError(409, "photo_limit_user"))).toBe("photo_limit");
    expect(mapPhotoUploadError(new PhotoUploadError(409, "display_name_required"))).toBe(
      "needs_name",
    );
    expect(mapPhotoUploadError(new PhotoUploadError(409))).toBe("needs_name");
  });

  it("falls back to server for an unmapped status", () => {
    expect(mapPhotoUploadError(new PhotoUploadError(500))).toBe("server");
  });

  it("delegates to mapContributionError for a non-PhotoUploadError (e.g. a thrown ApiError)", () => {
    expect(mapPhotoUploadError(new ApiError(401))).toBe("unauthenticated");
    expect(mapPhotoUploadError(new TypeError("offline"))).toBe("network");
  });
});
