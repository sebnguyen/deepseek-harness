# Agent Note: Checkpoint snapshots only committed write files

Status: implemented

## Problem

Checkpoint capture walked the session workspace after every tool dispatch and only then returned the tool result. On this repository that walk stats thousands of kept files, so bash, read, and write all waited on an inventory that does not change with the call. A larger tree makes the walk slower still. The bytes a `write` already holds — the prior text and the committed text — are the snapshot. The walk was re-reading the disk to discover them.

## Decision

`CheckpointService.captureWrite` stores the before and after strings the write tool passes and appends one `checkpoint/scan` row for that file, using the same content-addressed store and the same row fields. The write tool calls it from `runWriteProgram` after a real commit, for both the batch face and the legacy face. Capture does not stat the workspace, does not read the file back, and does not branch on whether the write created, replaced, or patched. A null `before` omits the before digest. A dry run and a failed element do not call it. A store failure appends no row and does not fail the write.

The service no longer listens on `tools/execute`. `pruneExtra` is gone with the walk. `src/scan.ts` remains exported and tested; capture does not call it.

## Alternatives considered

**Keep the dispatch-bracket walk and only persist the stat table.** A resumed process can skip unchanged reads, and the walk still runs on every call. The cost that blocked the tool result is the traversal, not the digest.

**Return the tool result before the walk finishes.** The call looks fast and the snapshot still inventories the tree. A large workspace still pays that inventory, and a later exclusive call can still queue behind it.

**Watch the process tree and hash only paths it wrote.** That would see shell edits. It needs a privileged helper, and it is a second engine beside bytes the write tool already has.

## Consequences

Bash, deletes, the `str_replace` editor, `checkpoint_restore`, and edits made outside the write tool leave no row. A timeline of write commits stays sparse and does not grow with the size of the tree. The row's `before` is whatever text the write held, including null when the backend declines a diff basis. The frontier file is no longer read or written by capture; the store still accepts one.

## Verification

`pnpm exec vitest run packages/fs/checkpoint` — 24 passed. `pnpm exec vitest run packages/fs/tool-fs` — 389 passed, and `packages/fs/tool-fs/src/write.ts` is at 100% lines. `pnpm exec tsc -b packages/fs/checkpoint packages/fs/tool-fs` passed. `gen-config-catalog`, `gen-persistence-catalog`, `gen-cordis-catalog`, and `gen-doc-graphs` were regenerated.
