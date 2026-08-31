export const MAX_UPLOAD_LONG_EDGE = 2048;
export const MAX_UPLOAD_BYTES = 1_500_000;
export const JPEG_QUALITY_ATTEMPTS = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

type Bitmap = Pick<ImageBitmap, "width" | "height" | "close">;
type Canvas = Pick<HTMLCanvasElement, "width" | "height" | "getContext" | "toBlob">;
type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type JpegMetadata = {
  orientation: Orientation;
  width: number | null;
  height: number | null;
};

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

export type PhotoProcessingDependencies = {
  createImageBitmap?: (image: Blob, options: ImageBitmapOptions) => Promise<Bitmap>;
  createCanvas: (width: number, height: number) => Canvas;
  createFile: (bits: BlobPart[], name: string, options: FilePropertyBag) => File;
  loadImage?: (file: File) => Promise<LoadedImage>;
  readJpegMetadata?: (file: Blob) => Promise<JpegMetadata>;
  imageElementHonorsExifOrientation?: () => Promise<boolean>;
};

export class PhotoPreparationError extends Error {
  constructor() {
    super("Could not prepare this photo for upload.");
    this.name = "PhotoPreparationError";
  }
}

function loadImage(file: Blob): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoPreparationError());
    };
    image.src = url;
  });
}

let imageElementExifProbe: Promise<boolean> | undefined;

function exifOrientationSegment(orientation: Orientation): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PhotoPreparationError())),
      "image/jpeg",
      1,
    );
  });
}

function imageElementHonorsExifOrientation(): Promise<boolean> {
  imageElementExifProbe ??= (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoPreparationError();
    context.fillStyle = "#f00";
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = "#0f0";
    context.fillRect(1, 0, 1, 1);
    const jpeg = await canvasBlob(canvas);
    const bytes = await jpeg.arrayBuffer();
    const oriented = new Blob([bytes.slice(0, 2), exifOrientationSegment(6), bytes.slice(2)], {
      type: "image/jpeg",
    });
    const image = await loadImage(oriented);
    try {
      return image.width === 1 && image.height === 2;
    } finally {
      image.close();
    }
  })();
  return imageElementExifProbe;
}

const DEFAULT_DEPENDENCIES: PhotoProcessingDependencies = {
  createImageBitmap:
    typeof globalThis.createImageBitmap === "function"
      ? (image, options) => globalThis.createImageBitmap(image, options)
      : undefined,
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  createFile: (bits, name, options) => new File(bits, name, options),
  loadImage,
  readJpegMetadata: async (file) =>
    parseJpegMetadataBytes(new Uint8Array(await file.arrayBuffer())),
};

function isOrientation(value: number): value is Orientation {
  return value >= 1 && value <= 8;
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readUint16(view: DataView, offset: number, littleEndian: boolean): number | null {
  return offset + 2 <= view.byteLength ? view.getUint16(offset, littleEndian) : null;
}

function readExifOrientation(view: DataView, offset: number, length: number): Orientation {
  if (length < 14 || view.getUint32(offset, false) !== 0x45786966) return 1;
  const tiff = offset + 6;
  const byteOrder = readUint16(view, tiff, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return 1;
  const littleEndian = byteOrder === 0x4949;
  if (readUint16(view, tiff + 2, littleEndian) !== 42 || tiff + 8 > view.byteLength) return 1;
  const firstIfd = view.getUint32(tiff + 4, littleEndian);
  const ifd = tiff + firstIfd;
  const count = readUint16(view, ifd, littleEndian);
  if (count === null || ifd + 2 + count * 12 > view.byteLength) return 1;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (readUint16(view, entry, littleEndian) !== 0x0112) continue;
    const type = readUint16(view, entry + 2, littleEndian);
    const values = view.getUint32(entry + 4, littleEndian);
    const value = readUint16(view, entry + 8, littleEndian);
    return type === 3 && values === 1 && value !== null && isOrientation(value) ? value : 1;
  }
  return 1;
}

/** Parse only the JPEG dimensions and EXIF orientation needed for fallback decoding. */
export function parseJpegMetadataBytes(bytes: Uint8Array): JpegMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return { orientation: 1, width: null, height: null };
  }

  let orientation: Orientation = 1;
  let width: number | null = null;
  let height: number | null = null;
  let offset = 2;
  while (offset + 4 <= view.byteLength && view.getUint8(offset) === 0xff) {
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd9 || marker === 0xda) break;
    const length = view.getUint16(offset + 2, false);
    const dataOffset = offset + 4;
    if (length < 2 || dataOffset + length - 2 > view.byteLength) break;
    if (marker === 0xe1) orientation = readExifOrientation(view, dataOffset, length - 2);
    if (isStartOfFrame(marker) && length >= 7) {
      height = view.getUint16(dataOffset + 1, false);
      width = view.getUint16(dataOffset + 3, false);
    }
    offset = dataOffset + length - 2;
  }
  return { orientation, width, height };
}

