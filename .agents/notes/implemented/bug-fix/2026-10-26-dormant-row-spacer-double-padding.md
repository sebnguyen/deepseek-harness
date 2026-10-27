# Agent Note: a dormant chat row reserves its content box, not its padded box

Status: implemented

## Problem

The Chat transcript's row window swaps a sleeping row's content for a spacer
sized from that row's measured height (`packages/client/ui-chat/src/client/chat/row-window.tsx`).
The spacer renders inside the same `.flowItem` shell the content had, and that
shell carries block padding.

The measurement was the shell's `offsetHeight` — the border box, padding
included. Feeding that number back into a child of the padded shell pads the
row a second time, so every dormant row stood one padding-height taller than it
stood awake. The column's scroll height therefore moved each time a row slept
or woke. With `LIVE_BAND_ROWS` at 480 that almost never happened; with a
viewport-sized band it happens constantly.

Measured on a 136-row transcript: a round trip from the bottom to the top and
back grew `scrollHeight` from 3617 px to 3921 px — 304 px across the rows that
flipped, about 10 px per dormant row, twice the shell's 5 px block padding.
Forcing the dormant shell's block padding to zero collapsed the same round
trip to 0 px of drift.

## Decision

`dorm()` records the shell's content box: its rect height minus padding and
borders, floored at zero. The spacer then renders at exactly the size the
content occupied, and the shell's own padding reproduces the rest.

The read still happens at the end of the exit hold, while the content is
mounted and late height changes have landed.

## Alternatives considered

**Zero the shell's block padding while dormant.** It works — injecting
`[data-row-dormant] { padding-block: 0 }` into the running app zeroed the
drift — but it makes correctness depend on a cascade the window does not own,
and it breaks silently if a row kind adds borders or another padding source.

**Keep `offsetHeight` and subtract a constant.** Rejected: the padding is a
rendered fact, not a constant the window can know.

## Consequences

- A sleeping row occupies exactly the space its content occupied, so scroll
  height is stable across sleep and wake and the scrollbar stops moving.
- One `getComputedStyle` runs per dormancy, inside the hold's timer rather than
  the observer callback; dormancy is a settle-time event, so it sits off the
  scroll path.
- `getBoundingClientRect().height` replaces the integer `offsetHeight`, so the
  reservation also stops discarding the sub-pixel remainder.

## Related

- [Dormant chat rows keep their reserved height](2026-10-23-dormant-chat-rows-keep-height.md)
- [A viewport-sized live band for the chat row window](../simplification/2026-10-26-chat-row-window-band-100.md)
