# Agent Note: Swappable track order — IDE between sidebar and conversation

Status: implemented

## Problem

The harness frame pinned the conversation in the center between the workspace
sidebar and the edge-anchored tool panel that hosts the embedded IDE
(`ui-vscode`). The product layout the frame needed to draw is:
workspace sidebar → IDE (activity bar, file explorer, editor) → chat. With the
frame's only order — sidebar | conversation | tool panel — the chat could
never sit right of the code surface, and moving the IDE beside the sidebar was
impossible without rewriting panel geometry.

## Decision

The frame gained a first-class track-order flag instead of a new panel seat:

- `LayoutInfo.swapped` (default `true`) picks the grid composition in
  `AppFrame`: swapped renders `sidebar | tool | center`, stock renders
  `sidebar | center | tool`; `columns.ts` is untouched and both orders solve
  the same widths per frame.
- The right panel occupant's contract (shown/track/fullscreen, width reports)
  is unchanged. `RightbarRoot` still hides when a global `main` panel is
  selected; fullscreen is frame-fixed and identical in both orders.
- `SidebarRight`'s panel chrome mirrors under the frame's
  `data-rightbar-swapped` attribute: it anchors to the column's steady left
  edge and slides out to the left, preserving the shared-curve motion in the
  opposite direction.
- `ctx.layout.toggleSwap()` flips the flag and `ctx.layout.layoutInfo`
  publishes the layout snapshot. The `layout.swap` toggle itself ships with
  ui-sidebar (owner of the footer seat): it registers into
  `sidebar.footer.action` from its own `slots.inject`, reads the order
  through the inject `hooks` compartment bound as `useLayoutInfo`, and its
  copy lives in the sidebar dictionary (zh + en).
- The embedded VS Code twin's own explorer is left-default already; no part of
  the change touches the twin or its settings, per the verification that
  nothing injects `workbench.sideBar.location`.

## Alternatives considered

- **Promote the IDE to a `main` panel and move the conversation into the
  right bar.** That re-hosts conversation sub-registrations (composer, header,
  docks) that descend from `main`, splits the right-bar occupant contract
  between two content kinds, and breaks `RightbarRoot`'s
global-panel-hides-right-bar rule. The swap achieves the same visual order
  without moving any feature's seat, so the deeper re-hosting was rejected as
  oversized for a track-order requirement.
- **Fly the IDE wide in the stock right slot** (relax `RIGHTBAR_MAX_RATIO` and
  let the panel cover most of the frame while chat stays center-left). That
  weakens the column contract and still reads chat-left-of-IDE, not the
  requested strip.

## Consequences

- The shipped order puts the workspace sidebar, the IDE span, and the chat in
  the requested sequence; one footer click (session-scoped, like the other
  frame preferences, which all reset on reload) restores the legacy order.
  The toggle landed in ui-sidebar rather than ui-layout because ui-sidebar
  already type-imports `MainPanelId` from ui-layout — registering the seat
  occupant from ui-layout would have closed a TypeScript project-reference
  cycle.
- Every right-bar tab — not only `ui-vscode` — rides the swap, since tabs own
  content, not placement. Accepted: the IDE tab is the frame's anchor use and
  the toggle reverts globally.
- The geometry suite keeps its single `computeColumns` source; tests acquired
  a dual-template pattern and dedicated swapped handle/drag cases instead of
  duplicated column math.
