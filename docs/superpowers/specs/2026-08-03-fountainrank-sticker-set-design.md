# FountainRank Ranked Hydration Sticker Set

## Goal

Create eight high-resolution, print-oriented die-cut sticker images for FountainRank. The set combines competitive-ranking language with maximalist internet humor while preserving the existing FountainRank logo as the dominant brand anchor.

## Source Artwork

- `docs/logos/512-pin.png` is the primary logo reference for compact compositions.
- `docs/logos/high-res-logo.png` is the secondary reference for exact color, finish, and FountainRank wordmark fidelity.
- The crown, fountain symbol, map-pin silhouette, blue/gold palette, proportions, and glossy dimensional character must remain recognizable.
- Generated artwork must not replace or reinterpret the logo with a new mark.

## Deliverables

Create one separate high-resolution image for each phrase:

1. `S-TIER SIP`
2. `GOATED PRESSURE`
3. `THIS FOUNTAIN FUCKS`
4. `WET. RANKED. THRIVING.`
5. `MID WATER` with the secondary line `DO NOT RECOMMEND`
6. `HYDRATION MAXXING`
7. `THE PRESSURE IS IMMACULATE`
8. `RANKED COMPETITIVE HYDRATION`

Also create one contact sheet showing all eight final designs.

## Visual System

- Use the supplied pin logo as a primary graphic element in every sticker.
- Combine tier-list and competitive-gaming visual language with loud meme-era shapes.
- Keep blue and gold as the brand anchor; use saturated coral, aqua, green, violet, and pink as secondary accents.
- Use bold, condensed, highly legible display lettering.
- Give every design a substantial white die-cut border contained within the canvas.
- Favor distinct silhouettes across the set: circles, irregular bursts, rounded rectangles, and asymmetric badge shapes.
- Maintain enough internal padding that neither text nor logo approaches the cut edge.

## Output Requirements

- Produce eight individual square raster masters at the highest resolution available from the built-in image-generation path.
- Use a flat removable chroma-key background during generation, then remove it locally and save each final as an RGBA PNG with transparent corners.
- Preserve a solid white sticker border inside the transparent canvas.
- Store final files under `docs/stickers/ranked-hydration/` with descriptive lowercase filenames.
- Do not overwrite either source logo.

## Generation Constraints

- Use both supplied logo files as image references; treat them as identity-preservation inputs rather than loose style references.
- Render every phrase verbatim. Reject or regenerate outputs with misspellings, missing punctuation, duplicated words, or invented copy.
- Do not add mascots, unrelated objects, fake URLs, QR codes, watermarks, signatures, or additional brand names.
- Do not distort the logo, remove the crown, swap the palette, or invent a different fountain symbol.
- Keep each design visually self-contained and suitable for physical die cutting.

## Verification

Inspect every output for:

- exact phrase spelling and punctuation;
- recognizable, undistorted FountainRank pin logo;
- readable text at reduced display size;
- intact white die-cut border;
- an alpha channel with transparent corners and no chroma-key fringe;
- no unintended text, watermarks, or extra marks;
- consistent blue/gold brand presence across the full set.

Regenerate any asset that fails a required check. Build the contact sheet only from accepted individual assets.
