---
description: "Workspace snapshot timeline for the dsh web client: per-file stops with their diff, stated purpose, and restore action."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-file-history

## Summary

The Files tab turns a session's checkpoint rows into a workspace timeline. Pick a file to see every stop at which a tool call changed it, scrub the slider to any stop, and read the diff between the bytes before and after that call together with the purpose the caller stated. A zoom control switches the slider between per-call granularity and one stop per turn, and a restore action writes a stop's captured bytes back through the host filesystem capability. It is a pure consumer: it registers one conversation view and reads the session log plus the checkpoint Remote, and it owns no service of its own.

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

Load the plugin in a browser composition that already serves the session log and the checkpoint Remote; it contributes the `Files` tab to the conversation view ring next to Chat and Trajectory.

```yaml
- name: '@deepseek-ai/dsh-client-ui-file-history'
```

The tab lists every file the session changed, newest stop first in the slider, and selects the first file automatically. Selecting another file moves the slider to that file's newest stop, because the newest state is what a reader usually wants first. While the session runs, new stops appear as the tool calls that caused them land, and the diffs load their content through the checkpoint `blob` method on demand so the view holds only the stop it displays.

### Reading a stop

Each stop names the tool that ran, the turn and step it belonged to when the call was logged, and the purpose the caller stated — or an explicit "no stated purpose" when the call recorded none. The diff shows the file before and after that call: a stop with no prior digest is the file's creation, and a stop with no after digest is its deletion. Restoring writes that stop's bytes back to the workspace, so a later stop in the same file will show the restoration as another change.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **Fold in the view, not the host.** The plugin folds the session's own event window into per-file stops and joins each row to its `tool/call` event by `callId` for turn, step, and purpose. Nothing new is logged, and a resumed session renders its whole timeline from replay.
- **Per-revision memoization.** The fold is cached per binding and recomputed only when the event window's revision changes, so streaming re-renders cost the events since the last fold rather than the whole window.
- **Remote for bytes only.** Rows and purposes ride the session log; only retained file content crosses the checkpoint `blob`/`restore` Remote methods, and a pruned object renders as an empty side with the stop still visible.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: slot registration, hook provision, locale dictionary, Remote bindings |
| [`src/client/fold.ts`](src/client/fold.ts) | Row-to-call join, per-file stop lists, turn-granularity grouping |
| [`src/client/FileHistoryView.tsx`](src/client/FileHistoryView.tsx) | The Files tab: file list, zoom control, stop slider, diff, restore |
| [`src/client/locales.ts`](src/client/locales.ts) | The `fileHistory` dictionary for every string the tab renders |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Checkpoint capture](../../fs/checkpoint/README.md) — the host service that produces the rows, digests, and restore surface this tab renders.
- [Conversation view slot](../ui-conversation/README.md) — the view registry this plugin contributes to.
- [Diff primitive](../ui-primitives/README.md) — the `DiffBlock` component the tab renders through.

-----

<a id="model-experience"></a>
## Model Experience

This package adds no model-visible input. It renders rows the host already logged, and its restore action uses the same filesystem write path as the `checkpoint_restore` tool without adding or changing tool schemas, prompts, or context sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No content for unreadable objects** — a stop whose content was never retained (binary files, pruned objects) renders an empty diff side with the digests still shown.
- **Text diffs only** — the diff primitive compares text; the tab does not render a binary or image comparison.
- **One restoration at a time** — restore writes a single file stop; restoring a whole turn or a whole workspace is not offered.
- **Workspace-relative paths as logged** — the tab displays the paths the host recorded and does not resolve them against a differently-rooted workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Open directions: multi-file restore for one stop group, a side-by-side diff mode, and following the workspace live while a turn is running.

</details>