function swapsDimensions(orientation: Orientation): boolean {
  return orientation >= 5 && orientation <= 8;
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

function applyOrientation(
  context: CanvasRenderingContext2D,
  orientation: Orientation,
  width: number,
  height: number,
): void {
  switch (orientation) {
    case 2:
      context.translate(width, 0);
      context.scale(-1, 1);
      break;
    case 3:
      context.translate(width, height);
      context.rotate(Math.PI);
      break;
    case 4:
      context.translate(0, height);
      context.scale(1, -1);
      break;
    case 5:
      context.rotate(Math.PI / 2);
      context.scale(1, -1);
      break;
    case 6:
      context.translate(width, 0);
      context.rotate(Math.PI / 2);
      break;
    case 7:
      context.translate(width, height);
      context.rotate(-Math.PI / 2);
      context.scale(1, -1);
      break;
    case 8:
      context.translate(0, height);
      context.rotate(-Math.PI / 2);
      break;
  }
}

type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  orientation: Orientation;
  close: () => void;
};

async function decodePhoto(
  file: File,
  dependencies: PhotoProcessingDependencies,
): Promise<DecodedPhoto> {
  // Read metadata before choosing the fast path. Some browsers expose createImageBitmap but
  // ignore imageOrientation; non-default JPEG orientation therefore uses the calibrated image
  // element path. WebP also stays on that path because this JPEG parser cannot inspect WebP EXIF.
  let metadata = dependencies.readJpegMetadata
    ? await dependencies.readJpegMetadata(file)
    : undefined;
  const bitmapOrientationIsSafe = metadata?.orientation !== undefined && metadata.orientation === 1;
  if (dependencies.createImageBitmap && bitmapOrientationIsSafe && file.type !== "image/webp") {
    try {
      const bitmap = await dependencies.createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientation: 1,
        close: () => bitmap.close(),
      };
    } catch {
      // Some browser versions expose createImageBitmap but cannot decode every supported input.
    }
  }
  metadata ??= await readJpegMetadata(file);
  const image = await (dependencies.loadImage ?? loadImage)(file);
  const decoderAlreadyOriented =
    metadata.orientation === 1 ||
    (await (dependencies.imageElementHonorsExifOrientation ?? imageElementHonorsExifOrientation)());
  const orientation = decoderAlreadyOriented ? 1 : metadata.orientation;
  return {
    source: image.source,
    width: swapsDimensions(orientation) ? image.height : image.width,
    height: swapsDimensions(orientation) ? image.width : image.height,
    orientation,
    close: image.close,
  };
}

async function readJpegMetadata(file: Blob): Promise<JpegMetadata> {
  return parseJpegMetadataBytes(new Uint8Array(await file.arrayBuffer()));
}

/**
 * Pixel-roundtrip a photo before transfer. The bitmap fast path is limited to inputs whose
 * parsed JPEG orientation is already the default. Oriented JPEGs and WebP use the calibrated
 * image-element path so a browser cannot silently ignore `imageOrientation: "from-image"`.
 * Canvas encoding leaves no source metadata in the upload payload.
 */
export async function preparePhotoForUpload(
  file: File,
  dependencies: PhotoProcessingDependencies = DEFAULT_DEPENDENCIES,
): Promise<File> {
  let photo: DecodedPhoto | undefined;
  try {
    photo = await decodePhoto(file, dependencies);
    const dimensions = scaledDimensions(photo.width, photo.height);
    const canvas = dependencies.createCanvas(dimensions.width, dimensions.height);
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoPreparationError();

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.save();
    applyOrientation(context, photo.orientation, dimensions.width, dimensions.height);
    context.drawImage(
      photo.source,
      0,
      0,
      swapsDimensions(photo.orientation) ? dimensions.height : dimensions.width,
      swapsDimensions(photo.orientation) ? dimensions.width : dimensions.height,
    );
    context.restore();

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
    photo?.close();
  }
}
