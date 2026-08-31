export const MAX_UPLOAD_LONG_EDGE = 2048;
export const MAX_UPLOAD_BYTES = 1_500_000;
export const JPEG_QUALITY_ATTEMPTS = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

type Bitmap = Pick<ImageBitmap, "width" | "height" | "close">;
type Canvas = Pick<HTMLCanvasElement, "width" | "height" | "getContext" | "toBlob">;

export type PhotoProcessingDependencies = {
  createImageBitmap: (image: Blob, options: ImageBitmapOptions) => Promise<Bitmap>;
  createCanvas: (width: number, height: number) => Canvas;
  createFile: (bits: BlobPart[], name: string, options: FilePropertyBag) => File;
};

const DEFAULT_DEPENDENCIES: PhotoProcessingDependencies = {
  createImageBitmap: (image, options) => globalThis.createImageBitmap(image, options),
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  createFile: (bits, name, options) => new File(bits, name, options),
};

export class PhotoPreparationError extends Error {
  constructor() {
    super("Could not prepare this photo for upload.");
    this.name = "PhotoPreparationError";
  }
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_UPLOAD_LONG_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function jpegName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return `${stem || "photo"}.jpg`;
}

function encodeJpeg(canvas: Canvas, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Pixel-roundtrip a photo before transfer. Decoding with `from-image` applies
 * EXIF orientation before the canvas is encoded as JPEG, which leaves no source
 * metadata in the upload payload.
 */
export async function preparePhotoForUpload(
  file: File,
  dependencies: PhotoProcessingDependencies = DEFAULT_DEPENDENCIES,
): Promise<File> {
  let bitmap: Bitmap | undefined;
  try {
    bitmap = await dependencies.createImageBitmap(file, { imageOrientation: "from-image" });
    const dimensions = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = dependencies.createCanvas(dimensions.width, dimensions.height);
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoPreparationError();

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

    for (const quality of JPEG_QUALITY_ATTEMPTS) {
      const jpeg = await encodeJpeg(canvas, quality);
      if (jpeg && jpeg.size <= MAX_UPLOAD_BYTES) {
        return dependencies.createFile([jpeg], jpegName(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });
      }
    }
    throw new PhotoPreparationError();
  } catch (error) {
    if (error instanceof PhotoPreparationError) throw error;
    throw new PhotoPreparationError();
  } finally {
    bitmap?.close();
  }
}
