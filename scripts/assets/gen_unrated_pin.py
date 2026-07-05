"""Generate pin-unrated.png from pin-standard.png: a muted slate-blue duotone.

Desaturates the pin (so the gold crown becomes grey) and maps luminance onto a
slate-blue ramp, preserving the original alpha (the pin silhouette). Output is
written to both web and mobile (the two pin-standard.png are identical 77x94).
Also emits a dark-tuned `pin-unrated-dark.png` (web only; mobile dark pins are Plan 3).
Run from repo root: `python scripts/assets/gen_unrated_pin.py`
"""

from PIL import Image

SRC = "web/public/pins/pin-standard.png"
DARK = (47, 63, 90)      # #2F3F5A — slate shadow (light theme)
LIGHT = (176, 190, 210)  # #B0BED2 — light slate highlight (light theme)
# Dark theme: a brighter slate ramp so the muted pin still reads on dark land.
DARK_DK = (120, 138, 168)   # brighter shadow
LIGHT_DK = (206, 217, 233)  # near-white highlight

src = Image.open(SRC).convert("RGBA")
r, g, b, a = src.split()
gray = Image.merge("RGB", (r, g, b)).convert("L")  # luminance -> desaturates the crown


def ramp(c0, c1):
    return [round(c0 + (c1 - c0) * i / 255) for i in range(256)]


def duotone(c_dark, c_light):
    return Image.merge(
        "RGB",
        (
            gray.point(ramp(c_dark[0], c_light[0])),
            gray.point(ramp(c_dark[1], c_light[1])),
            gray.point(ramp(c_dark[2], c_light[2])),
        ),
    )


# Light unrated → web + mobile (unchanged behavior).
out = Image.merge("RGBA", (*duotone(DARK, LIGHT).split(), a))
for path in ["web/public/pins/pin-unrated.png", "mobile/assets/pins/pin-unrated.png"]:
    out.save(path)
    print(f"wrote {path} ({out.size[0]}x{out.size[1]})")

# Dark unrated → web only (mobile dark pins are Plan 3).
out_dk = Image.merge("RGBA", (*duotone(DARK_DK, LIGHT_DK).split(), a))
out_dk.save("web/public/pins/pin-unrated-dark.png")
print(f"wrote web/public/pins/pin-unrated-dark.png ({out_dk.size[0]}x{out_dk.size[1]})")
