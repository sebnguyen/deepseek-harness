# Agent Note: SVG pixel exporter gains rasterizer resolution, grid, threshold, thickness, and transparent gap via clip-path

Status: implemented

## Problem

The pixelization demo (`svg-pixel-exporter.html`) rasterized source SVGs at a hard-coded 1024 px resolution, offered only a 16/24/32 grid, and baked the inter-pixel gap into each rect's `x`/`y`/`width`/`height` geometry. There was no visual indicating which grid cells passed (kept) versus failed (empty) the coverage threshold, and the preset set was a handful of toy symbols rather than the glyphs actually shipped. The gap question — whether it is baked or a settable rect property — needed settling against the SVG spec.

## Decision

The demo at `svg-pixel-exporter.html` (workspace root) now:

- Exposes **rasterizer resolution** as a `#raster` select (256/512/1024/2048 px) by converting the former `const RASTER` into a mutable `let RASTER` and re-rasterizing the source on change.
- Adds **8×8** to the `#grid` select (8/16/24/32).
- Keeps **threshold** (`#threshold`) and **thickness** (`#thicken`) controls, wired through `cellsFromCoverage`.
- Adds a **Coverage overlay** panel (`#overlayStage`) rendering the rasterized PNG with a grid of rects colored green (pass/kept) or red (not pass/empty), rebuilt in `render()`.
- Loads the **real glyph set** from `pixel-mark-catalog.json` at runtime via `loadGlyphPresets()`, replacing the toy presets with all shipped glyphs.
- Moves the **gap out of rect geometry**: rects are now full-size (`x`/`y`/`width="1"`/`height="1"`) and the gap is applied by a single embedded `<style>` rule, `clip-path: inset(var(--gap-inset) round 0.1px)`, driven by the `--gap-inset` CSS variable on the `<svg>` root. This makes gaps truly transparent (clipped, not painted) with no background color required, and keeps the gap configurable via one CSS variable rather than per-rect geometry.

The SVG `<rect>` spec (per MDN) defines only `x`, `y`, `width`, `height`, `rx`, `ry`, and `pathLength` — there is no `gap`, `inset`, `margin`, or `padding` attribute, so the gap cannot be declared as a rect property. The clip-path approach is the spec-compliant way to get transparent, non-baked gaps externally.

## Alternatives considered

- **Keep the gap baked into rect geometry (inset `x`/`y`/`width`/`height`).** This is bg-independent and is the standard for pixel-art SVGs, but it repeats the inset math in every rect and cannot be changed without regenerating the geometry. Rejected for the new default because the user wanted the gap expressed as an attribute/CSS concern rather than baked numbers.

- **Stroke-based gaps (`stroke` + `stroke-width`).** Makes the gap an attribute, but the stroke is a visible color, so it only works on solid backgrounds and shows as a colored line on transparent backgrounds. Rejected for the transparent case.

- **External CSS `clip-path` on the consumer side only.** Keeps the exported SVG even cleaner, but the gap would not render when the SVG is opened standalone. Rejected in favor of embedding the `<style>` rule inside the SVG so it is self-contained while still not baking geometry.

- **Hard-coded 1024 px raster resolution.** Simple, but prevents inspecting coverage at lower resolutions. Rejected in favor of the `#raster` select.

## Consequences

- The exported SVG is now self-contained (full-size rects plus one style rule) and renders transparent gaps without a background color.
- The Gap slider drives `--gap-inset`, which re-renders the clip-path; verified in Playwright that the computed clip-path updates (e.g. `inset(15% round 0.1px)` for gap 0.3).
- Presets now reflect the shipped glyph catalog (`pixel-mark-catalog.json`) instead of toy symbols.
- The glyph gallery (`deepseek-harness/design/pixel-symbols-mockup.html`) is presented alongside the rasterizer demo.
- Cost: clip-path support is required (widely available in modern browsers); older renderers fall back to full-size rects with no visible gap.

## Testing

- `node --check` passes on the extracted script.
- Playwright verification: 31 glyph presets loaded, 8/16/24/32 grid options present, raster resolution select present, overlay renders 256 rects at 16×16, gap slider changes computed clip-path, no duplicate ids, console clean except expected favicon 404.
