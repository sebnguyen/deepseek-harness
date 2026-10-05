---
description: "CodeMirror 6 file editor as a right-Sidebar tab type: open, edit, and save Session files with version-conflict safety"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-editor

## Summary

Registers `editor`, a right-Sidebar tab type that claims Session-scoped file addresses ahead of the read-only text preview. The body mounts one CodeMirror 6 view per tab over a complete `workspaceFiles.readAll`, binds Mod-S (and the footer Save button) to `workspaceFiles.write` under the loaded version, and treats a stale refusal as a conflict banner offering reload or overwrite. Markdown files additionally open on a rendered display of the buffer through the shared `MarkdownText` primitive, with a footer control swapping between the rendered page and the source editor. Metadata through `useResource<'file'>` announces an externally changed file while the buffer is dirty, and the CodeMirror theme and token colors ride the product's `--dsw-*` design tokens in both appearances.

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

List the package in the web bundle's browser plugin roster; it needs `slots`, `locale`, `sidebarRightTabs`, `remote`, and `remote.workspaceFiles`. Opening any `dsh-resource://file/session/<sessionId>/<path>` address then claims the `editor` kind at the `builtin` band, one tab per address, titled by the decoded basename. A session whose sandbox policy is read-only still opens files for editing, and every save fails `workspace-file/read-only` with the reason on the banner.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The type reaches the Sidebar through its public path only: the definition into `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat under the definition's id, and its copy into the `editor` locale namespace. Content and saves are the type's own business; the standard `file` resource carries metadata alone, exactly as in the text preview. The view is recreated per loaded generation, so reloads and conflict resolutions never patch a live buffer. Grammars are a fixed first-party set (TypeScript/JavaScript, JSON, Markdown, Python) chosen by file suffix; everything else edits as plain text. For the Markdown suffixes the body offers two display modes: the rendered page (the default, drawn by `MarkdownText` over the current buffer, saved or not) and the source editor; leaving the source display commits the live buffer into the document generation so unsaved edits survive the swap, and a save from the rendered page writes that committed generation.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: type definition, dictionaries, and keyed body registration |
| [`src/client/definition.ts`](src/client/definition.ts) | The `editor` tab type: id, band, claimable addresses, chip title |
| [`src/client/EditorBody.tsx`](src/client/EditorBody.tsx) | The tab body: load, display modes, CodeMirror view lifecycle, save, conflict banner, status row |
| [`src/client/editor.ts`](src/client/editor.ts) | The CodeMirror extension assembly: base editing, grammars, the Mod-S binding, the token theme and highlight style |
| [`src/client/rpc.ts`](src/client/rpc.ts) | The Remote slice, address decoding, byte decoding, and failure-line copy mapping |
| [`src/client/locales.ts`](src/client/locales.ts) | The `editor` zh/en dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Editor foundation note](../../../.agents/notes/proposed/architecture/2026-10-05-web-workbench-editor-foundation.md) — the decision, seams, and milestone order this package begins.
- [Right Sidebar subsystem](../../../docs/subsystems/sidebar-right.md) — the tab-type registry and the shipped `text` preview this type outranks.
- [Workspace files](../../api/workspace-files/README.md) — the `write` operation and its failure codes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the editor is a browser-only surface that registers no tool, prompt section, or session event.

#### KV Cache effect

No direct effect; what the user edits here never enters a model request until a later milestone pipes gathered comments into a prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One complete load.** The editor reads `readAll`, so files above the Host's `maxFileBytes` fail instead of paging; the read-only preview remains their viewer.
- **Fixed grammar set.** TypeScript/JavaScript, JSON, Markdown, and Python highlight; other extensions edit as plain text until the set grows.
- **No LSP yet.** Diagnostics, completion, and navigation arrive with the `lspRelay` milestone; the editor transports nothing today.
- **External edits are announced, not merged.** The freshness banner reports the moved version; the buffer reloads and overwrites, it never merges.
- **The rendered Markdown display is display-only.** It renders the buffer with the shared primitive prose, without the read-only preview's file-mention links or viewer menu; those stay with the `text` preview type.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The buffer, its loaded version, and its dirty flag live inside one React component's state; there is no independent runtime source to compare against, and registration disposal is covered by behavior tests.
