# ui-turbo

Registers the **Turbo** choice card and keyed shell mode into `ui-layout-mode`.
The mode is pinned by the launch chooser; Turbo owns no exit control and no
mode-switching service. Switching to another mode means opening a new window.

This package owns the Turbo composition:

- the shared full `SidebarRoot`, rendered through the frame's `renderSidebar`
  owner prop, so brand, New Session, workspace browser, search, settings, and
  the footer are the normal sidebar rather than per-cell chrome;
- a dynamic, n-ary tiling canvas backed by `react-mosaic-component`. Every leaf has a stable cell id; the toolbar Split adds one local empty sibling and close removes a leaf. A round button sits in the middle of every split border and equalises that split's panes on a click, so adding a Session keeps its sizing and rebalancing is explicit;
- one optional Session per cell, rendered by the shipped `main.conversation`
  surface under `PinnedSessionProvider`. Sessions are assigned by dragging a
  row from the sidebar or by the empty cell's New Session action;
- duplicate-session focus announced through the shared transient Toast, and composer focus gating;
- empty cells that show the static DigitalOcean mark, an **Empty Slot** title,
  and an explicit New Session action;
- a sidebar New Session that creates or reuses a blank Session and appends a cell for it, and a cell New Session that inherits the sidebar's default Workspace (the current Session's Workspace, otherwise the most recent) so the new chat starts attached instead of at the host default directory. Closing the cell that holds the current provisional blank Session clears the selection instead of appending it again; closing every cell returns the canvas to its empty New Session view. Empty cells never create a Session merely by existing.

The mode receives two owner props, `renderConversation` and `renderSidebar`,
from the frame and decides where and how many times to call each. Because the
frame owns shell chrome, Turbo does not register the default-mode open-in-app
action or the right-sidebar header toggle; the cell conversation stays a pure
chat surface.

## Model Experience

The mode is a presentation over the existing conversation surface. A cell is
not a second chat implementation: it mounts the same keyed `main.conversation`
entry, scoped to the cell's Session.

## No invariant

This is a browser presentation plugin; it has no host-plane or independent
runtime relationship to publish an invariant for.
