"""Generate pin-unrated.png from pin-standard.png: a muted slate-blue duotone.

Desaturates the pin (so the gold crown becomes grey) and maps luminance onto a
slate-blue ramp, preserving the original alpha (the pin silhouette). Output is
written to both web and mobile (the two pin-standard.png are identical 77x94).
Run from repo root: `python scripts/assets/gen_unrated_pin.py`
"""

from PIL import Image

SRC = "web/public/pins/pin-standard.png"
OUTS = ["web/public/pins/pin-unrated.png", "mobile/assets/pins/pin-unrated.png"]
DARK = (47, 63, 90)      # #2F3F5A — slate shadow
LIGHT = (176, 190, 210)  # #B0BED2 — light slate (crown/highlights become grey-blue)

src = Image.open(SRC).convert("RGBA")
r, g, b, a = src.split()
gray = Image.merge("RGB", (r, g, b)).convert("L")  # luminance -> desaturates the crown


def ramp(c0, c1):
    return [round(c0 + (c1 - c0) * i / 255) for i in range(256)]


duo = Image.merge(
    "RGB",
    (
        gray.point(ramp(DARK[0], LIGHT[0])),
        gray.point(ramp(DARK[1], LIGHT[1])),
        gray.point(ramp(DARK[2], LIGHT[2])),
    ),
)
out = Image.merge("RGBA", (*duo.split(), a))  # keep original alpha
for path in OUTS:
    out.save(path)
    print(f"wrote {path} ({out.size[0]}x{out.size[1]})")
