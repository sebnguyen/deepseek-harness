---
description: "Workspace snapshot timeline for the dsh web client: the useFileHistory hook projecting the checkpoint slot register onto per-file stops."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-file-history

## Summary

The package provides the `useFileHistory` selector hook, which projects the checkpoint slot register onto per-file stop timelines: every file the session changed, sorted by path, each stop naming the tool that ran, the turn it belonged to, and the before/after content digests. The Files conversation view that rendered that timeline with its slider, diff, and restore action is retired; the surviving surfaces — the editor's Changes cycler and change markers — read the register through the hook instead. It is a pure consumer: it reads the session binding and the checkpoint Remote, and it owns no service of its own.

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

Load the plugin in a browser composition that already serves the session log and the checkpoint Remote; it adds `useFileHistory` to the session's standard hook props beside `useResource` and the input hooks.

```yaml
- name: '@deepseek-ai/dsh-client-ui-file-history'
```

The hook selects over the current session's timeline and re-fetches the register whenever the session binding's revision bumps, so new stops appear as the tool calls that caused them land. Stops carry only digests; consumers that render content resolve them through the checkpoint `blob` Remote on demand.

### Reading a stop

Each stop names the tool that ran through the slot's `detail.toolName`, the turn the producer scoped, and the call's stated purpose when one rode the detail or the pre-detail label, and carries the before/after digests of the write it records: a stop with no prior digest is the file's creation, and a stop with no after digest is its deletion. Consecutive writes of one file whose digests chain — each `before` the previous `after` — fold into the single stop the burst ended at, quoting from the burst's first before to its last after, so callers see one change per uninterrupted run of writes. Restoring a stop's bytes back to the workspace rides the checkpoint `restore` Remote, so a later stop in the same file shows the restoration as another change.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **Projection over the register, not the log.** The fold maps `remote.checkpoint.slots` per-file timelines onto `FileStop`-compatible timelines, keeping only `worktree` slots; tombstones are already folded to absent by the Remote, so a cold open and a second client of the session render identically without any session event.
- **Per-revision memoization.** One store is memoized per binding and re-keys on the event window's revision plus the working directory; a key change kicks the register fetch, and a settled fetch bumps the store's listeners, so streamed re-renders never re-fetch a key that already moved.
- **Remote for the register and bytes.** Slot rows ride the checkpoint `slots` Remote; only retained file content crosses the `blob`/`restore` Remote methods, resolved by consumers such as the editor's Changes surface.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: hook provision, per-binding store memoization, Remote bindings |
| [`src/client/fold.ts`](src/client/fold.ts) | Register-to-stop projection, per-file stop lists, turn-granularity grouping |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Checkpoint capture](../../fs/checkpoint/README.md) — the host service that owns the slot register, the content store, and the restore surface the hook projects.
- [Session standard props](../ui-slots/README.md) — the hook prop table the `useFileHistory` merge extends.

-----

<a id="model-experience"></a>
## Model Experience

This package adds no model-visible input. It renders rows the host already recorded in the register, and the restore action consumers drive uses the same filesystem write path as the `checkpoint_restore` tool without adding or changing tool schemas, prompts, or context sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No content for unreadable objects** — a stop whose content was never retained (binary files, pruned objects) resolves to null through `blob` with the digests still shown.
- **Text diffs only** — the diff primitive consumers render compares text; no binary or image comparison is offered.
- **Staleness bounded by the revision bump** — register changes reach the hook when the session binding's revision bumps, so a write storm between bumps surfaces at the next bump.
- **Workspace-relative paths as logged** — the projection relativizes paths against the session working directory and does not resolve them against a differently-rooted workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Open directions: retire the `stops` Remote once the last consumer reads the register, and fold `groupStopsByTurn` into the register-side query if the cycler is its only remaining caller.

</details>
