#!/usr/bin/env python3
"""Generate the FountainRank map pin assets into web/public/pins/.

These are **derived** from the canonical clean pin `docs/logos/512-pin.png`
(the owner's transparent standard pin: blue teardrop + gold crown + cyan spray):

  pin-standard.png  the canonical pin, trimmed + resized
  pin-gold.png      standard + a gold rim (the "top-rated", ranking_score > 4 highlight, evoking sheet #4)
  pin-selected.png  standard + a thin white outline (the blue selected-halo layer carries the main cue)
  pin-broken.png    standard + a composited red diagonal slash (out-of-order)
  pill-bg.png       a 20x20 white rounded-rect, stretchable for the rating pill (icon-text-fit)

They are functional, on-brand, and consistent (one source). Swap any of them for
bespoke art at will — `web/lib/map/style.ts` references them by name, so the map
picks up replacements with no code change. Re-run: `python scripts/gen-pin-assets.py`.

Anchor note: every pin variant shares one canvas with the teardrop tip at the
bottom-center (MapLibre `icon-anchor: "bottom"`), so they all anchor identically.
`pill-bg` uses 6px corners to match the MapBrowser addImage stretch metadata
(stretchX/Y [[6,14]], content [6,6,14,14]).

Source: `docs/logos/512-pin.png` (committed). Requires Pillow — either
`pip install Pillow` then `python scripts/gen-pin-assets.py`, or hermetically:
`uvx --from pillow python scripts/gen-pin-assets.py`.
"""
from __future__ import annotations

import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "logos", "512-pin.png")
OUT = os.path.join(ROOT, "web", "public", "pins")

PIN_H = 84          # pin height in px (icon-size in layers.ts scales this for display)
SIDE, TOP, BOT = 8, 8, 2   # canvas margins; BOT kept tiny so the tip ~= image bottom
GOLD = (242, 194, 0)       # #F2C200
RED = (214, 69, 69)        # #D64545
PILL_BORDER = (214, 217, 222)  # subtle edge so the pill reads on a light basemap


def _ring(canvas: Image.Image, grow: int, color: tuple[int, int, int]) -> Image.Image:
    """An outline ring `grow` px outside the canvas's alpha silhouette."""
    alpha = canvas.split()[3]
    dilated = alpha.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    ring_mask = ImageChops.subtract(dilated, alpha)
    layer = Image.new("RGBA", canvas.size, color + (0,))
    solid = Image.new("RGBA", canvas.size, color + (255,))
    return Image.composite(solid, layer, ring_mask)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    base = Image.open(SRC).convert("RGBA")
    pin = base.crop(base.getbbox())
    w, h = pin.size
    pin = pin.resize((round(w * PIN_H / h), PIN_H), Image.LANCZOS)

    cw, ch = pin.width + 2 * SIDE, PIN_H + TOP + BOT

    def canvas() -> Image.Image:
        return Image.new("RGBA", (cw, ch), (0, 0, 0, 0))

    def placed() -> Image.Image:
        c = canvas()
        c.alpha_composite(pin, ((cw - pin.width) // 2, ch - BOT - pin.height))
        return c

    std = placed()
    std.save(os.path.join(OUT, "pin-standard.png"))

    gold = canvas()
    gold.alpha_composite(_ring(std, 3, GOLD))
    gold.alpha_composite(std)
    gold.save(os.path.join(OUT, "pin-gold.png"))

    sel = canvas()
    sel.alpha_composite(_ring(std, 2, (255, 255, 255)))
    sel.alpha_composite(std)
    sel.save(os.path.join(OUT, "pin-selected.png"))

    broken = std.copy()
    slash = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(slash)
    hcx, hcy = cw // 2, TOP + int(PIN_H * 0.40)
    bw, bh = int(pin.width * 1.15), max(8, int(PIN_H * 0.12))
    x0, y0 = hcx - bw // 2, hcy - bh // 2
    d.rounded_rectangle([x0 - 2, y0 - 2, x0 + bw + 2, y0 + bh + 2], radius=(bh + 4) // 2,
                        fill=(255, 255, 255, 255))
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=bh // 2, fill=RED + (255,))
    broken.alpha_composite(slash.rotate(-45, resample=Image.BICUBIC, center=(hcx, hcy)))
    broken.save(os.path.join(OUT, "pin-broken.png"))

    pill = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle([0, 0, 19, 19], radius=6, fill=(255, 255, 255, 255),
                                           outline=PILL_BORDER + (255,), width=1)
    pill.save(os.path.join(OUT, "pill-bg.png"))

    for name in ("pin-standard", "pin-gold", "pin-selected", "pin-broken", "pill-bg"):
        im = Image.open(os.path.join(OUT, f"{name}.png"))
        print(f"{name}.png {im.size} {im.mode} alpha={im.split()[3].getextrema()}")


if __name__ == "__main__":
    main()
