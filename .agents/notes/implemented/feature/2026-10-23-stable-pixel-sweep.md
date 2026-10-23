# Agent Note: Stable 16x16 pixel sweep

Status: implemented

## Problem

The shared pixel mark shipped two independently derived grids (16 and 24) and a
`pixelLoaderGap` that widened the gap below a 1px pitch. The scale therefore
changed with the rendered size: small chrome used a coarser geometry than the
24px surfaces, and sub-pixel renders changed the pixel-to-gap ratio. The
pipeline mock already proved that a fixed 16x16 coverage window plus a gap held
in viewBox units keeps the proportions at every size; the runtime and the
generated assets did not use that one stable scale.

## Decision

`design/pixel-do-loader-gen.mjs` now locks `GRID = 16`, derives the grid once
through the 16x16 kernel, and emits one `PIXEL_LOADER_CELLS` array. The gap is a
constant `INSET = 0.1` (20%) in viewBox units, so 12px and 168px render the same
pixel scale and the same proportions. Every face — sweep and twinkle — uses the
one grid. `PixelLoader` no longer takes a `grid` prop, renders
`viewBox="0 0 16 16"`, and calls `pixelLoaderInner()` /
`pixelLoaderTwinkleInner()` without a size argument. The 24-grid cells, twinkle
schedule, and `pixelLoaderGap` export are gone; `PIXEL_LOADER_CELLS_16` /
`PIXEL_LOADER_TWINKLE_16` survive only as compatibility aliases. The engine
writes the stable sweep to `design/pixel-do-loader-stable.svg` and replaces
every sweep asset (`pixel-do-loader.svg`, `pixel-do-loader-16.svg`, the
blue/DO variants) with the same 16x16 geometry; the generated mock, desktop
SMIL splash, and vscode letterpress ride the same grid. Every runtime
`PixelLoader` call site drops its `grid={16}` prop.

The prior shared-sweep decision remains [the pixelized loading
sweep](2026-10-08-pixel-do-loading-sweep.md); this note supersedes only its
two-grid and sub-pixel-gap rules.

## Alternatives considered

**Keep both grids and switch at a size threshold.** Rejected: the two
derivations do not share a silhouette, so the mark visibly changes pixel scale
when the host crosses the threshold.

**Keep the 24 grid as the stable scale.** Rejected: 12–16px chrome loses the
detached dot and smears cells. The 16x16 kernel is the coarsest grid that still
keeps every feature, so it is the scale that survives both ends.

**Keep `pixelLoaderGap` as an optical correction below 1px.** Rejected: the
request is a fixed pixel scale; a size-dependent gap is exactly the instability
this change removes. The 20% gap is the mock's settled value and reads as the
same mark at every size.

## Consequences

One grid, one gap, one set of generated assets. The mark is chunky at large
sizes by design; that is the price of a stable 16x16 pixel scale. The trade is
covered by the pipeline check: `node design/pixel-logo-pipeline-check.mjs`
re-derives the grid and fails if the shipped cells or the 16-grid lock drift.
The design walkthrough now compares the shipped stable grid against the 16x16
derivation instead of a hand-drawn 24 grid.
