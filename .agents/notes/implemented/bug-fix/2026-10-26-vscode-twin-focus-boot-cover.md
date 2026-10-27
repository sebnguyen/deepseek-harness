# Agent Note: The twin frame cannot take focus while its boot cover is sealed

Status: implemented

## Problem

The workspace twin's iframe took the keyboard on mount and on every reload. The
workbench focuses its restored editor inside the frame shortly after the
document loads (measured at load + 250–375 ms against the live twin), and
focusing inside an iframe promotes browser-level focus to the `<iframe>`
element. The parent guard already returned an automated grab, but it treated a
`pointerover` on the frame as the user's own entry. A freshly inserted iframe
under a resting cursor fires exactly that event, so the guard read the mount as
a click and kept the workbench's focus. The verified hold also survived a source
change: after the user had once entered the frame, the next document's boot
focus was accepted without a new gesture. Both windows are sealed by the boot
cover, which no pointer can reach.

## Decision

The focus guard reads the cover through `coveredRef`. While the cover is sealed
(`settledSrc !== src`), every focus move onto the frame is automated by
definition: the guard retires the verified hold, hands focus back to the
last element outside the twin, and does not consult the pointer or the Tab
grace. A changed `src` also clears the hold immediately and re-arms the cover,
so the new document has to earn its own entry. Once the cover lifts, the
existing rule stands: a pointer inside the frame or a Tab just pressed grants
entry, and every other grab is handed back.

## Alternatives considered

- **Suppress focus inside the twin (block `HTMLElement.prototype.focus` until a
  gesture).** This is the only way to prevent the browser from ever assigning
  focus to the frame, but it needs a twin rebuild and a workbench-level
  monkeypatch whose effects on the workbench's own focus bookkeeping are hard to
  bound. The harness owns the seat; keep the fix there.
- **Deny for a fixed window after load.** The workbench's deferred restore can
  land later than any chosen margin, and the boot cover already defines the
  interval in which the frame is unreachable; a second clock would duplicate it
  and could expire first.
- **Ignore pointer presence entirely after boot.** The parent cannot see a
  `pointerdown` inside a cross-origin iframe, so pointer presence is the only
  click signal it gets. Ignoring it would make the pane's first click after a
  reload get handed back, forcing the user to leave and re-enter the frame
  before the editor responds.

## Consequences

- Mount and reload can no longer hand the keyboard to the workbench; the
  composer (or whatever held focus) keeps it without a visible focus flicker.
- A reload keeps the pointer's presence fact, so a click straight into the
  pane after the cover lifts still enters the frame; only the previous
  document's verified hold is retired.
- A late automated grab that lands after the cover lifts while the pointer is
  already over the frame is still accepted. That is the same trade the seat
  made before this change: cross-origin frames expose no click event, so the
  pointer is the only entry signal the parent has.

## Testing

- `packages/client/ui-vscode/tests/vscode-twin.client.spec.tsx` covers the
  sealed-cover denial for a pointed and a tabbed move, the post-settle entry,
  and the retired hold across a source change.
- Playwright against the live twin: the workbench took focus at load + 375 ms
  with the pointer resting on the frame; a probe carrying the new covered rule
  kept the parent's owner focused, while the same probe without it left focus
  on the frame.
