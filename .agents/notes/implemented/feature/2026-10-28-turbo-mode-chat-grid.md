# Agent Note: Turbo Mode — a per-window layout choice and a chat-cell grid

Status: implemented

## Problem

The Web client renders one conversation at a time. `AppFrame` owns the default
three-column shell — a 56px sidebar rail, one centre column, and one right panel
— and the centre's keyed `main` slot selects exactly one entry
(`packages/client/ui-layout/src/client/AppFrame.tsx`). A user comparing or
driving several Sessions switches sidebar rows and loses the side-by-side view.

The first proposal put a Turbo button under New Session and an exit control in a
fixed rail. Design review rejected that shape: a layout mode is a property of the
window, not a toggle inside the running shell. The product instead asks for the
mode once per load, lets the chosen mode own the window, and makes a different
mode a different window. That changes the composition problem: the mode layer
must be generic, the choice immutable, and a mode must be able to keep its own
chrome without inheriting the default shell's grid.

The single-session assumptions still matter: the runtime keeps one global
current Session (`packages/api/session-controller/src/client/sessions/service.ts`),
the composer refocuses on mount and on every Session-activation gesture
(`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`), and a
populated chat window is expensive. Pinning several Session subtrees side by
side therefore needs an explicit binding per cell and a focus gate on the
composer.

## Decision

### The generic mode seat

`ui-layout` keeps the shell geometry and declares one root-scoped single seat,
`layout.mode`. It holds no mode id, no mode state, and no switcher. When the mode
phase is `choosing`, or the pinned mode is not `default`, `AppFrame` renders the
seat instead of the sidebar, main, and rightbar columns. The frame passes two
owner props, `renderConversation` and `renderSidebar`, which are its own
`renderSlot('main', {}, { entryKey: 'conversation' })` and `renderSlot('sidebar', ...)`.
`AppFrame` reads the mode through the optional `useLayoutMode` standard hook and
falls back to the default shell when no host installed the hook, so a
composition without `ui-layout-mode` still boots.

`ui-layout-mode` owns the mutable mode state and the two rosters. It starts in
`phase: 'choosing'` with `mode: 'default'`, provides the `layoutMode` service and
root hook, registers one host into `layout.mode`, declares the list slot
`layout.mode.option`, and declares the keyed slot `layout.mode.entry`. A mode
registers a presentational card into the option list and a keyed entry into the
entry roster. The host registers the built-in `default` card into that same
list (ordered first), so the chooser is one roster render and the frame has no
special case for the default shell. `choose(modeId)` validates the id against
the live keyed entries and is ignored after the first accepted choice. The
choice is therefore immutable for the window, not merely hidden; choosing
happens on every load.

### Turbo as one mode

`ui-turbo` registers a `TurboOption` card into `layout.mode.option` and the
`TurboMode` component into `layout.mode.entry` under key `turbo`. There is no
`turboMode` service, no layout-store boolean, no sidebar button, and no exit
rail.

`TurboMode` renders `TurboGrid`: the shared full `SidebarRoot` through
`renderSidebar`, beside a dynamic, n-ary tiling canvas backed by
`react-mosaic-component`. Every leaf is a stable cell id; the Mosaic tree owns
geometry, while a separate `Map<CellId, SessionId | undefined>` owns Session
assignment. Splitting adds a sibling and closing removes a leaf without
rewriting Session identity.

Each populated cell pins its Session with `PinnedSessionProvider`, so the keyed
`main.conversation` entry and every session-scoped child below it resolve
against that cell's Session while the ambient selection keeps following the real
current Session. A Session already shown in another cell focuses that cell
instead of mounting a duplicate. The composer's mount autofocus runs only when
the cell's Session equals the current id, so only the active cell takes focus.

A cell without a Session shows the static DigitalOcean mark, the title **Empty
Slot**, and an explicit New Session action. Empty cells are durable: they never
create a Session merely by existing. The sidebar's New Session action creates or
reuses a blank Session and appends a cell for it; a row dragged from the shared
browser assigns that Session to a cell, splitting beside an occupied target when
the pointer lands on an edge.

### Mode-specific chrome

