import io

import pytest
from PIL import Image

from app.images import UnsupportedImage, process_image


def _jpeg(w=3000, h=2000, exif_gps=True):
    img = Image.new("RGB", (w, h), (100, 150, 200))
    buf = io.BytesIO()
    if exif_gps:
        exif = img.getexif()
        exif[0x0112] = 1  # Orientation: normal
        exif[0x010F] = "TestCameraMake"  # Make — stand-in for embedded metadata
        img.save(buf, "JPEG", exif=exif)
    else:
        img.save(buf, "JPEG")
    return buf.getvalue()


def test_downscales_full_to_max_edge():
    out = process_image(_jpeg())
    assert max(out.width, out.height) == 2048
    Image.open(io.BytesIO(out.full)).verify()


def test_generates_thumbnail():
    out = process_image(_jpeg())
    t = Image.open(io.BytesIO(out.thumb))
    assert max(t.size) == 400


def test_strips_exif():
    raw = _jpeg()
    # Sanity check: the fixture actually embeds EXIF metadata before processing.
    assert Image.open(io.BytesIO(raw))._getexif()
    out = process_image(raw)
    assert not Image.open(io.BytesIO(out.full))._getexif()


def test_rejects_non_image():
    with pytest.raises(UnsupportedImage):
        process_image(b"not an image")


def test_accepts_png_and_webp_reencodes_to_jpeg():
    img = Image.new("RGB", (500, 500), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out = process_image(buf.getvalue())
    assert Image.open(io.BytesIO(out.full)).format == "JPEG"


def test_rejects_decompression_bomb():
    # Pillow's MAX_IMAGE_PIXELS only warns (doesn't raise) below 2x the
    # configured limit, so this must be enforced explicitly — 8000x6000 is
    # 48MP, just over the pipeline's ~40MP guard but well under Pillow's
    # own 2x-the-limit error threshold.
    img = Image.new("RGB", (8000, 6000), (5, 5, 5))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    with pytest.raises(UnsupportedImage):
        process_image(buf.getvalue())


def test_rejects_animated_image():
    frames = [Image.new("RGB", (50, 50), (i * 80, 0, 0)) for i in range(3)]
    buf = io.BytesIO()
    frames[0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=[100, 100, 100],
        loop=0,
        lossless=True,
    )
    with pytest.raises(UnsupportedImage):
        process_image(buf.getvalue())
