import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionError } from "../auth/state";
import { ApiError } from "../api";
import { buildPhotoFormData, mapPhotoUploadError, PhotoUploadError } from "./photo-upload";

// The DOM `FormData` implementation (used by vitest's jsdom/node environment) only accepts a
// `Blob`/`string` value and silently stringifies anything else via `toString()` - it cannot
// round-trip the `{ uri, name, type }` file-descriptor object React Native's `FormData`
// natively accepts. Stub `FormData` with a minimal fake that just records `append` calls so
// this test exercises `buildPhotoFormData`'s actual output shape (RN's real behavior), not an
// artifact of the test environment's stricter `FormData`.
class FakeFormData {
  calls: [string, unknown][] = [];
  append(key: string, value: unknown): void {
    this.calls.push([key, value]);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildPhotoFormData", () => {
  it("uses the asset's fileName/mimeType when present", () => {
    vi.stubGlobal("FormData", FakeFormData);
    const formData = buildPhotoFormData({
      uri: "file:///photo.jpg",
      fileName: "sunset.jpg",
      mimeType: "image/jpeg",
    }) as unknown as FakeFormData;
    expect(formData.calls).toEqual([
      ["file", { uri: "file:///photo.jpg", name: "sunset.jpg", type: "image/jpeg" }],
    ]);
  });

  it("falls back to a generic JPEG name/type when the picker omits them", () => {
    vi.stubGlobal("FormData", FakeFormData);
    const formData = buildPhotoFormData({ uri: "file:///photo.jpg" }) as unknown as FakeFormData;
    const [key, value] = formData.calls[0];
    const file = value as { uri: string; name: string; type: string };
    expect(key).toBe("file");
    expect(file.uri).toBe("file:///photo.jpg");
    expect(file.name).toMatch(/^photo-\d+\.jpg$/);
    expect(file.type).toBe("image/jpeg");
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
