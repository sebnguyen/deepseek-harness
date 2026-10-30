# Agent Note: The turn chip row opens only on a click

Status: implemented

## Problem

The turn-tail chip row launched a file on its own. A row mounted for a turn that had closed within the previous ten seconds armed itself once and called the shared `openFile` seam for its first changed-file chip, with no pointer gesture behind it. The default shell absorbed that into a Sidebar tab, so it read as convenience. An alternate shell has no Sidebar column: the same seam takes its Host-desktop branch ([Turbo file opens use the Host desktop](../feature/2026-10-29-turbo-file-open-host-desktop.md)), so a desktop application launched itself right after a turn finished — including a turn whose visible point was presenting an already-written file. The row lists the turn's files; opening one is a reader's gesture, not a side effect of the row mounting.

## Decision

`TurnChipRow` renders chips and opens a file only on click. The `AUTO_OPEN_WINDOW_MS` window, the armed ref, and the effect's launch block are deleted; the row no longer reads `turn.status` or `turn.end`. Click-through keeps its destinations: a worktree chip opens the frozen Changes stop it names, and a note chip opens its noted line.

## Alternatives considered

**Keep the auto-open in the default shell and gate it on the pinned layout mode.** This preserves the in-product behavior where a Sidebar exists and suppresses only the desktop launch. Rejected: the open still happens without a gesture, and the row would need the shell mode, or an origin flag on `OpenFileOptions`, to know which destination it feeds. The behavior does not carry that machinery.

**Shorten the recency window.** A smaller window changes when the unattended open happens, not whether it does, and keeps the timer, the armed ref, and the replay-versus-live distinction the window exists to draw.

**Move the auto-open to declared deliveries only.** Presented-file cards are already click-only, so this would add a second unattended-open rule to the surface that needs one least.

## Consequences

- No file opens from the chip row without a click; the frozen-Changes stop and the noted line still open on click.
- Default-shell readers lose the automatic first-file open after a turn. The chip remains and reaches the same destination, one gesture later.
- Turbo no longer launches a Host desktop application when a turn closes.
- The row's behavior no longer depends on turn timing, so replayed history and live turns render identically.

## Testing

- `pnpm exec vitest run packages/client/ui-chat/tests/turn-chip-row.client.spec.tsx` — the row renders chips for a freshly closed turn and opens nothing until a chip is clicked.
- `pnpm exec tsc -b packages/client/ui-chat/tsconfig.json`.
- `pnpm exec tsx scripts/run-oxlint.ts --config .oxlintrc.json` on the touched source and spec.
