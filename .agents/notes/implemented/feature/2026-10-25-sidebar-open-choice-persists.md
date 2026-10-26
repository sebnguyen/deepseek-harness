# Agent Note: the right-sidebar open choice survives a reload

Status: implemented

## Problem

The header toggle collapses and expands the right column, but the surface is memory-only: a reload reseeded every session expanded, with the VS Code twin auto-opening its page. Closing the column and reloading therefore forgot the choice, and the toggle read as the close action again. The user asked for the open/closed choice to be persisted like the composer's mid-typed drafts, which survive a reload per session.

## Decision

The choice is a field in a root-scoped `defineStore` with `persist: 'dsh.sidebar-right.choice.v1'` (`src/client/choice.ts`). Its state is `{ bySession: Record<SessionId, boolean> }`; a missing entry means the open default. It is separate from the surface store: only the open/closed bit survives a reload, while tabs, panes, and history remain memory-only. The store is created once in the plugin body, not per session, because the slot runtime mints one surface store per session and the choice map must be shared across them.

Adoption seeds the surface at the remembered choice before adoption listeners run, and the panel seat's own `open(sessionId, readExpandedChoice())` is the fallback when no adoption seeded it. The seat writes `shown` back on every change. Writing on every change also records the capacity collapse and the last-docked-tab close, so the remembered choice matches the last state the user saw rather than only the header toggle's clicks. The choice never enters the layout or the session log.

Adoption listeners run synchronously when a store is adopted, and the VS Code twin uses that hook to open its page. `openContent` seats and focuses the tab without touching the column's expanded state; expanding is only the header toggle's `setExpanded`. The choice is therefore the final condition of every open attempt rather than a correction applied after one: the twin's page is seated, and a remembered close keeps the column closed until the user opens it.

## Alternatives considered

- **Persist the whole sidebar store.** Adding `persist` to the surface store would restore tabs, panes, and history too, reversing the documented memory-only rule and the reload behavior the e2e suite pins. The request was the choice, not the surface.
- **Store it in the per-session Conversation store next to `draft`.** Drafts are the pattern the user pointed at, but the Conversation store belongs to `ui-conversation`; putting sidebar presentation in it would invert ownership for one boolean.
- **Keep the choice in the header toggle's localStorage.** The toggle is not mounted when the panel is hidden (no session or a global panel), and the panel seat is the component that knows when the surface is materialized and changes; the store belongs with the surface, not the button.
- **One global choice.** The user chose per session: closing the column in one session must not close it in every other session.
- **Apply the choice after adoption.** The first version collapsed the column again once adoption listeners finished. That is an applier, not a gate: the automatic open happens and is then corrected, the correction records a close in history, and every new open path has to remember to re-apply it. Seeding the surface and leaving `openContent` unable to expand puts the gate where every open already ends.

## Consequences

- A reload restores each session's open/closed choice; tabs, panes, and history still reset to the default page.
- Switching sessions keeps each session's remembered choice, and a session reopened later starts the way it was left.
- Capacity collapse, the last-docked-tab close, and the fullscreen panel's close all update the remembered choice because the seat writes every `shown` change.
- The VS Code twin still seats its page on adoption; with a remembered close the page is present but the column stays closed, so expanding shows the twin directly.
- Automatic and content opens never expand a collapsed column; they seat their tab so it is ready when the user expands. A resource opened while the column is closed does not bring the column back on its own.
- The map keeps an entry per session id; a deleted session leaves a small stale boolean in browser storage. The entry is inert and is overwritten if the id is reused.
- No slot-catalog change: the store and the injected face are package-internal.

## Testing

`packages/client/ui-sidebar-right/tests/choice.client.spec.ts` covers the persisted per-session map and clearing it, `seat.client.spec.tsx` mounts a session whose remembered choice is closed, checks the seat writes later changes back, and mounts against the real layout store with a stale track open to assert the close clears it; `apply.client.spec.ts` pins the per-session injected readers and an adoption listener that opens its page while the remembered choice is closed. The Web e2e reload case closes the column, reloads, and asserts the close survives before reopening the page the twin seated while the column was closed.
