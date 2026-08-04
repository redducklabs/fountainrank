# FountainRank 1970s Sticker Companion Set

## Goal

Create eight high-resolution die-cut sticker images that complement the existing FountainRank ranked-hydration set with a 1970s groovy parks-department aesthetic.

## Existing Assets and Preservation

- Use `docs/logos/512-pin.png` as the primary compact logo reference.
- Use `docs/logos/high-res-logo.png` as the color, finish, and identity reference.
- Preserve the crown, fountain symbol, map-pin silhouette, blue/gold identity, and recognizable proportions.
- Do not overwrite, rename, recompress, or otherwise modify any existing file in `docs/stickers`.
- New filenames must use the `retro-70s-` prefix.

## Deliverables

Create one individual sticker for each approved phrase:

1. `S-TIER SIP`
2. `GOATED PRESSURE`
3. `THIS FOUNTAIN FUCKS`
4. `HYDRATION MAXXING`
5. Five star icons followed by `AMAZING MOUTHFEEL`
6. `STAY GROOVY, STAY HYDRATED`
7. `PUBLIC WATER, PRIVATE OPINIONS`
8. `DRINK LOCAL. RANK GLOBAL.`

Create a ninth deliverable: one contact sheet containing only these eight retro stickers.

## Visual System

- Evoke 1970s municipal recreation posters, parks-department badges, screen-printed decals, and groovy civic seals.
- Use wavy hand-lettered display typography with strong reduced-size readability.
- Use faded mustard, burnt orange, avocado, warm teal, cream, and dark brown while retaining visible FountainRank blue and gold.
- Use varied die-cut silhouettes: irregular blobs, circular seals, asymmetric rounded rectangles, and wavy badges.
- Use cream or warm-white continuous die-cut borders inside each canvas.
- Use subtle screen-print grain only within the sticker artwork; keep the removable exterior background perfectly flat.
- Keep the supplied FountainRank pin as a primary element on every sticker.
- The `AMAZING MOUTHFEEL` sticker must show exactly five clearly recognizable star icons in one row.

## Output Requirements

- Use the built-in image-generation path with both logo files supplied as identity references.
- Generate against a flat removable chroma-key background, then remove it locally.
- Save each final as a square RGBA PNG with fully transparent corners and embedded 300-DPI metadata.
- Save all nine final files directly under `docs/stickers`.
- Use these filenames:
  - `retro-70s-s-tier-sip.png`
  - `retro-70s-goated-pressure.png`
  - `retro-70s-this-fountain-fucks.png`
  - `retro-70s-hydration-maxxing.png`
  - `retro-70s-amazing-mouthfeel.png`
  - `retro-70s-stay-groovy-stay-hydrated.png`
  - `retro-70s-public-water-private-opinions.png`
  - `retro-70s-drink-local-rank-global.png`
  - `retro-70s-contact-sheet.png`

## Generation Constraints

- Render all approved copy verbatim, including punctuation.
- Spell `MAXXING` with exactly two consecutive `X` characters.
- Render exactly five stars on `AMAZING MOUTHFEEL`; reject four, six, or decorative extra stars.
- Do not add mascots, unrelated objects, fake URLs, QR codes, watermarks, signatures, or extra words.
- Do not remove the crown, replace the fountain symbol, invent a new logo, or make the pin unrecognizable.
- Do not apply the retro treatment so aggressively that the logo loses its core blue/gold identity.

## Verification

Inspect and structurally validate every output for:

- exact phrase spelling and punctuation;
- exactly five star icons on `AMAZING MOUTHFEEL`;
- recognizable and undistorted FountainRank logo;
- readable text at contact-sheet scale;
- intact cream or warm-white die-cut border;
- square RGBA format, 300-DPI metadata, transparent corners, and nonempty subject coverage;
- absence of chroma-key fringe, unintended copy, watermarks, and extra marks;
- no changes to the pre-existing contents of `docs/stickers`.

Build the contact sheet only from accepted individual assets. Regenerate any sticker that fails a required check.
