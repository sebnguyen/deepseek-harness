# Agent Note: Turbo rebalances a split from a button on its border

Status: implemented

## Problem

Turbo appended every new cell to the root split and gave the newcomer half of a neighbour's share, so a fresh canvas grew into one ever-narrower row and a user who had resized a split lost that balance on the next add. A full-canvas retile fixed the sizes but moved cells between rows and columns, which discarded the arrangement the user built. The user asked for an explicit control instead: a small button in the middle of a split border that rebalances the panes inside that split, on demand.

## Decision

Adding a Session keeps the original sizing: `appendCell` and `insertCell` still halve the share of the cell they join. Rebalancing is only triggered by a round button rendered in the middle of every split border. Clicking it equalises the children of that split, leaving every other split and every cell's order and nesting untouched.

The button rides `react-mosaic-component`'s `resize.renderSplitHandle`, which renders one handle per divider. A divider's DOM order matches the order `MosaicRoot` walks the tree (`collectElements` pushes the divider that follows each child), so `TurboGrid` maps the clicked divider's index to its split path with the pure `dividerSplitPaths` helper and equalises it with `rebalanceSplit`. Both helpers live in `packages/client/ui-turbo/src/client/surface.ts`; `TurboGrid` owns only the DOM index mapping. The handle stops the press (its button stops `mousedown`/`touchstart`/`click` propagation) so tapping it does not start a bar drag.

## Alternatives considered

**Retile the whole canvas into a balanced grid.** Rejected: it moved an existing cell into a different row when a fourth cell arrived, losing the user's arrangement.

**Rebalance the receiving split automatically on add.** Tried, then rejected on request: the user wanted add to keep sizing and to bring the divider into balance themselves.

**A toolbar or chooser button with no per-divider placement.** Rejected: the divider button sits where the imbalance is visible, so the control names the split it rebalances.

## Consequences

Rebalancing is explicit and local: a click equalises one split and nothing else moves, so a cell never changes rows, columns, or nesting. Adding a Session still narrows the row it joins over repeated adds, exactly as before; the button is the only way to even a split out. The handle is ignored on touch and does not start a resize drag.

## Testing

`packages/client/ui-turbo/tests/surface.client.spec.ts` covers `dividerSplitPaths` (render-order mapping including the root divider and a 2x2 grid) and `rebalanceSplit` (equalising the target split, preserving the others, and no-ops on a leaf, tabs, missing child, or missing tree), alongside the restored add/insert sizing and the removal and drop-edge helpers. The package suite runs under `pnpm run test:gui`.

## Related

- [Turbo mode — a per-window layout choice and a chat-cell grid](./2026-10-28-turbo-mode-chat-grid.md)
