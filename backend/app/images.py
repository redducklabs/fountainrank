"""Pure, blocking image-processing pipeline for uploaded fountain photos.

Validates that the raw bytes decode as a real raster image (JPEG/PNG/WebP
only; rejects animated images and decompression bombs), applies EXIF
orientation, and re-encodes to JPEG — which strips all metadata (EXIF/GPS)
— producing a downscaled "full" image and a small thumbnail.

No DB access, no network calls: this module is deliberately side-effect
free so it can be exercised and unit-tested in isolation from FastAPI/DB
wiring.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

# Decompression-bomb guard (~40 megapixels).
Image.MAX_IMAGE_PIXELS = 40_000_000

_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class UnsupportedImage(Exception):
    """Raised when the input cannot be processed as a photo upload.

    Covers non-image bytes, disallowed formats, animated images, and
    decompression bombs. Callers should map this to an HTTP 415 response.
    """


@dataclass
class ProcessedImage:
    full: bytes
    thumb: bytes
    width: int
    height: int


def _encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def process_image(raw: bytes, *, max_edge: int = 2048, thumb_edge: int = 400) -> ProcessedImage:
    """Validate, normalize, and downscale an uploaded photo.

    Returns a ``ProcessedImage`` with a full-size JPEG (long edge capped at
    ``max_edge``, quality ~85) and a thumbnail JPEG (long edge capped at
    ``thumb_edge``, quality ~80). Both outputs have EXIF/GPS metadata
    stripped by the JPEG re-encode; orientation is applied before encoding
    so the pixels are correctly rotated first.

    Raises:
        UnsupportedImage: the bytes are not a decodable raster image, are
            an unsupported format, are animated, or exceed the
            decompression-bomb pixel guard.
    """
    try:
        with warnings.catch_warnings():
            # Pillow's MAX_IMAGE_PIXELS only *warns* below 2x the limit and
            # raises DecompressionBombError above it — we enforce the limit
            # explicitly below, so silence the warning to avoid noisy
            # stderr output on a deliberately-crafted borderline image.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(raw))
            if img.width * img.height > Image.MAX_IMAGE_PIXELS:
                raise UnsupportedImage(f"image exceeds pixel limit: {img.width}x{img.height}")
            if img.format not in _ALLOWED_FORMATS or getattr(img, "is_animated", False):
                raise UnsupportedImage(f"unsupported or animated image: format={img.format!r}")
            img.load()
        # Apply EXIF orientation, then drop to RGB (also drops the alpha
        # channel from PNG/WebP inputs); any embedded EXIF/ICC data is
        # dropped for good on the JPEG re-encode below.
        img = ImageOps.exif_transpose(img)
        if img is None:
            raise UnsupportedImage("failed to decode image")
        img = img.convert("RGB")
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
    ) as exc:
        raise UnsupportedImage(str(exc)) from exc

    full = img.copy()
    full.thumbnail((max_edge, max_edge))

    thumb = img.copy()
    thumb.thumbnail((thumb_edge, thumb_edge))

    return ProcessedImage(
        full=_encode_jpeg(full, 85),
        thumb=_encode_jpeg(thumb, 80),
        width=full.width,
        height=full.height,
    )
