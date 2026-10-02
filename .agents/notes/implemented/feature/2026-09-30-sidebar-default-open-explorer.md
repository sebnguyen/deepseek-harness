# Agent Note: The right Sidebar opens by default and carries a persistent explorer column

Status: implemented

## Problem

The right Sidebar started collapsed behind a conversation-header button, and its file tree lived only in the `files` page tab. Reaching a workspace's files therefore took two gestures every session — open the panel, then open Files — and an opened preview sat beside the tree only while the Files tab stayed open: opening a file from the tree added a tab that competed with the very navigator that opened it. The collapsed default also meant the panel's content was invisible until a user discovered the header button.

## Decision

A session's docking surface starts expanded with the default page already seated, and the panel draws a persistent explorer column on its left edge, beside the docked panes, for as long as it is shown. `ui-sidebar-files` owns the column.

- `createSurface(seed)` builds the kit's initial state, expands it, and settles the default page into it before any history: the seed is part of the initial state, not a recorded intent, so undo cannot step before an empty column and no first expansion is needed to see content. A reload therefore returns every session open on the default page.
- The default page is the guide regardless of how many guide entries are registered. The explorer column takes over the tree the single-entry shortcut used to open directly, so an emptied pane returns to the guide's overview rather than to a second tree; `defaultSeed` no longer counts entries.
- `sidebar.right.explorer` (single, session scope) is declared by the `rightbar.session` seat and rendered inside the panel body; without a registrant the outlet stays empty and the panes keep the whole panel width, so the column is an extension point as well as the shipped tree's home. `ui-sidebar-files` registers its `ExplorerBody` there over the type's tree store, keyed by the session id instead of a tab id — the store's `byTab` map becomes `byTree` of `TreeKey` — and its file rows open through `ctx.sidebarRight.openResource` into the panes; the Files tab keeps its tab-keyed bucket and opens through its own pane, and both draw the shared rows from `Tree.tsx`.

## Alternatives considered

**Seeding the Files page as the default tab.** The old single-entry rule did this; it made the tree the first tab but kept it a tab — an opened file still replaced or crowded the navigator, the exact gap above.

**Auto-splitting a tree pane on open.** Puts layout machinery behind every file open, and the resulting pane is still closable, so the tree disappears again.

**Auto-add on every resource open.** Sprinkling a conditional `openContent('files')` through `openContent` would have coupled the navigation controller to one tab type. The column lets `ui-sidebar-right` stay ignorant of what lives in it, via a seat.

## Consequences

- Collapse becomes purely a user gesture; the header's expand button exists only after the user collapses. Seat, service, store, and the shipped e2e specs assert the open initial state and were re-baselined (the document-preview golden included).
- The Files page type, guide entry, and its keyed seats stay, unchanged in registry shape; the tab is now an optional second view of a tree that is always available beside the panes.
- `sidebar.right.explorer` gives the panel a fifth seat; the type-side package injects `sidebarRight` for the column's opener, the first value edge `ui-sidebar-files` takes on `ui-sidebar-right` (informational per the module graph).
- Undo history starts after the seed, matching "the history starts with the user's first intent"; closing the docked surface's last tab still collapses and empties it, and the next expansion reseeds.
