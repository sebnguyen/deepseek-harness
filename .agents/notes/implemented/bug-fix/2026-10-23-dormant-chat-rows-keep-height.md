# Agent Note: a dormant Chat row keeps its reserved height

Status: implemented

## Problem

The Chat transcript virtualizes long histories through the row window: every `ChatNodeSeat` keeps its `.flowItem` shell mounted, and a row that leaves the live band swaps its content for a height-reserving spacer tagged `data-row-dormant` (`packages/client/ui-chat/src/client/chat/row-window.tsx`, `ChatNodeSeat.tsx`). `ChatView.module.css` also collapses keyed rows a renderer declined with `.flowItem:has(> *:only-child:empty)`. A dormant shell's only child is the spacer, and an empty spacer is itself `:empty`, so the decline rule matched the dormant shell and applied `display: none`. With no box, the row leaves flow entirely and its `IntersectionObserver` can never report it intersecting again, so the content cannot remount. A reader who chained `Load earlier` across the row-window band saw the newest messages (tail-pinned, never dormant) and the page nearest the viewport, while every page between them clipped out — history that looked like the newest reply followed by a gap.

## Decision

Both arms of the declined-row collapse exclude dormant shells: `.flowItem:not([data-row-dormant]):empty` and `.flowItem:not([data-row-dormant]):has(> *:only-child:empty)`. `data-row-dormant` is the row window's existing non-live marker, so the exclusion stays local to the state that owns the spacer. Declined rows (completed-turn tails with nothing to show, settled span boundaries) keep collapsing; the gap rule already ignored dormant shells because their spacer child made them non-empty.

## Alternatives considered

**Make the spacer non-empty (NBSP or a filler child).** Rejected: it would defeat the `:empty` arm by accident, add meaningless content to the document, and silently reintroduce the collapse when someone cleans up the filler.

**Override `display` for `[data-row-dormant]` after the collapse rule.** Rejected: both selectors have the same specificity, so the fix would depend on source order and on no later rule overriding it.

**Raise `LIVE_BAND_ROWS` or stop dormancy for paged history.** Rejected: it spends the render budget the row window exists to protect and leaves the same selector hazard for every row past the new band.

## Consequences

Dormant rows keep their measured height and stay observable, so scrolling back wakes and remounts them. They also keep their 4px column gap as before. A future declined-row selector must preserve the `:not([data-row-dormant])` exclusion; the regression test pins it.

## Testing

`packages/client/ui-chat/tests/chat-row-window-styles.client.spec.ts` pins both selectors' `[data-row-dormant]` exclusion and the seat's `data-row-dormant={live ? undefined : ''}` marker; the existing ui-chat suite stays green. A Chromium probe over the two selector forms showed the old rule computing `display: none` / height `0` for a dormant shell and the fixed rule computing `display: block` / height `340`.
