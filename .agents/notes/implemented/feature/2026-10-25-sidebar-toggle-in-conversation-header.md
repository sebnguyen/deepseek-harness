# Agent Note: the right-sidebar toggle lives in the conversation header

Status: implemented

## Problem

The right Sidebar's close control lived in the panel's chrome seat at the end of its tab strip, and a separate expand-only button in the conversation header was the way back in while the panel was hidden. Two problems followed.

A `surface` tab type owns the column outright and unmounts the dock, tab strip included. The VS Code workbench declares itself a surface, so once it was active the strip was gone and the only close affordance left was the panel's own chrome over the workbench. The user asked for the close control on the conversation instead, so the sidebar — and with it the workbench — is dismissible from the chat.

The control was also one-way: the header offered only "open" while collapsed, and the close action existed only inside the column it closed.

## Decision

One toggle in `conversation.session.header.corner`, the conversation header's far-right corner, is the panel's close control in normal presentation. It renders in both states; its glyph is the left sidebar's collapse icon mirrored, and its tooltip and accessible name switch between `chrome.expand`/`chrome.expandAria` and `chrome.collapse`/`chrome.collapseAria`. A click calls the store's `setExpanded(sessionId, !expanded)` — not `toggleExpanded`, because a session with no surface yet starts its surface expanded, so a blind flip would leave the first click collapsed.

The panel no longer draws a collapse control in normal presentation. Its chrome seat keeps only the presentation switch, so there is one close control in that view. In fullscreen the panel covers the conversation, including the header seat, so the panel keeps its own collapse control beside the switch; that is the only place a panel-level close control remains.

The header seat is still session-scoped and shares the panel's store, so no new state or wiring crosses a boundary. `ExpandButton` (and its `data-sidebar-right-expand` hook) became `SidebarToggle` (and `data-sidebar-right-header-toggle`); the panel's fullscreen control keeps `data-sidebar-right-toggle`.

## Alternatives considered

- **Keep both the header toggle and the panel collapse control in normal presentation.** Two controls for one action occupy the same view, and the panel's copy is the one the workbench covers; the duplication buys nothing the header toggle does not already provide.
- **Add a VS Code-specific close control instead.** The column already has a close gesture (expand/collapse); a second one would have to decide whether it closes the vscode tab, the column, or both, and would leave the ordinary panel without the same reachable close control.
- **Remove the fullscreen collapse control as well.** Fullscreen would then have no direct close; the user would have to leave fullscreen first, and on a wide viewport that is two gestures for one intent.
- **Fix the panel chrome's stacking and leave the close control there.** That makes the panel's own control clickable over the workbench but still asks the user to reach into the column to dismiss it, which is the placement the request rejected.

## Consequences

- The conversation header now always carries one 28px control while a session exists, where it previously appeared only while the panel was collapsed. The corner seat no longer collapses to zero width in the expanded state.
- Closing from the header collapses the whole column. The active tab survives, so reopening restores the VS Code surface; that is the chosen behavior ("collapse the whole right sidebar"), not a close of the vscode tab.
- The fullscreen presentation keeps a panel-level close control because the header toggle is covered there; both nodes exist, but only the panel's is reachable.
- No service, store, or slot-contract change: the toggle uses the existing `setExpanded` action and the panel chrome keeps its existing props.

## Testing

`packages/client/ui-sidebar-right/tests/sidebar-toggle.client.spec.tsx` covers both directions and the label flip, `seat.client.spec.tsx` pins the fullscreen-only panel control, and the Web e2e suite drives the shipped header toggle through open/close, fullscreen entry and exit, and the collapsed default.
