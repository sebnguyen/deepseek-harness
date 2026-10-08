# Agent Note: File tool rows reveal their file in the explorer instead of jumping to the trajectory

Status: implemented

## Problem

A tool row whose call acted on a file carried the same Inspect chip as every other row, and that chip switched the main pane to the trajectory view. Readers who wanted the file the call read or wrote landed in the agent's internal ledger, while the explorer column that already shows the workspace sat unused beside the sidebar. The gesture people reached for on a file row and the gesture the chip performed were different ones, so the row spent its single chip affordance on the less useful of the two. Non-file rows have no file to point at; for them the trajectory jump remains the only sensible chip.

## Decision

A row that names a file shows an Open chip whose callback reveals the file in the session's explorer column; rows without a file, and compositions that do not mount ui-sidebar-files, keep the Inspect chip. The reveal expands the file's ancestor directories in the explorer tree, lists any level that has not loaded, re-lists the ones it has so a file created between the mount-time listing and the click still gets its row, scrolls the row into view, and holds a highlight on it for a moment; a path outside the session's workspace root is a visible no-op.

The two halves live in different packages that must not import each other at runtime, so ui-sidebar-files declares and provides a `sidebarFilesExtensions` Context service whose `revealIn(sessionId, path)` writes into a package-local channel, and the explorer column subscribes to the same channel. The chat view reads the service optionally (`ctx.get`), resolves the row's authored path against the viewed session's workspace root — batched writes carry their element paths workspace-relative — and threads `revealFile` through its owner props only when the service exists; the tool layer's `fileRowChip` picks the Open chip exactly when both a file path and a reveal callback are present, and falls back to the inspect callback otherwise. The tree store carries one added field, `highlighted`, written by reveal-dedicated actions that silently decline an unseeded tree, so a reveal can never create a bucket the column's `start` did not.

## Alternatives considered

**Route the reveal through `ISidebarRight`.** The sidebar's navigation face owns tab placement, not tree state; teaching it about directory levels would move the file tree's write set into a second package and make every tab type's store indirectly reachable from the navigation controller.

**Open the file in a sidebar tab instead.** That gesture already exists as the row's path-summary link; making the chip repeat it would give one row two controls with the same effect and still leave the explorer tree unpointed.

**Remove the trajectory jump entirely.** The trajectory view is the correct destination for non-file rows and for compositions without the explorer, so the inspect chip stays as the default and the reveal as the file-row refinement.

**A hard package dependency from ui-chat to ui-sidebar-files.** A synchronous runtime import between two dynamic client rows is forbidden by the client package gate; the optional service keeps the dependency type-only and the feature composition-gated.

## Consequences

File rows in the shipped composition no longer offer the trajectory jump from their chip; it remains on every non-file row, and the trajectory view keeps its own entries elsewhere in the product. The highlight is transient by design — a marker for the eye, not a current-file pointer — and the Known Limitations section of the ui-sidebar-files README says so. Compositions that omit ui-sidebar-files behave exactly as before, because `revealFile` is absent from the owner props and `fileRowChip` returns the inspect callback. The behavior is pinned by store and explorer-column specs for the reveal plus highlight expiry, tool-row specs for the chip swap, and a chat apply spec for the optional service.
