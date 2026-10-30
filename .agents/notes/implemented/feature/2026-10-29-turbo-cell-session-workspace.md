# Agent Note: Turbo's cell New Session inherits the sidebar default Workspace

Status: implemented

## Problem

A Session started from an empty Turbo cell called the mode's bare `createSession` with no target, so `createTarget` resolved no Workspace and the host created the Session at `defaultCwd` without attaching it. The blank Session therefore rendered the hero's **Choose workspace** placeholder; picking one created or reused a second Session, and Turbo's blank-append effect appended a cell for it. The sidebar New Session already resolved the current Session's Workspace, otherwise the most recently used one, and created its Session attached there.

## Decision

`UiWorkspace.defaultWorkspaceId()` owns the sidebar's workspace resolution: the current Session's Workspace, otherwise the most recently used Workspace once both baselines are ready. `startSession` uses it for its default target, and `ui-turbo` passes it as the last argument to `createTarget`, after an explicit Workspace, the source Session's owning Workspace, and an explicit directory. A Turbo-created Session therefore lands in the same Workspace the sidebar New Session would choose, and the hero shows that Workspace instead of prompting.

## Alternatives considered

**Pass the ambient Session as a source in `newSessionForCell`.** It fixes a split from a populated cell but misses the all-cells-closed zero state, where the Session list has no current entry and only recency can name the Workspace.

**Resolve the default inside `ui-turbo`.** Rejected: `recentWorkspace` and the current-Session lookup already live in `ui-workspace`; a second copy would split one policy across two packages.

**Reuse `connectWorkspace`'s blank Session for the cell action.** Rejected here: the returned blank can already be displayed in another cell, so assigning it to a second cell would duplicate a Session. A cell's New Session still creates a distinct Session; only its Workspace changed.

## Consequences

An empty cell or the zero-state New Session now starts in the current or most recent Workspace, so the common flow no longer produces an unattached blank Session plus a second Session and cell. A deliberate Workspace change in the hero still creates another Session; choosing which empty cell, if any, should adopt it remains a separate concern.

## Testing

`packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` covers the current-Session lookup, the recency fallback, and the not-ready result. `packages/client/ui-turbo/tests/contract.client.spec.ts` covers the fallback and the targets that precede it. The focused client suites run under `pnpm run test:gui`.

## Related

- [Turbo mode — a per-window layout choice and a chat-cell grid](./2026-10-28-turbo-mode-chat-grid.md)
- [Turbo rebalances a split from a button on its border](./2026-10-29-turbo-split-rebalance.md)
