# Agent Note: Pixelized DigitalOcean loading sweep

Status: implemented

## Problem

Every loading surface drew its own activity ring: the web boot page's conic arc, the chat deep-diving shimmer text, the workspace picker's text-only pending line, the trajectory history ring, the attachment upload ring, and the desktop startup ring. Six mechanisms, six palettes, six reduced-motion branches, and none of them spoke the product's identity. The boot arc alone could show progress; the rest could only spin.

## Decision

One shared symbol replaces all of them: the pixelized DigitalOcean mark minted from the vendored logo path (`design/pixel-do-loader-gen.mjs` buckets coverage-minted grid cells into sixteen clockwise 22.5-degree sweep groups). Each group runs one shared 1.2s step-end opacity ladder (full color at the sweep head, decaying to 0.22 over six steps); pixel rects carry geometry only, inset 0.15 per cell for 30% gaps. `design/pixel-do-loader-gen.mjs` is the single source: run `node design/pixel-do-loader-gen.mjs` to regenerate the design marks, the live mock page, the shared generated module, and the desktop fragment together.

`ui-primitives` owns the web runtime face. The generated module publishes the two grids as clockwise bucket-cell arrays, and `pixelLoaderInner(grid, size)` builds the whitespace-free markup: one `<g class="dsh-pl">` per bucket whose positive `animation-delay` is its clockwise begin (the CSS twin of the SMIL `begin` offset, so the light-up order stays 12-o'clock-first clockwise) plus the host shift. `PixelLoader` renders that markup at the requested square size with `grid` 16 or 24 and appends the sweep stylesheet `PIXEL_LOADER_CSS` (ladder + `prefers-reduced-motion` guard) to `document.head` once behind `[data-dsh-pixel-loader-style]`; framework-free hosts call `installPixelLoaderStyles()` themselves. The markup carries geometry only, so a wrapped `role="status"` label's `textContent` stays clean for copy pinned in specs. Hosts shift the whole sweep through custom properties: every group's delay reads `--dsh-boot-arc` (the boot page's existing 72–288deg roster-ratio signal — the property now shifts the sweep window instead of growing a ring) and `--dsh-pixel-loader-boost`, while ordinary readers keep the nominal phase through the fallbacks. `pixelLoaderGap(grid, size)` widens the pixel gap from the locked 30% toward 50% as the rendered pitch drops below one cell, so 12–16px chrome keeps the silhouette instead of a solid blob.

The 16x16 grid seats small chrome where the 24 grid would blur: the workspace picker pending line (16px) and trajectory history loading (12px). The 24 grid seats the chat deep-diving status beside its `Deep diving...` label and clock (24px, status keeps `role="status"` and the locale-owned text), attachment upload cards (20px), and the web boot page (24px inline-injected into `[data-dsh-boot-spinner]`, preserved through ui-renderer hydration like before). The desktop startup splash cannot inline styles under its CSP (`style-src 'self'`), so it carries the generator's SMIL twin of the same buckets (begin offsets instead of CSS delays) inline in `startup.html`, and `startup.js` pauses it via `pauseAnimations()` under reduced motion. The `verify-hairline` allowance for ring tracks and all ring keyframes are deleted with the rings.

## Alternatives considered

**Per-pixel SMIL animators.** Rejected before this note: ~330 `<animate>` elements per instance multiplied across boot, chat, and splash. Bucketed groups need exactly sixteen animators for the identical sweep.

**PNG sprite baking.** Rejected by review: the sweep should stay vector so theme, density, and size scale without artifacts, and a CSS/SMIL body animates identically in every embedding.

**An inline `<style>` inside every loader svg.** Rejected in review: `<style>` text joins the host's `textContent`, and the pinned status assertions (`Deep diving...`, picker loading) read that region exactly. One hoisted stylesheet serves every copy because the class and keyframe names are identical document-wide on purpose; the standalone design marks still embed their own `<style>` so they animate inside `<img>` too.

## Consequences

One idiom replaces six: every loading surface — boot, deep-diving, workspace picker, trajectory, attachment upload, desktop splash — sweeps the same sixteen buckets on one step-end ladder, so theme, density, reduced motion, and identity changes are one edit in `design/pixel-do-loader-gen.mjs` and one regeneration. Web hosts share the one hoisted stylesheet; the desktop splash keeps the generated SMIL twin because its CSP forbids inline styles, and the standalone design marks embed their own `<style>` to animate inside `<img>`. The sweep expresses phase only — a host shifts the window via `--dsh-boot-arc`/`--dsh-pixel-loader-boost` but cannot animate per-pixel geometry. The bought side: one reduced-motion guard inherited by every web host, ring tracks and per-surface keyframes gone with the six retired mechanisms, legible 12px/16px chrome where rings blurred, and a mark that reads as the product instead of a generic spinner.
