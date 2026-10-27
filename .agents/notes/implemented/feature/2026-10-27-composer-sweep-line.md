# Agent Note: Composer sweep line replaces the in-chat turn status row

Status: implemented

## Problem

A running turn announced itself inside the transcript. `ChatView` mounted a
`role="status"` row above the composer that paired the 24-grid pixel DO loader
([pixelized loading sweep](2026-10-08-pixel-do-loading-sweep.md)) with the
newest tool-call purpose scraped out of the call arguments, falling back to
`Deep diving...` / `游泳中…` before any call carried one. The row is transcript
furniture: it takes flow height, so every turn start and end shifts the tail,
and it reports an interval the composer already owns — the primary button flips
to Stop (`input.stop`) for exactly the same span.

The ask was a pixelated line sweeping back and forth on top of the input box's
container: the running signal should ride the composer, not the conversation.

## Decision

`ConversationRoot` renders `.composerSweep` while `running`: a 4px pixel rule
across the composer column's full width at the top edge of `.composerSeat` —
the element that holds every bottom element, from the `conversation.input.dock`
cards through the input bar to a business `conversation.composer` takeover. The
line therefore never sits inside the input box, never narrows to the card's
`--dsh-composer-card-max-width` cap, and stays on screen when an election hides
the chain fallback. A 4px cell on a 6px pitch keeps the pixel grid's gap; a
second layer with the identical pattern carries a travelling mask window, so the
lit cells light up in place instead of sliding out of phase with the rule
beneath, and `animation-direction: alternate` returns the sweep.
`prefers-reduced-motion` parks the window without dropping the line.

Absolute positioning keeps the band out of the layout: the composer seat
measures itself and publishes `--dsh-composer-height`, so an in-flow band would
resize the chat's bottom inset on every turn boundary. The band mounts only
while the turn runs and is `pointer-events: none`.

The row and its machinery are deleted rather than left in place: `TurnStatus`,
`PURPOSE_RE`, `extractPurpose`, `latestToolPurpose`, the `legacy.runningCalls`
selector it alone consumed, the `.turnStatus*` rules and their `turn-status-in`
keyframes, the `chat.swimming` / `chat.deepDiving` keys in both dictionaries,
and the atlas sheet's `_turnStatus` / `_turnStatusSpinner` overrides. The band
keeps the live region the row owned — `role="status"` with the locale-owned
`input.running` label — so the running state is still announced, while the
composer accent picks up `--dsw-alias-state-business-primary` (the token the
composer's caret and dock bounds already use) in both themes with no
sheet-specific override.

## Alternatives considered

**Keep the row and swap only its spinner for the sweep.** The row itself was the
complaint: it is transcript furniture that shifts the tail, and it reports the
same interval the composer's Stop button reports.

**Animate the band's `background-position` instead of a mask window.** The lit
cells would then march out of phase with the dim rule underneath, and at a 6px
pitch the pixel grid stops reading as a grid.

**Host the band inside `InputBar`, on the input card's container.** It draws the
same line while nothing takes the composer over, but `conversation.composer`
election hides the chain fallback, so the running signal vanished exactly when a
question or approval took the composer, and a `conversation.input.dock` card
left the line below the dock instead of above the column.

**Ship the band `aria-hidden` and let the Stop button carry the state.** Cheaper,
and it keeps the golden edits to a deleted line, but it drops the only
live-region notice that a turn started, which the removed row provided.

## Testing

`chat-view.client.spec.tsx` asserts the chat column renders no status region
while a turn runs; `skeleton.client.spec.tsx` asserts the band mounts on the
seat only while `running` and survives a composer takeover. The band is pinned
by the aria snapshots, which carry `- status: Running…` at the composer's
position, and the two web e2e waits that synchronized on `'Swimming…'` now poll
`getByRole('status', { name: 'Running…' })`.

## Consequences

- The newest tool-call purpose is no longer surfaced while a turn runs; the
  `description` scrape had no other reader.
- The band is the turn-level running affordance. Per-row marks (streaming veils,
  running tool rows, reasoning marks) stay in the transcript, and no turn-level
  status row remains there.
- Golden aria snapshots that pinned `- status: Deep diving...` now pin the
  composer band's `- status: Running…` at the composer's position in the flow.
- `ui-chat` no longer imports `PixelLoader`; the loader's remaining web readers
  are the picker, trajectory, attachment, and boot surfaces — the
  [pixelized loading sweep](2026-10-08-pixel-do-loading-sweep.md) note records
  the same seating.
