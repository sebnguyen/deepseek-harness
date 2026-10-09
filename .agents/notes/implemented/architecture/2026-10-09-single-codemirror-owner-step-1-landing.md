---
description: "As-landed record of the one-CodeMirror-owner step 1: what shipped on master behind 31afbe7f00 and 536b80a08d, and every deviation from the proposal and git-seam notes with its reason."
kind: "architecture"
---

# Agent Note: One CodeMirror Owner, Step 1 — Landing Report and Deviations

Status: implemented

## Scope

Commits `31afbe7f00` and `536b80a08d` on the fork master land step 1 of the [proposal note](../../proposed/architecture/2026-10-08-single-codemirror-owner-and-data-annotation-seam.md) together with the [git seam](2026-10-09-git-capability-seam.md) and its explorer consumer. This note records how each piece was built and where the landing deviates from either design, so the proposal note can stay proposed for step 2 without drifting into a wrong as-built reading. The superseded platform-singleton note was archived and sealed in `31afbe7f00` per the proposal's landing order.

## How it was implemented

`ui-editor` is the only package with runtime `@codemirror/*` dependencies, pinned by `verify-client-packages.ts`. `runtime.ts` mints one door registry per body: `add` retains an extension under an id and appends it to the live view, `replace` and `compartmentOf` share one retained compartment entry, `compose` replays the retained set into every `EditorState.create`, and `attach` binds the live view so disposal and view re-creation never drop a contribution. `EditorBody.tsx:139-159` exposes the owner face per `editor.annotation` entry — `file`, `blob`, `viewVersion`, `liveView`, `modules` (the provider's state/view namespaces as values), `add`, `replace`, `compartmentOf`, `describeColumn`, `publishMarkers`, `lineText` — with the packaged composition (setup, default and history keymaps, `--dsw-*` token theme, language, save binding) built in `editor.ts` and attached per view.

The data lane is the descriptor/marker pair declared in `contract/slots.ts`: `describeColumn` accepts an `EditorGutterDescriptor` and the body mints the single gutter extension through `annotations.ts`, while `publishMarkers` dispatches the `setGutterMarkers` effect into the live view; change markers ride the same bulletin as before. The list slot was renamed `editor.cm.extension` to `editor.annotation` and the client slot catalog and cordis api catalog regenerated. `ui-line-note` registers its column with `describeColumn`, publishes its pencil markers with `publishMarkers`, owns its popover, and writes through the injected `putSlot`; its manifest keeps `@codemirror/*` as devDependencies only, for type spellings. `workspace-files` `observeSave` (index.ts:455) reads the replaced text before a `write` and mints the `human-save` stop with `purpose: 'human'`, so manual browser saves join the tool-capture timeline. The git seam, `scmStatus`, and the sidebar badges landed as the seam note records; `gen-doc-graphs`, `gen-cordis-catalog` `LINK_MAP`/`SERVICE_PAGE`, and `docs/subsystems/git.md` carry the documentation surface.

## Deviations from the proposal note

The doors are named `add`, `replace`, and `compartmentOf` where the proposal names `addExtension`, `replaceExtension`, and `compartmentOf`, and the bulletin rides `describeColumn`/`publishMarkers` on the owner face; the retention, replay, and disposal semantics are exactly the proposal's, and the shorter names read as doors rather than framework calls. No code uses the proposal's names.

The proposal's step 1 says line-note mints its gutter extension through the runtime's namespaces and installs it through the raw door. The first commit did less well: it value-imported the editor's `annotationGutter` factory, which the tsdown bundle-purity gate rejects because each client package bundles alone and the value import would inline a second CodeMirror mint. The fix commit `536b80a08d` resolves this stricter than the proposal: line-note crosses only the data lane and describes its column as plain records, so it holds no CodeMirror types at runtime and never mints extensions at all. The shipped `modules` namespaces therefore have no first consumer yet; they remain the raw lane for a future entry that genuinely needs framework objects, and the dependency gate still bounds them.

The runtime crosses the `editor.annotation` seat's inject face (`EditorAnnotationOwner`) rather than a standalone `editorRuntime` context key. This is the proposal's own rejected-alternative reasoning applied one level down: the seat registry already types the face per session binding, and a separate key would split one contribution contact across two mechanisms.

The proposal's `editorAnnotations` session-standard hook — republishing the bulletin so any non-CodeMirror consumer mounts on column existence — did not land: the bulletin's only consumer is the editor's own gutter composite, and the acceptance bullet naming a second consumer stays open with step 2, where the first external consumer is planned.

The capture gateway ships inside `dsh-api-workspace-files` as `observeSave`, not as the carved `checkpoint/work-tree` producer; the proposal's landing order sanctions that as step 1 scope, and the carve-out rides with step 2's event families, register retirement, and package split, all of which remain proposed.

## Deviations from the git seam note

The seam note says mutation-shaped adapter members refuse `EROFS`; the landing no-ops them instead, because isomorphic-git's status walk writes index bookkeeping through `writeFile` and `mkdir` and a refusal would crash a read-only query. The invariant — git never mutates the workspace or gitdir through the adapter — is unchanged, and the adapter JSDoc is the authority; the note's `EROFS` sentence is superseded by its package source.

The note does not record isomorphic-git's `FileSystem.read` swallowing every read refusal to `null`; the consequence found in implementation is that a byte cap inside the adapter turns over-cap files into null-content crashes in the status walk, so caps bind `diff` after the read and the status walk stays uncapped, re-reading and re-hashing changed files as the note's performance consequence already expects.

## Alternatives considered

Declaring `@deepseek-ai/dsh-client-ui-editor/client` in line-note's `dsh.client.external` would have kept the value import alive; it was rejected because the externals list exists for module-table rows, and admitting one cross-plugin framework factory would admit the next.

Minting the line-note gutter through the shared `modules` namespaces with `add`, the proposal's letter, remains a live option for any future raw-lane entry; line-note chose the data lane because its column is pure marker data and the data lane needs no framework identity at all.

Refusing mutation-shaped adapter calls with `EROFS` keeps the read-only promise loud but breaks isomorphic-git's status walk, which writes index bookkeeping; the no-op keeps the walk alive while the adapter's JSDoc names the promise.

A standalone `editorRuntime` context key was considered and dropped for the reason the proposal note records against a dedicated context service: the seat's inject face already types the contact per session binding.

## Consequences

CodeMirror is confined to `ui-editor` as an executed gate, and the only shipped annotation entry crosses the data lane, so a contributed column can no longer blank the pane and its specs run without a framework copy. The raw namespace lane ships with no first consumer; its budget is one future entry that genuinely holds extensions, bounded by the dependency gate and per-id disposal.

Retained contributions replay into every re-created view, so editor views still reload per generation while gutters and compartments survive; the specs pin retention, replay, and disposal.

Manual browser saves now mint `human-save` stops beside tool captures, closing the provenance split the proposal's checkpoint half describes; the log-side migration remains step 2.

The git seam reads through `ctx.fs`, so sandboxed and remote execution worlds serve badges identically; the explorer joins git and session authorities at render time only, and a seam-less deployment keeps a badge-free explorer without a switch. The seam note's `EROFS` sentence is superseded by the adapter source, which carries the no-op promise in its JSDoc.

## Verification

Per-file 100% statement and branch coverage on the changed `src` of `packages/git/git`, `packages/git/git-isomorphic`, `packages/api/workspace-files`, and `packages/client/ui-sidebar-files`; the focused lanes pass 41 files and 384 tests; `pnpm run typecheck` is clean; `build:lib:client` proves the purity gate on every client package; the catalog, doc-graph, i18n, note-format, and archive-seal gates pass; both commits ran the pre-commit and pre-push hooks and the web dist was rebuilt after the fix commit.

## Remaining work

Step 2 of the proposal note remains proposed in full: `checkpoint/work-tree` and `checkpoint/file-note` producers with their event families, register retirement, the `ui-checkpoint-*` and `ui-preview` split, the `editor.view` seat, per-family reference resolvers, and the `editorAnnotations` republish hook. The git seam's deferred `log`, `blame`, and write operations remain unadded until a Consumer appears.
