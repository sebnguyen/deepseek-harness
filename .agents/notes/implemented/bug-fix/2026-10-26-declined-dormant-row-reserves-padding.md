# Agent Note: a declined chat row reserves no padding when it sleeps

Status: implemented

## Problem

A Chat Node whose renderer declines still gets a `ChatNodeSeat` shell. Live, the
shell is `display: none` (`ChatView.module.css` collapses `.flowItem` when it is
empty or holds a single empty child), so the row measures 0 and costs nothing.
Dormant, the shell is exempt from that rule on purpose - a box-less element
never intersects the observer again, which would permanently clip chained
`Load earlier` pages - so the shell comes back with its own block padding and
nothing inside the spacer.

Measured on a 265-row transcript at `LIVE_BAND_ROWS = 100`: every dormant
`assistant-step-start` and `assistant-step-end` shell was **16 px** tall (8 px
top + 8 px bottom padding, a 0 px spacer), while the same row live was 0 px.
That was 95 rows in that session, and the step boundaries render nothing at all
(`DeclinedStepBoundaryView` returns null), so the whole 16 px was phantom.

The cost was the jitter itself. Over 80 frames of scrolling, the ledger flipped
row state **1234 times**, 115 of 265 rows changed height, and the scroll height
swung between 4576 and 5372 px - 796 px of movement that followed the reader.
Every one of the top offenders was a step boundary going 0 -> 16 -> 0.

## Decision

The seat drops the shell's block padding when it is dormant with a reserved
height of zero:

```tsx
const unpadded = !live && dormantHeight === 0
<div className={css.flowItem} data-row-dormant={...} style={unpadded ? { paddingBlock: 0 } : undefined}>
```

The box stays in layout, so the observer still wakes it - verified in the
browser by scrolling a 0 px dormant row into range: it came back live. Only the
padding goes.

## Alternatives considered

**Extend the `:empty` rule to dormant shells.** That collapses the row to
`display: none`, which is exactly the box-less case the CSS comment warns about:
the row would never intersect again.

**Subtract the padding from the reserved height.** Hides the cause and leaves
the phantom padding in the box model, where any future border or margin change
would bring the jump back.

**Skip rendering the seat for declined nodes.** The seat is the anchor: its
`data-chat-anchor-key` and flow key drive scroll anchoring, prepend
compensation, and the `Load earlier` chain.

## Consequences

Dormant declined rows are now 0 px instead of 16 px. In the same 265-row
session, every dormant `assistant-step-start` and `assistant-step-end` measures
0 px (was 16), and the settled scroll height is identical at the top and the
bottom of the transcript across a full round trip (delta 0 px, twice).

## Related

- [A viewport-sized live band for the chat row window](../simplification/2026-10-26-chat-row-window-band-100.md)
- [A dormant chat row reserves its content box, not its padded box](2026-10-26-dormant-row-spacer-double-padding.md)
