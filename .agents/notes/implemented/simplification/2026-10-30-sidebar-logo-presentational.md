# Agent Note: Sidebar brand row is presentational

Status: implemented

## Problem

The sidebar's brand row was an interactive control whose action changed with the fold. Expanded, clicking the logo started a new session even though the column already renders a dedicated New Session capsule directly below it; collapsed, the same mark was the only control that pinned the 56px rail open. A logo that starts a session or expands navigation is an invisible, state-dependent action attached to branding, and the same mark carried two meanings across one fold transition.

## Decision

The brand row is presentational in both folds. `SidebarRoot` renders `sidebar.brand.mark`, `sidebar.brand.name`, and the rail mark as non-interactive elements: no click handler, no button role or accessible action name, no pointer cursor, and no hover fill. The New Session capsule stays the single New Session control in both states. The collapsed rail no longer pins the panel open; its hover preview is the way to reveal the sidebar at narrow widths.

## Alternatives considered

**Keep the collapsed rail mark as the expand control.** The rail mark is the only pin-open affordance, so removing it leaves narrow frames with a hover-only preview. Rejected because the request treats the logo as a logo in every state, and the same mark acting differently by fold was the confusing part.

**Keep the expanded New Session shortcut and remove only the rail toggle.** Rejected for the same reason: the brand would still act in one state, and the expanded shortcut duplicated the capsule that sits directly below it.

**Add a separate non-logo expand control in the rail.** A larger change with new UI, copy, and tests. It is not needed to satisfy "the logo has no behavior" and can be decided separately if the hover-only preview proves insufficient.

## Consequences

- Clicking the wordmark no longer starts a session, and clicking the rail mark no longer pins the sidebar open.
- Narrow frames reveal the sidebar only through the hover preview; there is no persistent open control in the rail, though hovering still opens the panel while the pointer or focus stays inside the column.
- The mark leaves the tab order, and screen readers no longer announce it as an action. The brand identity stays `aria-hidden`, as before.
- The DOM snapshots, unit tests, README, and the narrow-frame e2e setup move with the behavior: e2e now reveals the rail with `hover()` before reading the browsing region.
