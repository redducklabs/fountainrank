import { describe, expect, it } from "vitest";

import { AuthSessionError } from "../auth/state";
import { ApiError } from "../api";
import { buildPhotoUpload, mapPhotoUploadError, PhotoUploadError } from "./photo-upload";

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
