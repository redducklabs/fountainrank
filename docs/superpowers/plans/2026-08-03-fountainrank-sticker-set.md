# FountainRank Ranked Hydration Sticker Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce eight high-resolution, transparent FountainRank sticker masters and a contact sheet under `docs/stickers`.

**Architecture:** Generate each sticker independently with the built-in image-generation tool, supplying both existing logo files as identity references. Generate against a flat chroma-key field, remove that field locally, validate each resulting RGBA PNG, then assemble only accepted files into a contact sheet.

**Tech Stack:** Built-in image generation, bundled imagegen chroma-key removal helper, Pillow-based local inspection and contact-sheet composition.

## Global Constraints

- Preserve the existing crowned fountain-pin logo and blue/gold brand identity.
- Render all approved phrases verbatim.
- Keep a solid white die-cut border within the transparent canvas.
- Do not overwrite `docs/logos/512-pin.png` or `docs/logos/high-res-logo.png`.
- Store final deliverables directly under `docs/stickers`.
- Do not add mascots, unrelated objects, fake URLs, QR codes, watermarks, signatures, or additional brand names.

---

### Task 1: Generate the Eight Sticker Masters

**Files:**
- Reference: `docs/logos/512-pin.png`
- Reference: `docs/logos/high-res-logo.png`
- Create: `docs/stickers/s-tier-sip.png`
- Create: `docs/stickers/goated-pressure.png`
- Create: `docs/stickers/this-fountain-fucks.png`
- Create: `docs/stickers/wet-ranked-thriving.png`
- Create: `docs/stickers/mid-water.png`
- Create: `docs/stickers/hydration-maxxing.png`
- Create: `docs/stickers/the-pressure-is-immaculate.png`
- Create: `docs/stickers/ranked-competitive-hydration.png`

**Interfaces:**
- Consumes: the two approved logo references and the phrase/style requirements in the design spec.
- Produces: eight individual RGBA PNG sticker masters with transparent corners.

- [x] **Step 1: Generate each concept independently**

Use one built-in image-generation call per phrase. In every prompt, identify both logo files as identity-preservation references and require a perfectly flat chroma-key background, exact copy, a white die-cut border, generous padding, and no extraneous text.

- [x] **Step 2: Save the generated sources without overwriting existing assets**

Copy each generated result into a temporary working location beneath `docs/stickers/.working/` using its descriptive filename plus `-source`.

- [x] **Step 3: Convert chroma key to alpha**

Run the bundled `remove_chroma_key.py` helper for each source, with border auto-key sampling, soft matte, despill, transparent threshold 12, and opaque threshold 220. Write the final filenames listed above.

- [x] **Step 4: Inspect and regenerate failures**

Open each output and reject any image with incorrect text, a distorted logo, an incomplete white border, obvious key-color fringe, unintended copy, or poor reduced-size legibility. Regenerate only the failing concept with one targeted prompt adjustment.

### Task 2: Validate Files and Build the Contact Sheet

**Files:**
- Read: the eight individual PNGs from Task 1.
- Create: `docs/stickers/fountainrank-ranked-hydration-contact-sheet.png`

**Interfaces:**
- Consumes: eight accepted individual RGBA PNG masters.
- Produces: one labeled contact-sheet PNG and a verification record in command output.

- [x] **Step 1: Run structural validation**

Use Pillow to print each file's dimensions, mode, alpha extrema, corner alpha values, and nontransparent bounding box. Require square dimensions, mode `RGBA`, transparent corners, nonempty subject coverage, and no missing file.

- [x] **Step 2: Re-open every individual image for visual inspection**

Verify exact phrase spelling and punctuation, recognizable logo geometry, white die-cut border continuity, legibility, and absence of extraneous marks.

- [x] **Step 3: Assemble the contact sheet**

Create a four-column sheet from the eight accepted files, preserving transparency and leaving clear spacing around each design. Do not use rejected sources.

- [x] **Step 4: Verify final deliverables**

List every final file with byte size and dimensions, re-open the contact sheet, and compare the delivered set line by line against the approved eight-item spec.