Turbo renders the same conversation surface as the default shell but must not
offer per-cell shell chrome. `ui-open-in-app` registers its Session-header split
button only while the mode is `active` and `default`. `ui-sidebar-right`
likewise registers its header toggle only in the default shell; Turbo has no
right-sidebar column, so the toggle would control a panel that is not mounted.
The gates live in the header contributions, not in the conversation entry.

### Window boundary

The Web client has no new-window plumbing: a different mode is a reload or a new
tab, which re-asks the chooser. There is no in-app mode switch, no persisted
mode, and no return path from Turbo to the default shell inside one page.

## Alternatives considered

**A sidebar Turbo button with a fixed exit rail.** Rejected: a mode is
per-window, so an in-app toggle contradicts the immutable choice and forces
every mode to carry an exit control.

**A fixed rows × columns grid with drag-resized tracks.** Rejected: it caps the
layout at a table and needs bespoke resize math. `react-mosaic` already provides
arbitrary splits, resize handles, and stable leaves.

**Reuse `ui-dockkit` as the tiling surface.** Rejected: its model is a binary
split tree with tab strips, not an n-ary tiling surface. It remains the choice
for the right sidebar's docking panel.

**Duplicate the global `SidebarRoot` per cell.** Rejected: the inject face drives
global actions and the body owns settings, the panel list, and the footer. Turbo
wants the one shared browser, so the frame passes the normal sidebar renderer
instead.

**A bespoke per-cell browser.** Rejected: it re-implements workspace grouping,
search, rows, and their dialogs. The shipped composition reuses the full
sidebar; a cell's Session assignment is independent of the sidebar's current
selection.

**Create a Session automatically for every new cell.** Rejected: a layout
action is not a session-creation action. Empty cells are a valid state and
creation stays explicit.

**A `main` panel key (`selectPanel('turbo')`).** Rejected: a main entry cannot
unmount the sidebar and right panel, and only the entry that declares
`main.conversation` may render it for several Sessions.

**Duplicate the conversation slot tree under a Turbo namespace.** Rejected: every
plugin that contributes a ChatView, composer control, or header seat would have
to register twice.

**Iframes or browser windows per chat.** Rejected: a second document duplicates
theme, connection, and Session state. The pinned seat is the supported way to
mount several Session subtrees side by side.

**CSS-only hide and show.** Rejected: the default shell stays mounted and
current-session-bound, and the tiling surface still needs an explicit binding
per cell.

## Consequences

Every load starts at the chooser. There is no in-app way back to the default
shell; changing modes means reloading or opening a new tab. The chooser is the
only global presentation that every mode inherits, and it carries no
mode-specific copy.

Turbo uses the shared full sidebar rather than a per-cell rail. A workspace
refresh, search, or rename is one source of truth; a cell only holds its own
Session binding and takes focus when that Session is current. The right panel
and the open-in-app action are absent in Turbo, because the mode has neither the
column nor the desktop-app chrome.

Tiling is dynamic and in memory: split, close, resize, drag a Session into a
cell, and create a blank Session with a cell. A reload returns to the chooser and
a fresh grid.

Client tests cover mode immutability, unregistered ids, fallback to `default`,
the Turbo tiling helpers, the shared sidebar pass-through, the default-only
header contributions, and Turbo's session-target policy. A browser pass over the
built client verifies the chooser, dynamic tiles, the shared overlay sidebar, the
filled split-drop preview, and the suppression of default-only header chrome.

## Related

- [Global main panels without default UI additions](../architecture/2026-09-08-global-main-panels.md)
  — the keyed `main` slot and its root-scoped selection.
- [Right Sidebar docking infrastructure](./2026-09-04-right-sidebar-docking-infrastructure.md)
  — the split-tree engine and the right column Turbo does not mount.
- [The left sidebar slides its rail-to-panel width](./2026-10-26-sidebar-rail-width-slide.md)
  — the overlay rail Turbo reuses through `renderSidebar`.
- [Swappable track order — IDE between sidebar and conversation](./2026-10-11-swappable-ide-chat-layout.md)
  — the frame's track-order precedent.
- [Turbo Mode walkthrough](./2026-10-28-turbo-mode-chat-grid.mock.html)
  — the earlier prototype illustration, superseded by the chooser and dynamic
tiling design above.
