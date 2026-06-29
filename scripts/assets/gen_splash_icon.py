"""Regenerate mobile/assets/splash-icon.png as the pin on opaque white.

The old asset baked a white box on a transparent canvas; the transparent area
rendered black on the Android-12 masked splash. An opaque-white canvas (no
alpha) removes the black entirely, and on the white splash background it reads
as the pin alone. Run from repo root: `python scripts/assets/gen_splash_icon.py`
"""

from PIL import Image

SRC = "mobile/assets/icon.png"  # clean transparent pin, 1024x1024
OUT = "mobile/assets/splash-icon.png"
CANVAS = 1024
SAFE_BOX = 620  # keeps the pin inside the Android-12 circular splash mask

pin = Image.open(SRC).convert("RGBA")
pin = pin.crop(pin.getbbox())  # trim transparent margins
scale = SAFE_BOX / max(pin.size)
pin = pin.resize((round(pin.width * scale), round(pin.height * scale)), Image.LANCZOS)

canvas = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))  # opaque white, no alpha
x = (CANVAS - pin.width) // 2
y = (CANVAS - pin.height) // 2
canvas.paste(pin, (x, y), pin)  # use the pin's alpha as the paste mask
canvas.save(OUT)
print(f"wrote {OUT} ({canvas.size[0]}x{canvas.size[1]}, mode={canvas.mode})")
