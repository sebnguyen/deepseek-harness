# Agent Note: A session drag no longer retracts the sidebar's hover preview

Status: implemented

## Problem

On a collapsed rail, dragging a session row to reorder it retracted the hover
preview. The browser takes the pointer for a native drag: after `dragstart` it
fires `pointercancel` and a synthetic `pointerleave` on the column at
`clientX/clientY` 0,0 while the pointer is still over the column (observed in
Chromium). The shell's pointer-leave handler read that as a real leave and
cleared `hovered`, so the panel slid shut mid-drag. The focus close rule from
[the sibling note](2026-10-26-sidebar-hover-preview-focus-out.md) did not cover
this path because no focus event is involved.

## Decision

`SidebarRoot` marks a drag that starts inside the column (`onDragStart` bubbles
from the session rows) and its pointer-leave handler returns while that drag is
active. On `dragend` it clears the mark and classifies the release point
against the column's box: a release inside keeps the preview open (the browser
re-fires pointerenter on the next move, restoring normal leave tracking), and a
release outside closes it, because that is the real leave the browser
suppressed during the drag. Chromium reports the release point on `dragend`
(200,300 inside and 550,200 outside in the Playwright probe).

## Alternatives considered

- **Ignore any `pointerleave` at `clientX/clientY` 0,0.** The synthetic leave
  is at 0,0, but a real leave at the viewport origin has the same coordinates,
  and the rule would rest on a coordinate coincidence rather than on the drag.
- **Track `pointercancel` and ignore the following leave.** `pointercancel`
  also fires for touch scrolling and other gestures where the hover preview is
  irrelevant; the drag start is the event that says the pointer was taken for
  a drag.
- **Re-evaluate with the next real pointer move only.** A drag released
  outside the column would then leave the preview open until the pointer
  re-entered and left again; the release point is available at `dragend`.

## Consequences

- A session drag holds the preview open for the whole drag and keeps it open
  when the row is dropped inside the column.
- Dropping a drag outside the column closes the preview immediately, matching
  the pointer's real position.
- A drag that starts elsewhere (a file drop, a text selection in the
  conversation) does not touch the preview because `dragstart` never bubbles
  through the column.

## Testing

`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` adds both
halves: a `dragstart` then a synthetic 0,0 `pointerleave` keeps the shell wide
through the drag and an inside release, and an outside release settles back to
the rail. The first assertion fails without the drag guard. The changed client
graph typechecks with `pnpm exec tsc -b tsconfig.client.json`.
