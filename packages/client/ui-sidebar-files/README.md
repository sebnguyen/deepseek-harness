---
description: "The right Sidebar's workspace file tree for the dsh web client: a persistent explorer column beside the tabs plus the files tab type, listing the session workspace one level at a time over the wire and opening files into the Sidebar by resource address."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

## Summary

The right Sidebar's navigator: the session's workspace root as a tree, listed one level at a time over the wire, opening files into the Sidebar. It is drawn twice — as the panel's persistent explorer column, always beside the tabs, and as the `files` page type. The page type claims no address and is reached from the guide; both draw the same rows, and both open files by address for the `dsh-resource://file` viewers to claim — nothing in `ui-sidebar-right` knows this package.

## Table of Contents

- [What it registers](#what-it-registers)
- [The tree](#the-tree)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `files`, id `@deepseek-ai/dsh-client-ui-sidebar-files`, band `builtin`, no patterns, and one guide entry (order 10, its title and description from the `sidebarFiles` namespace, its glyph the shared folder icon) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: a header row under the strip, then the tree. The header row is the document preview's (`ui-sidebar-documentpreview`): the root path, its directories greyed and its last segment in full ink, never ellipsized (a path wider than the row keeps its end and fades its start), with the one control, reload, at its right. The row is copied rather than shared because a plugin bundle shares runtime code only through the platform modules; once the artifact and slot surfaces settle, one copy in `ui-primitives` could serve every pane header.
- **The chip title** — the keyed `sidebar.right.pane.tab.title` seat under that id: a shared `FileTypeIcon` folder glyph at 16px before the type's label. The tree's own rows never draw this sheet.
- **The explorer column** — the sidebar's `sidebar.right.explorer` seat: the same rows, compacted, under a header with the root's last segment and the reload control. It is the panel's persistent navigator, so a file can be opened without first opening the files page; its rows open through `ctx.sidebarRight.openResource`, and its tree shares the tab type's store, bucketed by the session id instead of a tab id.
- **The reveal face** — `ctx.reflect.provide('sidebarFilesExtensions', ...)`: `revealIn(sessionId, path)` asks the session's explorer column to expand the path's ancestor directories, list any level it has not loaded, and highlight the file's row for a moment, scrolling it into view. Rows reveal through the chat view's `revealFile`, which the composition omits without this package, leaving their Inspect chip in place. A path outside the session's workspace root, a request for a session whose column is not mounted, and every request while the column is absent are no-ops.

Ten source files under `src/client/`: `definition.tsx` (the type), `store.ts` (what it keeps), `face.ts` (how it lists, Remote binding included), `reveal.ts` (the reveal channel and the `sidebarFilesExtensions` contract), `Tree.tsx` (the shared rows, with the ordering and failure-line helpers), `FilesBody.tsx` (the tab's chrome), `FilesTitle.tsx` (the chip title), `ExplorerBody.tsx` (the column's chrome), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="the-tree"></a>
## The tree

The root is the session's working directory, read from `useSessions().byId[sessionId].cwd`, and split for the header row by `pathPartsOf` from `@deepseek-ai/dsh-util-workspace-path`. Every level is keyed by absolute path; a child's path is its parent's joined with the entry name by `/`. A level is listed when it is first expanded, through `remote.workspaceFiles.list(sessionId, absolutePath)` on the `@deepseek-ai/dsh-api-workspace-files` namespace; the adapter keeps the listing's entries and truncation flag and drops its workspace-relative path. Rows are ordered directories first, then by natural, case-insensitive name; dotfiles are shown like any other entry.

| Entry type | Row |
|---|---|
| `directory` | Toggles; the level is fetched the first time it opens and kept while collapsed. |
| `file` | Opens `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>`, built by `fileAddressFor` from `@deepseek-ai/dsh-util-workspace-path` from the entry's absolute path and the tree's root — through `useTabInfo().tab.actions.openResource` in the tab's body, landing in the tab's own pane, and through `ctx.sidebarRight.openResource` in the explorer column. |
| `other` | Shown greyed and not clickable, so the directory is reported whole. |

A level cut by the endpoint's entry cap ends with a marker; an empty level says so; a level that failed shows one line per code — `workspace-file/not-found`, `outside-workspace`, `not-directory` — and the transport's own message otherwise. Reload drops every listed level and asks again for the expanded ones; collapsed levels are fetched again when they next open. A session without a working directory shows a single line instead of a tree.

State lives in the type's own store, one bucket per owner id — a tab id for tabs of this kind, the session id for the explorer column: `root`, `levels` (loading / ready / failed per absolute path), `expanded`, and `highlighted`, the single row one reveal currently marks. The owner's `signal` ends a bucket: on abort the tree is forgotten and a listing that settles afterwards writes nothing; the column owns its signal through its mount, so it keeps its tree across collapses and loses it when the session view unmounts.

<a id="model-experience"></a>
## Model Experience

None, as this package draws a workspace file tree in the browser and registers nothing model-facing.

#### KV Cache effect

None; directory listings travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Listing only.** No search, artifact filter, drag-and-drop, rename, context menu, or filesystem watching; a level changes only through reload, and the reveal highlight is a transient marker, not a persistent current-file pointer.
- **One root.** The tree is rooted at the session's working directory; there is no way to browse above it, and the Host refuses paths outside the workspace root anyway.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The tree's only runtime state is one Slot store shared by the tab type and the explorer column, written by whichever body owns the acting tree and forgotten on the owner's abort signal; there is no second observation of it to compare against.
