# Agent Note: One CodeMirror instance behind one context key, checkpoint kinds as log event families

Status: proposed

## Problem

The Web plane's source editor composed contributions from other browser plugins through the `editor.cm.extension` list slot: each entry appended a raw CodeMirror `Extension` into the editor's live view. The seam leaked the framework twice. First, every contributing plugin bundled its own `@codemirror/state` and `@codemirror/view`, and CodeMirror classifies extension values with an ordered `instanceof` cascade (arrays, `Compartment`, `Prec`, `StateField`, `FacetProvider`, then an `.extension`-getter object; anything else throws, and a getter returning itself names the multi-instance case, "multiple instances of @codemirror/state are loaded, breaking instanceof checks", `@codemirror/state` 6.7.6 `dist/index.js:1987-2017`). A value built by copy A is a plain object to copy B, so the second copy threw `Unrecognized extension value in extension set` at view creation and blanked the pane — the failure the line-note gutter shipped with. Second, even a shared-copy bridge keeps framework objects as the contribution unit: the editor cannot validate, bound, retain, or reuse what lands in its view, and no renderer besides that view can parse the contributions. Beside it, the checkpoint surface carries its own divergence: `slots.jsonl`, a per-session register, is where worktree stops and note slots live, while the session log carries the same worktree rows a second time as `checkpoint/scan`; forks inherit the log but not the register, so provenance splits by storage.

## Proposal

One CodeMirror instance per session binding, owned by the editor package behind a single context key that carries the provider's module namespaces and retain-and-replay admission doors; contributors mint extensions with those namespaces, install them through the doors, and publish plain gutter markers into a data bulletin, so framework objects, state ownership, and rendering each cross one typed seam apiece. The checkpoint ledger becomes typed log event families per kind with the register as a retiring cache, and the Host save door joins the capture observation so human writes mint stops like tool writes.

## Source of truth: the session log, one event family per kind

The session log is the sole source of truth for every checkpoint kind, and the extension contract is "a new checkpoint kind declares a new typed event family" in the session event map. The worktree kind already emits `checkpoint/scan` (path, call id, purpose, before/after digests). Notes and future kinds emit the tombstone note's log-only `checkpoint/slot` family, renamed per producer by the final composition: digests ride the log when a retained payload or shadow snapshot exists, and the bytes stay in the blob store beside the log (`objects/<2hex>/<sha256>` under the session directory — the put site moves with the log, content never inlines, the `checkpoint/scan` precedent). With that, `slots.jsonl` and `frontier.json` are what they already behaved as — a scan cache — retained read-only for older sessions and retired once the log folds reach parity; `@Remote('stops')` retires with it. Forks inherit provenance for free because they inherit the log prefix. Producers change once: the server observation and the browser `slotPut` append the event beside today's register row during migration; clients read the SOT through the session `eventSource` they already hold, each folding its own kind, fetching bytes through the `blob` remote on demand.

## The editor runtime: one context key, one CodeMirror

The client side declares one context key resolving to a single editor runtime per session binding, provided by the editor package only while the Host offers the `workspaceFiles` read and write faces, so the seat never mounts half-wired. The runtime carries the provider's own `@codemirror/state` and `@codemirror/view` module namespaces — the sole runtime copies, exposed as values so contributors type them with type-only `typeof import('@codemirror/state')` and never hold a second copy — plus `liveView` and `viewVersion`, `lineText`, and the admission doors, which the editor alone dispatches because views are re-created per loaded generation and only retention with replay survives that:

- `addExtension(id, extension): disposer` — retains the value under the id, dispatches `StateEffect.appendConfig` to the live view, replays it into every later `EditorState.create`; the disposer removes it from both.
- `replaceExtension(id, extension)` — rewrites one retained contribution with a whole `StateEffect.reconfigure`.
- `compartmentOf(id): Compartment` — the calm swap slot; a minter who holds it can `compartment.reconfigure` through it, and the runtime replays the last content per generation, outliving view re-creations.

