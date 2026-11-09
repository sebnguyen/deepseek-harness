# ui-orchestration

Registers the **Orchestration** choice card and keyed shell mode into
`ui-layout-mode`. The mode is a projection over existing Session state, not a
second agent runtime.

## What it shows

- the shared `SidebarRoot`, rendered through the frame's `renderSidebar` owner
  prop;
- two pinned Sessions in fixed panes. Selecting a child Session projects its
  parent beside it; selecting a root projects its first direct child; without a
  child the second pane falls back to the next listed Session;
- the normal keyed `main.conversation` surface inside each pane through
  `PinnedSessionProvider`, with both bindings retained while mounted;
- a handoff rail between the panes that lists direct subagent children, their
  mode and activity, and whether the pair is a direct parent/child relation;
- a compact header per pane with title, root/child identity, and running state.

The mode exposes the existing parent/child relation rather than inventing a
peer identity. A handoff still originates from the established subagent or
session flows; this package only projects the resulting Sessions and catalog.

## Model Experience

No model-facing behavior. The mode mounts the shipped conversation surface per
pane and reads the existing `useSessions` list and `subagentsByParent` catalog.

## No invariant

This is a browser presentation plugin; it has no host-plane or independent
runtime relationship to publish an invariant for.
