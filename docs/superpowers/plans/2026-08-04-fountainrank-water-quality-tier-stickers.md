# FountainRank Water Quality Tier Sticker Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce seven transparent water-quality tier stickers and one contact sheet under `docs/stickers`.

**Architecture:** Generate each tier independently with both FountainRank logos as identity references, remove flat chroma-key backgrounds, normalize to square RGBA masters, embed 300-DPI metadata, and build a contact sheet from accepted files. Hash all existing sticker files before and after generation.

**Tech Stack:** Built-in image generation, bundled chroma-key helper, Pillow.

## Global Constraints

- Create only `quality-tier-*.png` files.
- Preserve existing sticker files byte-for-byte.
- Render every tier number, name, verdict, apostrophe, and hyphen verbatim.
- Preserve the recognizable crowned FountainRank pin and blue/gold identity.
- Avoid health, contamination, disease, or potability claims.
- Do not commit, push, or open a PR without explicit authorization.

---

### Task 1: Generate and Process Seven Tier Masters

**Files:**
- Reference: `docs/logos/512-pin.png`
- Reference: `docs/logos/high-res-logo.png`
- Create: the seven individual `quality-tier-*.png` files from the spec.

**Interfaces:**
- Consumes: the approved tier copy and logo references.
- Produces: seven square transparent 300-DPI PNG masters.

- [x] Snapshot SHA-256 hashes for every existing `docs/stickers/*.png`.
- [x] Generate one independent image per tier with its exact copy, assigned palette, consistent badge framework, white die-cut border, and flat removable background.
- [x] Store chroma-key sources under `temp/imagegen/quality-tier-sources/`.
- [x] Remove backgrounds with the bundled helper and normalize non-square results on transparent square canvases.
- [x] Embed 300-DPI metadata only in the seven new files and visually reject any copy, logo, hierarchy, border, or fringe failure.

### Task 2: Assemble and Verify the Ladder

**Files:**
- Read: seven accepted individual tier masters.
- Create: `docs/stickers/quality-tier-contact-sheet.png`.

**Interfaces:**
- Consumes: seven accepted individual masters.
- Produces: one ascending labeled contact sheet and final verification evidence.

- [x] Structurally require square RGBA masters, 300 DPI, transparent corners, full alpha range, and nonempty coverage.
- [x] Build the contact sheet in Tier 1 through Tier 7 order and inspect it visually.
- [x] Recalculate every pre-existing hash and require byte-for-byte preservation.
- [x] Verify all eight new filenames, dimensions, DPI, mode, alpha, corners, and approved copy.