CodeMirror's admission mechanic stays the argument for context-mediated construction: a contributor that imported CodeMirror itself would mint values the view's cascade cannot classify, while building through the runtime's namespaces makes its extensions the provider's identity. The runtime also carries exactly one prepackaged `EditorState.create` per generation — `basicSetup`, the default and history keymaps, the `Mod-s` save binding, theme, highlight, `lineWrapping`, the per-path language, the update listener — attaching the theme per view so every contributed view wears the product tokens without importing them.

## Plugins own state and shape

Each editor-adjacent plugin reads its own SOT through its own remote or `eventSource` and folds it itself — the worktree fold, the note rows, the roll — then mints its extensions through the runtime's namespaces and installs them through a door; the plugin who owns the fold owns how that fold renders, and the editor translates nothing. The data lane survives reduced, as the bulletin that non-CodeMirror parsers need: `describeColumn(descriptor)` and `publishMarkers(columnId, markers)` write plain `{ id, className, fillUnmarked?, onLineClick? }` and `{ line, label, className?, ariaLabel? }` records into a registry the compositor draws through one field keyed by column id, and which the `editorAnnotations` session-standard hook republishes so any UI plugin — preview chips, a notes rail, a non-visual consumer — parses the same state and mounts conditionally on extension-id existence, the `lineNotes` precedent reused one level down. The raw and data lanes ride the same key; the dependency scan in `verify-client-packages.ts` confines `@codemirror/*` runtime dependencies to the editor package so ownership stays an executed gate.

## How the Web UI reaches the screen

Three owners hold three DOM territories; the seam carries components and data only, mounting always the resident reconciler's job: React owns the pages (a seat renders registered entries as plain children, react-dom creates and patches their nodes, unmounting on disposal); CodeMirror owns one island (one empty `div` handed to `new EditorView({ parent })`, CM building and repainting its whole subtree, gutter markers minted during its own line render); React owns anchored overlays (popovers as siblings positioned by coordinates CM listeners report). Shape stays CodeMirror's; skin is the `--dsw-*` token surface `editor.ts` already keys every chrome color and syntax tag to, attached per view by the runtime, contributors' own nodes styling through their css modules over the same variables.

## Final composition

The target package split, today's home in parentheses.

Server plane, three packages over one ledger directory: `fs/checkpoint` keeps the artifact service — blob put and get under the session dir, the `blob` and `restore` remotes, and the retiring scan cache; `checkpoint/work-tree` is the worktree producer carved from `captureWrite`/`retainWrite`, observing committed tool writes through the injected service, storing before/after artifacts, and emitting the `checkpoint/work-tree` event family — successor of `checkpoint/scan`, whose fold reads both spellings across the retirement window so pre-rename sessions still replay; `checkpoint/file-note` is the note producer carved from the `slotPut` note path, validating note puts, storing retained bytes, and emitting `checkpoint/file-note`.

Client plane: `ui-checkpoint-work-tree` (today's `ui-file-history` fold plus `ui-chat`'s turn chips plus the work-tree half of `ui-reference`) folds work-tree events from the session `eventSource`, registers its chips into the conversation turn-chip slot, occupies the `editor.view` timeline key with the scrubber, and registers the `@path#turn#call` grammar into the reference lexicon; `ui-checkpoint-file-note` (the `ui-line-note` read side plus the note half of `ui-reference`) folds file-note events, mints its pencil gutter through the runtime doors, and registers the `@path#L<line>#<note>` grammar; `ui-editor` shrinks to frame and runtime — the `editorRuntime` context key with namespaces, packaged create, token theme, doors, and bulletin, keeping the `source` view key with banner, status, and mode rail; `ui-preview` (markdown and html renderers carved from `ui-editor`) occupies the `preview` view key over the loaded generation alone. The reference lexicon keeps the generic tokenizer; each checkpoint consumer registers its token family's resolver through one list slot reading only its own fold, retiring `ui-reference`'s hardwired register reads with the register. Views are a keyed seat under the editor tab, `editor.view`; the raw-lane `ui-editor-extension-<name>` packages of the first proposal become unnecessary for these three, because the views are the extensions.

