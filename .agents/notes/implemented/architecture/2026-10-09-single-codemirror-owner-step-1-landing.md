# Agent Note: One CodeMirror Owner Step 1 and the Git Seam — As-Landed Record

Status: implemented

## Problem

The [proposal note](../../proposed/architecture/2026-10-08-single-codemirror-owner-and-data-annotation-seam.md) stays `proposed` until its step 2 (log event families, package splits, register retirement) lands, so readers who open it meet door names, a raw-lane line-note, and an `editorAnnotations` hook that do not match master; the [git seam note](2026-10-09-git-capability-seam.md) likewise records an `EROFS` refusal the adapter does not implement and omits the isomorphic-git read-refusal swallow that changed where byte caps can bind. Without an as-landed companion, step 2 would re-plan from texts that describe neither code, and the bundle-purity failure that reshaped the line-note landing would re-litigate from scratch.

## Decision

Master (`31afbe7f00`, `536b80a08d`) is step 1 as shipped, and both design notes stay authoritative only where this note does not amend them.

`ui-editor` owns the single CodeMirror: `runtime.ts` mints one door registry per body — `add`, `replace`, `compartmentOf`, `compose`, `attach` — and `EditorBody.tsx` hands each `editor.annotation` entry an owner face with `file`, `blob`, `viewVersion`, `liveView`, `modules` (the provider's `@codemirror/state` and `@codemirror/view` namespaces as values), the three raw doors, `describeColumn`, `publishMarkers`, and `lineText`; the packaged state (setup, keymaps, `--dsw-*` token theme, language, save binding) lives in `editor.ts` and attaches per view. `verify-client-packages.ts` confines runtime `@codemirror/*` dependencies to `ui-editor` as an executed gate, and the client and cordis catalogs carry the `editor.cm.extension` to `editor.annotation` rename.

The landed data lane is the descriptor/marker pair of `contract/slots.ts`: `describeColumn` accepts an `EditorGutterDescriptor`, the body mints the one gutter extension through `annotations.ts`, and `publishMarkers` dispatches `setGutterMarkers` into the live view; change markers ride the same bulletin. `ui-line-note` crosses only this data lane: its gutter registers through `describeColumn`, publishes pencils through `publishMarkers`, writes through the injected `putSlot`, and keeps `@codemirror/*` as devDependencies for type spellings alone. The first commit value-imported the editor's `annotationGutter` factory instead, and the `dsh-client-bundle-purity` tsdown gate rejected it on the first assembled web build, because each client package bundles alone and the import would inline a second CodeMirror mint; `536b80a08d` is the stricter resolution described here. The shipped `modules` namespaces therefore have no first consumer yet and remain the raw lane the dependency gate bounds.

The runtime crosses the seat's inject face, not a standalone `editorRuntime` context key, and the `editorAnnotations` session-standard hook did not land: the bulletin's only consumer is the editor's own gutter composite. Both ride with step 2's first external consumer.

`packages/api/workspace-files/src/index.ts` `observeSave` is the capture gateway inside `dsh-api-workspace-files`: `write` reads the replaced text before the write, then mints the `human-save` stop with `purpose: 'human'` attribution, so manual browser saves join the tool-capture timeline; the carved `checkpoint/work-tree` producer is step 2.

The git seam, `workspaceFiles.scmStatus`, and the `ui-sidebar-files` badges land as the seam note records, with the amendments this note's git-seam deviations section names; `docs/subsystems/git.md`, the `git` service roles in the doc graphs, and the `LINK_MAP`/`SERVICE_PAGE` entries in `gen-cordis-catalog.ts` carry the generated surface.

## Deviations from the proposal note

The doors are named `add` and `replace` where the proposal names `addExtension` and `replaceExtension`; the retention, live append, per-generation replay, and disposal semantics are the proposal's, and no code uses the proposal's names.

Line-note deviates from the proposal's letter — mint through the namespaces, install through the raw door — by crossing only the data lane; the deviation is stricter than the proposal, not looser, and the raw lane remains available to a future entry that genuinely holds extensions.

The `editorAnnotations` republish hook and the whole step 2 surface (producers, event families, register retirement, `ui-checkpoint-*`/`ui-preview` splits, the `editor.view` seat, per-family reference resolvers) remain in the proposal note, untouched.

## Deviations from the git seam note

The seam note says mutation-shaped adapter members refuse `EROFS`; the landing no-ops them, because isomorphic-git's status walk writes index bookkeeping through `writeFile` and `mkdir` and a refusal would crash a read-only query. The adapter JSDoc carries the never-mutate promise; the note's `EROFS` sentence is superseded by its package source.

The note omits that isomorphic-git's `FileSystem.read` swallows every read refusal to `null`; consequently a byte cap inside the adapter turns over-cap files into null-content crashes in the status walk, so caps bind `diff` after the read and the status walk stays uncapped, re-reading and re-hashing changed files as the note's performance consequence already expects.

## Alternatives considered

Declaring `@deepseek-ai/dsh-client-ui-editor/client` in line-note's `dsh.client.external` would have kept the value import alive; rejected because the externals list exists for module-table rows, and admitting one cross-plugin framework factory would admit the next.

Minting the line-note gutter through `modules` with `add`, the proposal's letter, remains the raw lane for a future entry; line-note chose the data lane because its column is pure marker data and needs no framework identity.

Refusing mutation-shaped adapter calls with `EROFS` keeps the read-only promise loud but breaks the status walk; the no-op keeps the walk alive and the adapter JSDoc names the promise.

A standalone `editorRuntime` context key was dropped for the proposal note's own reason against a dedicated context service: the seat's inject face already types the contact per session binding.

## Consequences

A contributed column can no longer blank the pane: no annotation entry carries CodeMirror identity, and the dependency gate fails any package that grows one. Retained contributions replay into every re-created view, so per-generation reloads keep gutters, compartments, and markers, with the editor specs pinning retention, replay, and disposal.

Manual browser saves carry the same provenance as tool captures, closing the split the proposal's checkpoint half describes; the log-side migration is still open in step 2.

The git seam reads through `ctx.fs`, so sandboxed and remote execution worlds serve badges identically and a seam-less deployment keeps a badge-free explorer without a switch; the status walk runs off the Host loop on a worker thread and the badges ride one pushed refresh per write burst ([off-loop walk note](./2026-10-09-off-loop-git-walk-and-pushed-scm-state.md)).

## Testing

Per-file 100% statement and branch coverage on the changed `src` of `packages/git/git`, `packages/git/git-isomorphic`, `packages/api/workspace-files`, and `packages/client/ui-sidebar-files`; the focused lanes (git, workspace-files, sidebar, editor, line-note, checkpoint) pass 41 files and 384 tests; `pnpm run typecheck` is clean; `build:lib:client` proves the purity gate on every client package; the catalog, doc-graph, i18n, note-format, and archive-seal gates pass.

## Deferred

Step 2 in full stays proposed: `checkpoint/work-tree` and `checkpoint/file-note` producers with their event families, register retirement, the `ui-checkpoint-*` and `ui-preview` split, the `editor.view` seat, per-family reference resolvers, and the `editorAnnotations` hook with its first consumer. The git seam's `log`, `blame`, and write operations remain unadded until a Consumer appears.
