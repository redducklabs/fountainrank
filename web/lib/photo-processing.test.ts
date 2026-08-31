// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  JPEG_QUALITY_ATTEMPTS,
  MAX_UPLOAD_BYTES,
  preparePhotoForUpload,
  type PhotoProcessingDependencies,
} from "./photo-processing";

type DrawCall = { image: unknown; x: number; y: number; width: number; height: number };
type TestDependencies = PhotoProcessingDependencies & {
  createCanvas: Mock;
  createImageBitmap: Mock;
};

function createDependencies({
  width,
  height,
  blobs,
}: {
  width: number;
  height: number;
  blobs: Array<Blob | null>;
}): TestDependencies & { draws: DrawCall[]; fillRects: Array<[number, number, number, number]> } {
  const draws: DrawCall[] = [];
  const fillRects: Array<[number, number, number, number]> = [];
  const context = {
    fillStyle: "",
    fillRect: vi.fn((x: number, y: number, canvasWidth: number, canvasHeight: number) => {
      fillRects.push([x, y, canvasWidth, canvasHeight]);
    }),
    drawImage: vi.fn(
      (image: unknown, x: number, y: number, canvasWidth: number, canvasHeight: number) => {
        draws.push({ image, x, y, width: canvasWidth, height: canvasHeight });
      },
    ),
  };
  const toBlob = vi.fn((callback: BlobCallback) => callback(blobs.shift() ?? null));
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob,
  } as unknown as HTMLCanvasElement;

  return {
    createImageBitmap: vi.fn(async () => ({ width, height, close: vi.fn() })),
    createCanvas: vi.fn(() => canvas),
    createFile: (parts, name, options) => new File(parts, name, options),
    draws,
    fillRects,
  };
}

describe("preparePhotoForUpload", () => {
  it("resizes the long edge to 2048 pixels and converts the result to JPEG", async () => {
    const deps = createDependencies({
      width: 4096,
      height: 2048,
      blobs: [new Blob(["small"], { type: "image/jpeg" })],
    });

    const result = await preparePhotoForUpload(
      new File(["source"], "camera.png", { type: "image/png" }),
      deps,
    );

    expect(deps.draws).toEqual([
      { image: expect.anything(), x: 0, y: 0, width: 2048, height: 1024 },
    ]);
    expect(result.name).toBe("camera.jpg");
    expect(result.type).toBe("image/jpeg");
  });

  it("does not enlarge an already small image", async () => {
    const deps = createDependencies({
      width: 640,
      height: 480,
      blobs: [new Blob(["small"], { type: "image/jpeg" })],
    });

    await preparePhotoForUpload(new File(["source"], "camera.jpg", { type: "image/jpeg" }), deps);

    expect(deps.draws[0]).toMatchObject({ width: 640, height: 480 });
  });

  it("uses JPEG quality fallbacks until the first payload at or below the byte target", async () => {
    const tooLarge = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: "image/jpeg" });
    const exactTarget = new Blob([new Uint8Array(MAX_UPLOAD_BYTES)], { type: "image/jpeg" });
    const deps = createDependencies({ width: 10, height: 10, blobs: [tooLarge, exactTarget] });

    const result = await preparePhotoForUpload(new File(["source"], "camera.jpg"), deps);

    const canvas = deps.createCanvas.mock.results[0]?.value;
    expect(canvas.toBlob).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      "image/jpeg",
      JPEG_QUALITY_ATTEMPTS[0],
    );
    expect(canvas.toBlob).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      "image/jpeg",
      JPEG_QUALITY_ATTEMPTS[1],
    );
    expect(result.size).toBe(MAX_UPLOAD_BYTES);
  });

  it("uses a white pixel background before drawing transparent source pixels", async () => {
    const deps = createDependencies({
      width: 10,
      height: 5,
      blobs: [new Blob(["small"], { type: "image/jpeg" })],
    });

    await preparePhotoForUpload(
      new File(["transparent"], "camera.png", { type: "image/png" }),
      deps,
    );

    expect(deps.fillRects).toEqual([[0, 0, 10, 5]]);
    const context = deps.createCanvas.mock.results[0]?.value.getContext.mock.results[0]?.value;
    expect(context.fillStyle).toBe("#ffffff");
  });

  it("bakes a non-default EXIF orientation into upright pixels before emitting the JPEG", async () => {
    const deps = createDependencies({
      // createImageBitmap returns orientation-corrected dimensions for a 90°-rotated source.
      width: 400,
      height: 200,
      blobs: [new Blob(["small"], { type: "image/jpeg" })],
    });

    await preparePhotoForUpload(new File(["rotated-exif-image"], "rotated.jpg"), deps);

    expect(deps.createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: "from-image",
    });
    expect(deps.draws[0]).toMatchObject({ width: 400, height: 200 });
  });

  it("fails after the bounded quality attempts when every JPEG exceeds the byte target", async () => {
    const tooLarge = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: "image/jpeg" });
    const deps = createDependencies({
      width: 10,
      height: 10,
      blobs: [tooLarge, tooLarge, tooLarge, tooLarge, tooLarge],
    });

    await expect(preparePhotoForUpload(new File(["source"], "camera.jpg"), deps)).rejects.toThrow(
      "Could not prepare this photo for upload.",
    );
    const canvas = deps.createCanvas.mock.results[0]?.value;
    expect(canvas.toBlob).toHaveBeenCalledTimes(JPEG_QUALITY_ATTEMPTS.length);
  });

  it("maps a terminal image-decode error to the retryable preparation error", async () => {
    const deps = createDependencies({
      width: 10,
      height: 10,
      blobs: [new Blob(["small"], { type: "image/jpeg" })],
    });
    deps.createImageBitmap.mockRejectedValue(new Error("decoder details must not reach the UI"));

    await expect(preparePhotoForUpload(new File(["source"], "camera.jpg"), deps)).rejects.toEqual(
      expect.objectContaining({ name: "PhotoPreparationError" }),
    );
  });
});
