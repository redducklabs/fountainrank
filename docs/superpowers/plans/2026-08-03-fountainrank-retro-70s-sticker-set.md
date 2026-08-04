# FountainRank 1970s Sticker Companion Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce eight transparent 1970s-style FountainRank sticker masters and one contact sheet under `docs/stickers` without modifying existing sticker files.

**Architecture:** Generate each sticker independently through the built-in image-generation tool with both existing logos supplied as identity references. Convert flat chroma-key backgrounds to alpha, normalize each master to a square canvas, embed 300-DPI metadata, visually inspect every design, then create a contact sheet from accepted outputs only.

**Tech Stack:** Built-in image generation, bundled imagegen chroma-key removal helper, Pillow for metadata, validation, and contact-sheet composition.

## Global Constraints

- Preserve all existing `docs/stickers/*.png` files byte-for-byte.
- Create only filenames beginning with `retro-70s-`.
- Preserve the recognizable FountainRank pin, crown, fountain symbol, and blue/gold identity.
- Render approved phrases and punctuation verbatim.
- Render exactly five star icons on `AMAZING MOUTHFEEL`.
- Save individual masters as square RGBA PNGs with transparent corners and 300-DPI metadata.
- Do not commit, push, or create a PR without explicit authorization.

---

### Task 1: Generate and Process Eight Retro Masters

**Files:**
- Reference: `docs/logos/512-pin.png`
- Reference: `docs/logos/high-res-logo.png`
- Create: the eight `retro-70s-*.png` individual filenames from the approved spec.

**Interfaces:**
- Consumes: both logo references, approved phrases, and 1970s visual constraints.
- Produces: eight square transparent RGBA sticker masters.

- [x] **Step 1: Snapshot existing sticker hashes**

Calculate SHA-256 for every current `docs/stickers/*.png` file and retain the mapping for final comparison.

- [x] **Step 2: Generate each sticker independently**

Issue one built-in image-generation call per phrase. Require a flat removable chroma-key exterior, cream die-cut border, logo fidelity, 1970s parks-poster styling, exact copy, and no extraneous text.

- [x] **Step 3: Preserve generation sources outside the final directory**

Copy generated chroma-key sources beneath `temp/imagegen/retro-70s-sources/`, never into `docs/stickers`.

- [x] **Step 4: Convert sources to alpha and normalize canvases**

Use the bundled chroma-key helper with border sampling, soft matte, despill, transparent threshold 12, and opaque threshold 220. If a result is not square, center the complete sticker non-destructively on a square transparent canvas.

- [x] **Step 5: Add print metadata and inspect all masters**

Embed 300-DPI metadata only in the eight new files. Reject and regenerate any incorrect phrase, wrong star count, logo drift, incomplete border, poor legibility, or chroma fringe.

### Task 2: Build and Verify the Retro Contact Sheet

**Files:**
- Read: the eight accepted `retro-70s-*.png` individual masters.
- Create: `docs/stickers/retro-70s-contact-sheet.png`.

**Interfaces:**
- Consumes: eight accepted individual masters.
- Produces: one labeled contact sheet and final verification output.

- [x] **Step 1: Structurally validate individual masters**

Require every file to exist, be square, use RGBA mode, contain alpha extrema `(0, 255)`, have four transparent corners, contain nonempty subject coverage, and report 300-DPI metadata.

- [x] **Step 2: Build and inspect the contact sheet**

Place the eight accepted images in a four-column, two-row 1970s presentation sheet with readable labels. Visually inspect the full set for consistency and exact copy.

- [x] **Step 3: Verify the existing sticker snapshot**

Recalculate SHA-256 for the pre-existing filenames and require every hash to match the Task 1 snapshot.

- [x] **Step 4: Verify final deliverables**

List the nine new files with byte size, pixel dimensions, mode, DPI, alpha extrema, and corner values. Compare the delivered filenames and phrases line by line with the approved spec.
