# Agent Note: Turbo draws one split-landing indicator for both drags

Status: implemented

## Problem

Turbo offers two ways to make a split. A Session row dragged from the shared sidebar onto a cell edge sets `data-drop` on the tile and paints a tinted half with an accent frame and a caption ("Split left", "Split above", ...). A cell moved by its title bar hands the gesture to `react-mosaic-component`, whose `.drop-target` overlay painted a black frame over a `rgba(0, 0, 0, 0.2)` wash at the same half and drew no caption. On the shell's dark ground the second indicator was nearly invisible, so the same operation read as two different gestures.

## Decision

`TurboGrid.module.css` declares one landing indicator shared by both selectors: `.tile[data-drop]::after` for the native Session drop and `.canvas .mosaic-drop-target .drop-target-container .drop-target` for the library's move target. Both draw the business-primary accent frame, the `color-mix(label-secondary 18%, transparent)` tint, the 4px radius, and a 10px uppercase caption naming the half. Four paired rules map the position class to "Split left", "Split right", "Split above", and "Split below" — the captions the Session drop already drew. The library keeps its geometry: its target is still the absolutely positioned box the mosaic sizes, and the shared rule sets no inset, size, opacity, or stacking; only the paint and caption are overridden. The native overlay keeps its pseudo-element box and half insets.

## Alternatives considered

**Make the Session drop take the library's black frame.** Rejected: that is the indicator that was nearly invisible on the dark shell, and the captioned accent half already named the operation the reader is performing.

**Route both drags through one drop system.** Rejected: a sidebar row drag is native HTML5 DnD while a moved cell is a `react-dnd` drag owned inside `react-mosaic`; the kit renders and sizes its own target elements, so the shared surface is the stylesheet, not the event path.

**Draw a Turbo-owned overlay for the moving tab.** Rejected: the library owns the target element and its drop bookkeeping; a second overlay would need a parallel drag state for a gesture the library already reports, while the library's own target is the element Turbo can style.

## Consequences

Moving a cell now names and frames the split it would make, matching the Session drag, so the two gestures read as one operation. The captions live in the stylesheet as English text, as the Session overlay's already did; both move together if that copy is ever localized. The library's targets still rest at a 30% band and expand to 50% on hover, so only the painted half is visible during a drag. A root-edge target the mosaic also renders for a window move takes the same frame and caption, which is the same operation and intentionally covered.

## Testing

- `packages/client/ui-turbo/tests/drop-indicator-styles.client.spec.ts` pins the shared rule's placement under `.canvas` and its accent frame, radius, tint, and caption case, the four position/caption pairs, and that the shared rule carries no geometry.
- The package suite passes: `pnpm exec vitest run packages/client/ui-turbo/tests` (23 tests).
- A Playwright pass over a running `dsh web` in Turbo mode dragged a cell's title bar onto a cell half: the hovered target computed an `rgb(123, 180, 188)` border, the 18% tint, `border-radius: 4px`, and the `"Split left"`/`"Split above"` captions, and releasing still moved the cell. The Session row drag still painted its unchanged half and caption.

## Related

- [Turbo mode — a per-window layout choice and a chat-cell grid](../feature/2026-10-28-turbo-mode-chat-grid.md)
- [Turbo rebalances a split from a button on its border](../feature/2026-10-29-turbo-split-rebalance.md)
