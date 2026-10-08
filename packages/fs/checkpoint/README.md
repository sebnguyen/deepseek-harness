---
description: "Workspace snapshot capture for the dsh host: per-call change rows, a content-addressed per-session store, and the restore surface a timeline view drives."
kind: "package-reference"
---

# @deepseek-ai/dsh-checkpoint

## Summary

`dsh-checkpoint` records each file a committed `write` hands it and keeps the bytes needed to review or undo that write. The write tool already holds the file's before and after text; capture stores those two strings by sha256 digest and appends one `checkpoint/scan` row for the file, attributed to the call. Rows carry the previous and current digests, so a consumer can reconstruct a per-file timeline and diff any two adjacent stops without the log holding file contents. Beside the rows the service owns the slot register: one append-only, undeletable row family per session keyed by file, which producers (the worktree capture, or any plugin over the `slotPut` Remote) write and clients read as a file-to-slot-array map. The service also exposes `blob` and `restore` over Typert and registers the model-facing `checkpoint_restore` tool. Choose it when sessions need a restorable record of write-tool commits; skip it when shell edits and deletes must appear in the same timeline.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service where sessions should capture write-tool commits. It requires `ctx.tools`, `ctx.fs`, `ctx.sandboxPolicy`, and `ctx.sessions`. The `write` tool calls `captureWrite` with the path and the before/after text it already holds; capture does not read the workspace.

```yaml
- name: '@deepseek-ai/dsh-checkpoint'
  config:
    enabled: true
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | none (required) | Whether capture, the register, and the restore surface are mounted |
| `dshHome` | `DSH_HOME` or `~/.dsh` | Override for the per-session store root |
| `maxLabelBytes` | none (required) | Byte bound of one register slot's label |
| `maxRetainedBytes` | none (required) | Byte bound of one register slot's retained text |

Capture is observation, never policy: a failed store write degrades to no event and never fails the write it was observing. A dry run and a failed write element are not recorded. Register puts take the opposite posture: a `putSlot` whose label or retained text exceeds its bound, or whose id already has a row, rejects its caller.

### Reading a timeline

Rows arrive as `checkpoint/scan` session events, one row per committed write file. A consumer joins `row.callId` with the session's `tool/call` events to recover the turn, step, purpose, and arguments of the change. `row.before` is absent when the write supplied no prior text. To render a diff, read the two digests with the `blob` Remote method; to undo a stop, call `restore`, or let the model call `checkpoint_restore`.

### The slot register

Every session holds one `slots.jsonl` under the store root: an append-only record of slot puts and release tombstones. Worktree slots ride `captureWrite` with their `slotId` equal to the call id, so the shipped `@path#turn#call-id` grammar resolves by filtering the register; producer plugins mint their own ids and payloads through the `slotPut` Remote and the declaration-merged `CheckpointSlotDetailMap`. The `slots` Remote returns the live map — file to slot array, tombstones folded to absent — with no session event involved, so register state survives restarts and reaches a second client regardless of the log. Releasing a slot appends a tombstone; no method removes or rewrites a row, so a mention that already serialized keeps resolving.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **Before and after, not a walk.** `captureWrite` stores the two strings the write tool passes and appends one row. It does not stat the workspace, and it does not interpret whether the write created, replaced, or patched the file.
- **Content-addressed per session.** Objects live at `<dshHome>/checkpoints/v1/<sessionId>/objects/<xx>/<hex>` (0700 directories, 0600 files) and a put of existing content is a stat-only no-op.
- **Rows are the log's record; bytes are the store's.** The session log carries paths and digests only, which keeps replay cheap and lets a deployment prune objects without corrupting history.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `CheckpointService`, `captureWrite`, config schema, restore tool, Remote methods |
| [`src/store.ts`](src/store.ts) | Content-addressed store: `digestOf`, `put`, `read`, `has`, frontier persistence |
| [`src/scan.ts`](src/scan.ts) | Pruned workspace walk, `SimpleIgnoreMatcher`, stat diff. Capture does not call it |
| [`src/types.ts`](src/types.ts) | `CheckpointRow`, `SnapshotDigest`, the slot vocabulary, the `checkpoint/scan` event declaration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [File-history view](../../client/ui-file-history/README.md) — the Web tab that renders stops, diffs, and purposes from these rows.
- [Workspace snapshot design note](../../../.agents/notes/proposed/feature/2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.md) — the capture model, attribution limits, and alternatives considered.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — the mode a restore write goes through, the same path a file tool uses.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace restore

#### What the model sees

Capture adds no model context: `checkpoint/scan` is log-only. The one model-facing surface is the `checkpoint_restore` tool, which appears with the deployment's other tools and takes a workspace-relative `path` plus a `digest` a previous stop recorded.

#### Token effect

A capture row costs no tokens. `checkpoint_restore` contributes its schema to every request that offers it and returns one short text line per call.

#### KV Cache effect

None on its own. The tool's schema participates in the stable prefix like every other tool; capture events never enter a request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Write commits only** — bash, deletes, `str_replace` editor writes, restores, and edits made outside the write tool leave no row.
- **Text the write already holds** — capture stores `before` and `after` as UTF-8 strings. When `before` is null, the row omits the before digest. `blob` answers `null` for a digest the store does not have.
- **No pruning policy** — objects and register rows are retained for the life of the session directory; nothing reclaims them, including released slots, by the undeletable invariant.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Open directions: a retention policy for object pruning, and recording deletes or shell edits without walking the workspace.

</details>