CodeMirror runtime stays client-only; the server plane holds log and artifacts. Typert declares nothing of the seam: it models functions only as arity-checked remote wire signatures and values as data, so the in-realm contract rides the TypeScript owner face, the `SlotMap` declaration merge, and the generated client slot catalog; the ledger's data slice is the typert-expressible reservation, one catalog interface if a feature ever needs Host visibility, and nothing before.

## Alternatives considered

- A platform-module singleton for CodeMirror (the emergency landing this design supersedes): it removed the second copy but made the shell import a UI framework, conflating framework distribution with the contribution seam and giving contributors no state, retention, or replay story; reverted as this seam lands.
- Raw extension slots as before, under a shared copy: contributors still dispatch framework objects they must retain themselves, views lose replay, and no parser besides the view reads the contributions; rejected.
- A dedicated client context service for the runtime: it splits one contribution contact across two mechanisms and skips the owner face the slot registry already types; rejected per the Cordis seam rule.
- Server-side CodeMirror state shared over a transport: CodeMirror is a DOM library with no server face; the server plane keeps the log and artifacts only, and generations cross as plain strings.
- An untyped register-only ledger as the SOT: forks inherit the log, not a per-session register; the ledger is rebuilt as typed log event families with the register as a retiring cache.

## Landing order

1. Runtime door increment: EditorBody provides the runtime object (namespaces, doors with retention and replay, `lineText`, `liveView`, bulletin) through the renamed `editor.annotation` seat; change-markers stays on the bulletin; line-note migrates to the doors, minting its gutter extension through the namespaces and dispatching its own note-line effect; its manifest drops runtime `@codemirror/*` dependencies (types-only devDependencies for the type spellings); catalog regenerated; the manual-save capture gateway follows.
2. SOT migration: `checkpoint/work-tree` and `checkpoint/file-note` producers emit their event families beside register rows; clients fold from the `eventSource`; parity spec pins log-fold equals cache-fold; the register writers stop; `@Remote('slots')` and the legacy stops remote retire afterwards with the package split and the `editor.view` seat extraction (ui-preview, timeline view into the work-tree consumer, reference resolvers per family).
3. Archive the platform-singleton note as superseded in the commit that lands 1, its emergency platform rows already reverted.

## Acceptance criteria

- `ui-editor` is the sole package with `@codemirror/*` runtime dependencies, pinned by `verify-client-packages.ts`.
- The `editor.cm.extension` key, owner face, and registrations are gone; `editor.annotation` carries change-markers (bulletin) and line-note (doors), registered via `ctx.effect` with disposers; the client catalog regenerates clean.
- `add`, `replace`, and `compartmentOf` each replay a retained contribution into a recreated view and stop at disposal, pinned by ui-editor specs; the bulletin feeds at least one non-CodeMirror consumer mounting on extension-id existence.
- The worktree and note timelines fold identically from log events and from the cache remote during migration, pinned by one parity spec; forks list both kinds from the inherited prefix.
- The Host write path feeds `captureWrite` with human-save attribution (follow-up landing inside step 1 scope).
- Focused suites pass with per-file 100% on changed `src`; assembled boot replays source mode without instance warnings.

## Risks

- Minting through namespaces keeps a documented framework path; it is bounded by the dependency gate, retention-only dispatch, and per-id disposal, so a bad extension dies with the view rather than the pane.
- Retained closures outlive their binding unless disposal rides the registration's effect and unbind, so the runtime drops retained entries on both.
- Bulletin class strings cross the seam as plain text by design; a renamed class fails silently, matching slot copy classes.
- `liveView` is undefined outside source mode; the bulletin exists independently so existence checks never depend on the view.
