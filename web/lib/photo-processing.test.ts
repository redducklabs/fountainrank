// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  JPEG_QUALITY_ATTEMPTS,
  MAX_UPLOAD_BYTES,
  parseJpegMetadataBytes,
  preparePhotoForUpload,
  type PhotoProcessingDependencies,
} from "./photo-processing";

type DrawCall = { image: unknown; x: number; y: number; width: number; height: number };
type TestDependencies = PhotoProcessingDependencies & {
  createCanvas: Mock;
  createImageBitmap: Mock;
};

type Matrix = [number, number, number, number, number, number];

const GENUINE_EXIF_6_JPEG_BASE64 =
  "/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAASAAwDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAACgn/xAAuEAAAAwYDBAsAAAAAAAAAAAAFBxQDBAYIExYAFRgJFzWmIyQlJjhXZoa21ub/xAAXAQEBAQEAAAAAAAAAAAAAAAAKCAsJ/8QANxEAAAMHAQIIDwAAAAAAAAAABgcIAAQFFBUWFwklNgMZGiQmaKfnChgnNzlWV4WIpai2uNXX/9oADAMBAAIRAxEAPwCaWzyioBOWcIoS2LZ/uSNYkv8AyUFSvoOtycr42HhHtEedwsJd04SFv731t/YVqFBhVeWrFi0j5eWmotdJ6UDVP8/yWsEpADY12i3IxTCmk3SZIPBUB2CCh2IxM/z4mEcGhuzYM+Ss5OPkvD3d6euA7Da06y02rj0zlKpcS4Y+UD2NDDljAazx6Cq5ZR/FWYgm6TGIFwkDoZTAcEhDGNsCGHztPp8Pm4o9uLi8p10eTGeXfN0C/Z8HIziV3rR8kEX6lgQ8Vuu32GdppO/0FjvbKSVvThP0Qpz31eVm70u7dsW7mVxEuYsKcYuEcRo88X8KelCVL0FdSx1HNXsM+Pzp2qFSZO4oyvibp/LX1QLFPEszK3VmAdVarZ1F3kh0jUajzyTkHpd690VcV6k0110ZLzjg6xfJdZuM7oyYZQOJ/fa6jAolEyBcW6MXqVIpHMJ+puTLdVXoPmj87gQ/Jk+u19Nvf2xvOUOdUHt/7lGMPKD4iS892/Bomw6I6fNmJfc33BCmZd4S16E1anw5floQ7W8xBLZPrf/Z";

function multiply(matrix: Matrix, next: Matrix): Matrix {
  const [a, b, c, d, e, f] = matrix;
  const [na, nb, nc, nd, ne, nf] = next;
  return [
    a * na + c * nb,
    b * na + d * nb,
    a * nc + c * nd,
    b * nc + d * nd,
    a * ne + c * nf + e,
    b * ne + d * nf + f,
  ];
}

function createSoftwareCanvasDependencies(
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
  {
    sourcePixels = [
      ["A", "B"],
      ["C", "D"],
      ["E", "F"],
    ],
    decoderHonorsExifOrientation = false,
  }: {
    sourcePixels?: string[][];
    decoderHonorsExifOrientation?: boolean;
  } = {},
) {
  const source = {
    pixels: sourcePixels,
  } as unknown as CanvasImageSource;
  const sourceWidth = sourcePixels[0].length;
  const sourceHeight = sourcePixels.length;
  const dependencies: PhotoProcessingDependencies = {
    createCanvas: (width, height) => {
      let matrix: Matrix = [1, 0, 0, 1, 0, 0];
      let saved: Matrix = matrix;
      const pixels = Array.from({ length: height }, () => Array.from({ length: width }, () => "?"));
      const context = {
        fillStyle: "",
        fillRect: vi.fn(),
        save: vi.fn(() => {
          saved = [...matrix] as Matrix;
        }),
        restore: vi.fn(() => {
          matrix = saved;
        }),
        translate: vi.fn((x: number, y: number) => {
          matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
        }),
        rotate: vi.fn((angle: number) => {
          matrix = multiply(matrix, [
            Math.cos(angle),
            Math.sin(angle),
            -Math.sin(angle),
            Math.cos(angle),
            0,
            0,
          ]);
        }),
        scale: vi.fn((x: number, y: number) => {
          matrix = multiply(matrix, [x, 0, 0, y, 0, 0]);
        }),
        drawImage: vi.fn((image: typeof source, x: number, y: number) => {
          const sourcePixels = (image as unknown as { pixels: string[][] }).pixels;
          for (let sourceY = 0; sourceY < sourcePixels.length; sourceY += 1) {
            for (let sourceX = 0; sourceX < sourcePixels[0].length; sourceX += 1) {
              const pointX = x + sourceX + 0.5;
              const pointY = y + sourceY + 0.5;
              const outputX = Math.floor(matrix[0] * pointX + matrix[2] * pointY + matrix[4]);
              const outputY = Math.floor(matrix[1] * pointX + matrix[3] * pointY + matrix[5]);
              pixels[outputY][outputX] = sourcePixels[sourceY][sourceX];
            }
          }
        }),
      };
      return {
        width,
        height,
        getContext: () => context,
        toBlob: (callback: BlobCallback) =>
          callback(new Blob([pixels.map((row) => row.join("")).join("/")], { type: "image/jpeg" })),
      } as unknown as HTMLCanvasElement;
    },
    createFile: (parts, name, options) => new File(parts, name, options),
    loadImage: async () => ({
      source,
      width: sourceWidth,
      height: sourceHeight,
      close: vi.fn(),
    }),
    readJpegMetadata: async () => ({
      orientation,
      width: sourceWidth,
      height: sourceHeight,
    }),
    imageElementHonorsExifOrientation: async () => decoderHonorsExifOrientation,
  };
  return dependencies;
}

function orientedJpegBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a,
    0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

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
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
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

  it("parses a non-default EXIF JPEG orientation and its raw pixel dimensions", async () => {
    expect(parseJpegMetadataBytes(orientedJpegBytes())).toEqual({
      orientation: 6,
      width: 2,
      height: 1,
    });
  });

  it("renders upright fallback pixels from a JPEG carrying EXIF orientation 6", async () => {
    const file = new File([orientedJpegBytes()], "oriented.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => orientedJpegBytes().buffer,
    });
    const dependencies = createSoftwareCanvasDependencies(6);
    dependencies.readJpegMetadata = undefined;

    const result = await preparePhotoForUpload(file, dependencies);

    await expect(result.text()).resolves.toBe("ECA/FDB");
  });

  it("parses a genuine EXIF-6 JPEG and applies its transform to decoded fallback pixels", async () => {
    const bytes = Uint8Array.from(atob(GENUINE_EXIF_6_JPEG_BASE64), (value) => value.charCodeAt(0));
    expect(parseJpegMetadataBytes(bytes)).toEqual({ orientation: 6, width: 12, height: 18 });
    const file = new File([bytes], "genuine-oriented.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    const dependencies = createSoftwareCanvasDependencies(6, {
      // The real JPEG contains 6x6 red/green, blue/yellow, and magenta/cyan blocks.
      // jsdom cannot decode JPEGs, so only that browser boundary is represented by labels.
      sourcePixels: [
        ["R", "G"],
        ["B", "Y"],
        ["M", "C"],
      ],
      decoderHonorsExifOrientation: false,
    });
    dependencies.readJpegMetadata = undefined;

    const result = await preparePhotoForUpload(file, dependencies);

    await expect(result.text()).resolves.toBe("MBR/CYG");
  });

  it("applies EXIF orientation to square raw pixels when decoder calibration is false", async () => {
    const dependencies = createSoftwareCanvasDependencies(6, {
      sourcePixels: [
        ["A", "B"],
        ["C", "D"],
      ],
      decoderHonorsExifOrientation: false,
    });

    const result = await preparePhotoForUpload(
      new File([orientedJpegBytes()], "square-raw.jpg", { type: "image/jpeg" }),
      dependencies,
    );

    await expect(result.text()).resolves.toBe("CA/DB");
  });

  it("leaves already-oriented square pixels unchanged when decoder calibration is true", async () => {
    const dependencies = createSoftwareCanvasDependencies(6, {
      sourcePixels: [
        ["C", "A"],
        ["D", "B"],
      ],
      decoderHonorsExifOrientation: true,
    });

    const result = await preparePhotoForUpload(
      new File([orientedJpegBytes()], "square-oriented.jpg", { type: "image/jpeg" }),
      dependencies,
    );

    await expect(result.text()).resolves.toBe("CA/DB");
  });

  it.each([
    [1, "AB/CD/EF"],
    [2, "BA/DC/FE"],
    [3, "FE/DC/BA"],
    [4, "EF/CD/AB"],
    [5, "ACE/BDF"],
    [6, "ECA/FDB"],
    [7, "FDB/ECA"],
    [8, "BDF/ACE"],
  ] as const)(
    "emits upright pixels for EXIF orientation %i",
    async (orientation, expectedPixels) => {
      const file = new File([orientedJpegBytes()], "oriented.jpg", { type: "image/jpeg" });
      const result = await preparePhotoForUpload(
        file,
        createSoftwareCanvasDependencies(orientation),
      );

      await expect(result.text()).resolves.toBe(expectedPixels);
    },
  );

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
    deps.loadImage = vi.fn(async () => {
      throw new Error("fallback decoder details must not reach the UI");
    });

    await expect(preparePhotoForUpload(new File(["source"], "camera.jpg"), deps)).rejects.toEqual(
      expect.objectContaining({ name: "PhotoPreparationError" }),
    );
  });
});
