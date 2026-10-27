# Agent Note: a viewport-sized live band for the chat row window

Status: implemented

## Problem

The Chat transcript keeps every `ChatNodeSeat` shell mounted and gates content
on a per-scroller live band (`packages/client/ui-chat/src/client/chat/row-window.tsx`).
`LIVE_BAND_ROWS` was 480, sized to a history page. Because every seat starts
live and the ledger's count starts at zero, a session with one or two pages
loaded never crossed the band at all: the retained set tracked the loaded window
instead of the viewport, and dormancy never ran.

## Decision

Set `LIVE_BAND_ROWS` to 100, sized to the visibility window the ledger already
observes - the viewport plus one viewport of margin (`rootMargin: '100% 0px'`)
plus headroom. A long session now sheds every off-window row; a short one still
unmounts nothing, because every row starts live.

This bounds retention by the viewport rather than by what has been loaded. It
does **not** reduce the session-switch mount spike: rows still start live and
shed only after the live count crosses the band, so the initial commit is
unchanged.

## Alternatives considered

**Gate the initial mount** (start only the tail and viewport rows live, mount
the rest as spacers). This is the change that would remove the mount spike; it
needs a durable height source first, because a dormant row with no measured
height cannot preserve scroll position.

**Leave the band at 480.** Dormancy stays rare, which hides the remount cost,
but the band is then dead code for ordinary sessions.

## Consequences

Dormancy becomes the normal state on a long session, so a scrolled-into row is
rebuilt from scratch: markdown re-parses, code fences repaint from plain to
highlighted as they enter the viewport (`CodeBlock.tsx`,
`useViewportHighlighting.ts`), images decode after mount. Two defects surfaced
under the smaller band and were fixed alongside it: the reserved height
double-counted the row's block padding, and collapsed bodies were mounted for
kinds whose body is expensive. Browser find now reaches fewer rows, and only
the ones inside the band.

Known defect, fixed: `assistant-step-start` and `assistant-step-end` rows
render 0 px when live but reserved 16 px when dormant, because the dormant
shell's own block padding came back while its spacer stayed at 0. See
[a declined dormant row](../bug-fix/2026-10-26-declined-dormant-row-reserves-padding.md).

## Related

- [A dormant chat row reserves its content box, not its padded box](../bug-fix/2026-10-26-dormant-row-spacer-double-padding.md)
- [A declined dormant row reserves no padding](../bug-fix/2026-10-26-declined-dormant-row-reserves-padding.md)
- [Collapsed chat bodies mount on expand](2026-10-26-mount-collapsed-bodies-on-expand.md)
