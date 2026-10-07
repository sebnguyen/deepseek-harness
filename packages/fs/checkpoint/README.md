---
description: "Workspace snapshot capture for the dsh host: per-call change rows, a content-addressed per-session store, and the restore surface a timeline view drives."
kind: "package-reference"
---

# @deepseek-ai/dsh-checkpoint

## Summary

`dsh-checkpoint` records what each tool call changed in a session's workspace and keeps the bytes needed to review or undo it. Every dispatch is bracketed by a pruned stat walk; the paths whose stat changed are read, stored by sha256 digest in a per-session content-addressed store, and appended to the session log as one `checkpoint/scan` row per file, attributed to the call that caused the change. Rows carry the previous and current digests, so a consumer can reconstruct a per-file timeline and diff any two adjacent stops without the log holding file contents. The service also exposes `blob` and `restore` over Typert and registers the model-facing `checkpoint_restore` tool. Choose it when sessions need an auditable, restorable record of workspace changes; skip it when only files inside a single tool call matter.

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

Mount the service where sessions should capture workspace snapshots. It requires `ctx.tools`, `ctx.fs`, `ctx.sandboxPolicy`, and `ctx.sessions`; the workspace root it walks is the resolved sandbox policy's root for the calling session, so capture follows the same boundary the file tools enforce.

```yaml
- name: '@deepseek-ai/dsh-checkpoint'
  config:
    enabled: true
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | none (required) | Whether capture and the restore surface are mounted |
| `dshHome` | `DSH_HOME` or `~/.dsh` | Override for the per-session store root |
| `pruneExtra` | `[]` | Extra directory names pruned from every walk |

Capture is observation, never policy: a failed walk or store write degrades to no event and never fails the tool call it was observing.

### Reading a timeline

Rows arrive as `checkpoint/scan` session events. A consumer joins `row.callId` with the session's `tool/call` events to recover the turn, step, purpose, and arguments of the change. `row.before` is absent on a path's first appearance and `row.after` is absent when the path left the workspace (deleted, or made unwritable). To render a diff, read the two digests with the `blob` Remote method; to undo a stop, call `restore`, or let the model call `checkpoint_restore`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **Bracket, not interception.** The service listens on the `tools/execute` waterfall, awaits `next()`, then rescans. Capture therefore sees the net effect of a call — including changes the call made through a subprocess — rather than declaring one in advance.
- **Stat first, digest second.** A walk collects `mtimeMs` and `size` per kept path; only added or changed paths are read and digested, so an unchanged dispatch costs one directory traversal and no file reads.
- **Content-addressed per session.** Objects live at `<dshHome>/checkpoints/v1/<sessionId>/objects/<xx>/<hex>` (0700 directories, 0600 files) and a put of existing content is a stat-only no-op. A `frontier.json` beside them records `path → digest`, so a process that resumes a session still derives truthful `before` digests without rereading the session log.
- **Rows are the log's record; bytes are the store's.** The session log carries paths and digests only, which keeps replay cheap and lets a deployment prune objects without corrupting history.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `CheckpointService`, config schema, dispatch bracket, restore tool, Remote methods |
| [`src/store.ts`](src/store.ts) | Content-addressed store: `digestOf`, `put`, `read`, `has`, frontier persistence |
| [`src/scan.ts`](src/scan.ts) | Pruned workspace walk, `SimpleIgnoreMatcher`, stat diff |
| [`src/types.ts`](src/types.ts) | `CheckpointRow`, `SnapshotDigest`, the `checkpoint/scan` event declaration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [File-history view](../../client/ui-file-history/README.md) — the Web tab that renders stops, diffs, and purposes from these rows.
- [Workspace snapshot design note](../../../.agents/notes/proposed/feature/2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.md) — the capture model, attribution limits, and alternatives considered.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — the workspace root and mode this service resolves per session.

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

- **Text content only** — a path read as text is stored; a file that cannot be read as UTF-8 text is recorded by digest with no retained content, and `blob` answers `null` for it.
- **Scan-after-call attribution** — a change made outside a tool call (an editor, a background process) is attributed to the next call that runs. No row can name a cause the harness never saw.
- **Stat-based change detection** — `mtimeMs` and `size` decide what to reread, so a same-size rewrite within one filesystem timestamp granularity can be missed.
- **Partial ignore support** — `.gitignore` handling covers directory names, rooted paths, `*.suffix`, and bare basenames; negation, globs, and nested ignore files are not honored. `.git`, `node_modules`, and `.dsh` are always pruned.
- **No pruning policy** — objects are retained for the life of the session directory; nothing reclaims them.
- **One walk per dispatch** — a session with a very large workspace pays a traversal per tool call.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Open directions: a retention policy for object pruning, richer `.gitignore` support, and binary content kept as base64 with a size ceiling.

</details>
