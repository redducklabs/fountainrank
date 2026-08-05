# FountainRank Water Quality Tier Sticker Set

## Goal

Create seven collectible FountainRank stickers that communicate an ascending water-quality ladder from emergency-only hydration to absurdly premium water.

## Existing Assets and Preservation

- Use `docs/logos/512-pin.png` as the primary compact identity reference.
- Use `docs/logos/high-res-logo.png` as the color, finish, proportions, and wordmark reference.
- Preserve the crown, fountain symbol, map-pin silhouette, recognizable proportions, and blue/gold identity.
- Do not overwrite, rename, recompress, or otherwise modify any existing file in `docs/stickers`.
- New filenames must use the `quality-tier-` prefix.

## Tier Deliverables

Create one individual sticker for each tier. Each sticker must show its tier number, quality name, verdict, and the supplied FountainRank pin.

1. `TIER 1` / `DESERT EMERGENCY` / `LIFE-SAVING IN THE DESERT`
2. `TIER 2` / `SERVICEABLE` / `I'VE HAD WORSE`
3. `TIER 3` / `DEPENDABLE` / `SOLID MUNICIPAL SIP`
4. `TIER 4` / `CRISP` / `SURPRISINGLY CRISP`
5. `TIER 5` / `PREMIUM` / `PREMIUM MOUTHFEEL`
6. `TIER 6` / `DESTINATION WATER` / `WORTH THE DETOUR`
7. `TIER 7` / `LIQUID CAPITALISM` / `I'D BOTTLE AND SELL THIS SHIT`

Create an eighth deliverable: one labeled contact sheet containing the seven stickers in ascending tier order.

## Visual System

- Use one consistent collectible badge framework across all seven stickers.
- Give every sticker a clearly readable tier number, quality name, verdict, and primary FountainRank pin.
- Increase visual richness as quality rises: the pin may grow slightly, borders may become more ornate, and finishes may become more premium.
- Progress colors in this order:
  1. dusty sand and sun-baked brown;
  2. utilitarian gray-blue;
  3. civic teal;
  4. crisp aqua and FountainRank blue;
  5. emerald and aqua;
  6. royal purple, blue, and gold;
  7. bottled-water gold, royal blue, and bright highlights.
- Keep a substantial continuous white or warm-white die-cut border inside every canvas.
- Use bold display lettering with strong reduced-size readability.
- Do not imply that lower-tier water is unsafe or contaminated; Tier 1 communicates desperation-grade desirability, not a health claim.

## Output Requirements

- Use the built-in image-generation path with both logo files supplied as identity references.
- Generate against a flat removable chroma-key background, then remove it locally.
- Save every individual master as a square RGBA PNG with fully transparent corners and embedded 300-DPI metadata.
- Save all eight new files directly under `docs/stickers`:
  - `quality-tier-1-desert-emergency.png`
  - `quality-tier-2-serviceable.png`
  - `quality-tier-3-dependable.png`
  - `quality-tier-4-crisp.png`
  - `quality-tier-5-premium.png`
  - `quality-tier-6-destination-water.png`
  - `quality-tier-7-liquid-capitalism.png`
  - `quality-tier-contact-sheet.png`

## Generation Constraints

- Render all tier numbers, names, verdicts, apostrophes, and hyphens verbatim.
- Do not add contradictory quality labels or imply disease, contamination, or potability testing.
- Do not add mascots, unrelated objects, fake URLs, QR codes, watermarks, signatures, or extra words.
- Do not remove the crown, replace the fountain symbol, invent a new logo, or make the pin unrecognizable.
- The seven stickers must read as one ordered system while remaining visually distinct.

## Verification

Inspect and structurally validate every output for:

- exact tier number, quality name, verdict spelling, and punctuation;
- correct ascending order from Tier 1 through Tier 7;
- recognizable and undistorted FountainRank pin;
- readable copy at contact-sheet scale;
- intact die-cut border;
- square RGBA format, 300-DPI metadata, transparent corners, and nonempty subject coverage;
- absence of chroma-key fringe, unintended copy, watermarks, and extra marks;
- no changes to any pre-existing file in `docs/stickers`.

Build the contact sheet only from accepted individual assets. Regenerate any sticker that fails a required check.
