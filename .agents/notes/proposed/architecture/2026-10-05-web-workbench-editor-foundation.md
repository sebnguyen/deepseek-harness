# Agent Note: Web workbench editor foundation — CodeMirror 6 over the workspace-files seam

Status: proposed

## Problem

The web client can observe a workspace but never modify it: `dsh-api-workspace-files` "exposes no mutation operation" (its README line 9) and the right-sidebar `text` preview ([sidebar text preview and file tree](../../implemented/feature/2026-09-05-sidebar-text-preview-and-file-tree.md)) renders files read-only through a shiki `CodeBlock` — the deliberate stance that viewing lives in the web client, with OS hand-off only via `openWorkspacePath` ([web workspace file links](../../implemented/feature/2026-07-31-web-workspace-file-links.md)). No editor library exists anywhere in the dependency tree. The product goal is a VS Code-class editing surface in the web UI that goes beyond VS Code in three places:

1. **Editing with save** — open any readable file in a real editor, edit, Ctrl/Cmd+S, conflict-safe against concurrent agent or external writes.
2. **Stateful LSP** — live diagnostics, completion, hover, jump, plus a Ctrl-click call-site graph and live "N implementations" indicators, served by the language servers the Host already knows how to run (`dsh-lsp-stdio`).
3. **AI-native overlays** — comment threads attached to code ranges across open files, gathered by one command into the agent (`/gather-comments`), and function-aware (structural) diffs instead of raw line diffs.

None of the three exists end-to-end today. The local write seam is complete host-side (`FileSystem.writeText` with `FsWriteIntent` stale guards in `packages/fs/fs`, sandbox containment in `packages/fs/fs-sandbox`), read RPCs already carry an opaque freshness token (`WorkspaceFileStat.version`), and the gateway already multiplexes every Typert Remote stream over one WebSocket (`/api/remote.mux`, `packages/api/gateway/src/stream-protocol.ts:5-6`) with a unary-result return path for Client answers. What is missing is: a write method on the `workspaceFiles` namespace, a stateful LSP relay over the wire (host `ctx.lsp` is query-shaped and re-reads files per query — right for agent navigation, wrong for live diagnostics of an unsaved buffer), and an editable tab type in the sidebar registry. This note fixes the substrate, the seams, and the milestone order so each vision feature lands as an isolated client extension on stable host RPCs.

## Proposal

### Substrate: CodeMirror 6 with `@codemirror/lsp-client`

CodeMirror 6 (CM6) plus the official `@codemirror/lsp-client` (first-party, MIT, first numbered release 2025-07, releases through 2026-09) is the editor substrate. Its `Transport` interface is exactly `send(string) / subscribe(handler) / unsubscribe(handler)` over raw LSP JSON frames, so whatever host relay we build is the only transport concern; completion, `serverDiagnostics` (via `@codemirror/lint`), Markdown hover, and jump-to-definition come wired. CM6's extension model — `StateField`, `StateEffect`, `Decoration` (line, mark, widget, block), gutter markers, keymaps as plain values composed into `EditorState` — makes every vision feature (comment overlays, structural-diff decorations, implementation lenses, chat hooks) a self-contained extension module in our client package, and composes with the React client-plugin architecture instead of fighting it. Lezer grammars give syntax highlighting; shiki remains for the read-only preview.

### Package layout

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-api-workspace-files` (extended) | Gains one `@Remote write` method; the read/scoped namespace becomes the mutation surface for human saves. |
| `@deepseek-ai/dsh-api-lsp-relay` (new, `packages/api/`) | Host Remote namespace `lspRelay`: opens stateful LSP sessions against the configured stdio servers and relays frames both directions. |
| `@deepseek-ai/dsh-client-ui-editor` (new, `packages/client/`) | The editor tab kind, CM6 integration, save/conflict UX, and the vision-feature extensions (M3–M5). |

Client registration follows the established three-stage pattern, verified against `ui-sidebar-documentpreview` and the tab-type registry ([sidebar tab types and navigation](../../implemented/architecture/2026-09-05-sidebar-tab-types-and-navigation.md)): `dsh.client` manifest in `package.json` (`platform: "web"`, informational `inject` edges), a roster row in `packages/bundle/web-app/cordis.patch.yml`, then in `apply(ctx)`:

```ts
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-editor: dictionaries') // copy is locale-owned; i18n gate rejects hardcoding
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: EDITOR_ID,
  kind: EDITOR_KIND,
  patterns: ['dsh-resource://file/**'],
  priority: 'builtin',                       // outranks the text preview's 'fallback' band
  canOpen: (address) => parseFileAddress(address)?.scope === 'session',
  title: basenameOf,
}), 'ui-editor: editor tab type')
ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab', key: EDITOR_ID, locale: NS, store, ... }, EditorBody)))
```

The registry ranks band → longest matched pattern → registration order (`ui-sidebar-right/src/client/tab-registry.ts:51-55,337-351`), so `priority: 'builtin'` claims text-file addresses ahead of the fallback preview while leaving the preview for anything else. The body reads freshness through the standard hook `useResource<'file'>(tab.contentId)` and pages through `remote.workspaceFiles.readAll` (or `read` pages for large files) exactly as the preview does.

### Topology

```
 browser (web-app bundle)
 ┌─────────────────────────────────────────────────────────────────────┐
 │ ui-sidebar-files ──openResource(addr)──▶ sidebarRightTabs.claim()    │
 │                                            │ builtin editor kind  │
 │                                            ▼                    │
 │ ui-editor: EditorView (CodeMirror 6)                              │
 │   ├─ save     remote.workspaceFiles.write(scope, path, text, ver) │
 │   ├─ meta     useResource<'file'> + workspaceFiles.changes stream  │
 │   └─ LSPClient ──Transport┐                                      │
 │        extensions: commentOverlays(), structuralDiff(),           │
 │                    implementationLens(), chatHooks()            │
 └───────────────────────────┬─────────────────────┬──────────────────┘
            HTTP Typert RPC  │                     │ WS /api/remote.mux
 ┌───────────────────────────▼─────────────────────▼──────────────────┐
 │ Host gateway (Typert dispatch + stream mux)                     │
 │  workspaceFiles.write ─▶ ctx.fs.writeText(target, text, intent)   │
 │                          └─ fs-sandbox per-call policy          │
 │  lspRelay.send(msg)   ─▶ spawned stdio language server stdin     │
 │  lspRelay.frames()    ◀─ server stdout — @Remote stream to mux   │
 └─────────────────────────────────────────────────────────────────┘
```

### Save seam: `workspaceFiles.write`

One unary `@Remote` method beside `read`/`stat`, reusing the existing `workspaceFileScope` lookup (session id → workspace root, `index.ts:201-220`) and failing loud through the existing `RemoteError` vocabulary plus two new `RemoteErrorDetailsMap` codes (`workspace-file/stale`, `workspace-file/read-only`):

```ts
@Remote
async write(
  workspaceFileScope: WorkspaceFileScope,
  path: string,
  content: string,
  expectedVersion: string | undefined,   // the version the editor loaded or last saved
  signal: AbortSignal,
): Promise<WorkspaceFileStat> {
  if (this.ctx.sandboxPolicy.defaultMode === 'read-only')
    throw new RemoteError('workspace-file/read-only', `"${path}" is not writable in read-only mode`, { path })
  const { target } = await this.locateFile(workspaceFileScope, path, signal) // existing resolver; absent file → createIfAbsent intent
  await this.ctx.fs.writeText(target, content, expectedVersion === undefined
    ? { createIfAbsent: true }
    : { replaceIfVersion: expectedVersion })   // fs-local throws FS_STALE_VERSION on concurrent write
  return this.statOf(target, await this.statTarget(target, path, signal))
}
```

`fs-local` already serializes writers per target and checks the version guard atomically; `fs-sandbox` enforces the per-call `SandboxExecutionPolicy`. The scope decision recorded here: a **human user is the authority** — saves may land anywhere the composed filesystem backend reaches ("anywhere readable"), gated only by the session's read-only mode; the agent's `workspace-write` containment continues to bind agent tool writes, not human saves. Save conflicts surface as `FS_STALE_VERSION` → the editor offers *reload* (discards the buffer) or *overwrite* (re-saves with the fresh version), and the `changes` stream plus a pre-save `stat` detect external edits while dirty.

### Live LSP seam: `lspRelay`

`ctx.lsp` stays untouched: it serves the agent's one-shot navigation. A new Host namespace owns **stateful** sessions, reusing `dsh-lsp-stdio`'s deployable config (`servers: { id: { command, args, extensionToLanguage } }`) so one extension→language table drives both faces. Full duplex uses only mechanisms the gateway already ships: server→client frames travel a `@Remote({ mode: 'stream' })` method carried by `/api/remote.mux` (the `changes` watch is the precedent, `workspace-files/src/index.ts:365-368`); client→server frames travel a unary `@Remote send`.

```ts
// host: packages/api/lsp-relay
@Remote({ mode: 'stream' })
frames(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): AsyncIterable<string> {
  return this.sessionFor(workspaceFileScope, path, signal).outbound // one lifecycle controller per (server, workspace)
}

@Remote
async send(workspaceFileScope: WorkspaceFileScope, path: string, message: string, signal: AbortSignal): Promise<void> {
  return this.sessionFor(workspaceFileScope, path, signal).deliver(message) // spawns lazily on first frame or send
}
```

The relay owns server processes under the defensive-patterns rules: one lifecycle controller per session, idle-timeout reaping, `shutdown`/`exit` escalation mirroring `lsp-stdio`, and document authority on the browser side (`didOpen`/`didChange` carry the unsaved buffer; the server must not read files the editor holds dirty).

Client side, the Transport adapter is the entire glue:

```ts
import { LSPClient, languageServerExtensions, type Transport } from '@codemirror/lsp-client'

function relayTransport(remote: LspRelayRemote, scope: string, path: string): Transport {
  const handlers: Array<(m: string) => void> = []
  void (async () => {
    for await (const m of await remote.lspRelay.frames(scope, path, AbortSignal.none)) for (const h of handlers) h(m)
  })()
  return {
    send: (m) => { void remote.lspRelay.send(scope, path, m) },
    subscribe: (h) => { handlers.push(h) },
    unsubscribe: (h) => { handlers.splice(handlers.indexOf(h), 1) },
  }
}

const client = new LSPClient({ extensions: languageServerExtensions() })
client.connect(relayTransport(remote, sessionId, path))

new EditorView({ parent, state: EditorState.create({ doc, extensions: [
  basicSetup, languageFor(path), saveKeymap.of([{ key: 'Mod-s', run: save }]), drawSelection(),
  client.plugin(fileUriFor(path)),        // completion + serverDiagnostics + hover + jump
  commentOverlays(sessionId),            // M3
  structuralDiff(),                      // M4
  implementationLens(client),            // M5
  EditorView.updateListener.of(trackDirty),
] ) })
```

The host seams are engine-agnostic: should the substrate ever be swapped, `write`, `lspRelay`, and every vision feature's state live in BFF RPCs and client model code, not in CM6.

## Roadmap and implementation order

```
M1 write seam + editor core (open/edit/save/conflict)
 ├─▶ M2 lspRelay + LSP basics (diagnostics, completion, hover, jump)
 │    └─▶ M5 Ctrl-click call-site graph + live implementation lenses
 ├─▶ M3 comment overlays + /gather-comments (independent of LSP)
 └─▶ M4 function-aware diffs (browser-side on M1; host chunker optionally reuses M2 servers)
```

Order rationale: M1 lands user value (editing + saving) with zero LSP work; M3 needs only the editor buffer model; M5 is pure LSP request/response work on M2's transport; M4's rendering is client-side against any chunk source. **Each milestone beyond M1 opens its own Agent Note when work starts; this note owns the substrate, the seams, and the order.**

- **M1 — editor core.** New `dsh-client-ui-editor` (registration as above), `write` method, dirty indicator, Mod-S, revert, conflict banner (stale → reload/overwrite), locale dictionaries, `DiffBlock`-based save preview. Host: one method + two error codes + REAL-composition test; client: tab-kind + buffer model; per-file 100% coverage applies to every new `src/`.
- **M2 — LSP basics.** `dsh-api-lsp-relay` with stdio spawn/reuse/reap reusing `lsp-stdio` config; client Transport + `client.plugin`. Acceptance: live diagnostics on an unsaved buffer across two open files.
- **M3 — comment overlays + `/gather-comments`.** Comment threads are a `StateField<CommentThread[]>` rendered as block `Decoration.widget`s (React root inside the widget DOM); positions are anchor ranges mapped through transactions, never text, so edits move comments instead of corrupting them; a per-session model aggregates threads across open buffers. The gather command composes one prompt — per file: path, anchored code range, thread text — and submits through `sessionController.prompt`, so the synthesized request is logged like any prompt (model-visible ⟺ logged). Overlays never enter the saved document.
- **M4 — function-aware diffs.** Chunks are symbol ranges, not line windows: host method returns top-level declaration ranges (TypeScript compiler API against the compiled BFF, WASM tree-sitter later for other languages); the client intersects the classical line diff (`@codemirror/merge`) with chunk boundaries and renders one collapsible *function block* per touched declaration, unchanged hunks inside a touched function folded into it. Acceptance: a one-line edit inside a function shows exactly that function as the diff unit.
- **M5 — call-site graph + implementation lenses.** Over the open transport: `textDocument/prepareCallHierarchy` + `callHierarchy/incomingCalls|outgoingCalls` bound to Ctrl-click into a graph panel (custom React, first-party data), and `textDocument/implementation`/`references` counts rendered as CM6 line widgets above the declaring line, refreshed on save. `@codemirror/lsp-client` does not ship these two surfaces today; both are Transport requests plus decorations — the appetite for custom UI is the product.

## Alternatives considered

**Monaco + `monaco-languageclient`.** Loses on integration shape: imperative, app-scale API, documented friction with React component architecture (TypeFox's own v10 write-up), worker/bundle weight in a Vite client, and every vision feature still ends up custom (no browser editor ships comment-overlay → AI or structural diffs). Wins only prebuilt codeLens/peek UI, which M5 rebuilds as product UI anyway.

**`monaco-vscode-api` (VS Code web modules).** Architecturally maximal but inverts the composition: chat and comments become VS Code *extensions* against a transformed `vscode` API — a second application universe parallel to this repo's React client-plugin/slot architecture, with the heaviest bundle and the strongest lock-in. Chosen only if the goal were "ship VS Code unchanged plus chat", which it is not.

**Ace.** Aging extensibility and weak LSP story; no first-party client. Out.

**Raw WebSocket LSP route (bypassing Typert).** Would add a second socket surface, auth, and lifecycle outside the gateway's mux, dispatch, and scope lookups. The `send` + `@Remote({ mode: 'stream' })` pair reuses all of that; the added per-send RPC latency is irrelevant next to LSP server latency.

**Browser-side WASM language servers for M2.** Defers the stdio-relay problem but duplicates server deployment and cannot reuse `dsh-lsp-stdio`'s configured commands; the relay also serves M5 identically. WASM stays a fallback for keyless demos.

**Hand-rolled textarea/code-render hybrid.** No incremental parsing, no LSP client target, all vision features built against raw DOM. Out.

## Acceptance criteria

- `workspaceFiles.write` exists with the `expectedVersion` stale guard; a save racing an agent write fails `workspace-file/stale` and the editor offers reload/overwrite; read-only sessions fail `workspace-file/read-only`. REAL-composition test boots the web profile and drives client→write→conflict.
- `dsh-client-ui-editor` claims `dsh-resource://file/**` addresses ahead of the text preview in the shipped web-app bundle, renders CM6 with highlighting, Mod-S saves, and passes `verify-client-ui-i18n` (all copy in zh/en dictionaries).
- `lspRelay` delivers live diagnostics and completions for an unsaved buffer using the `dsh-lsp-stdio` `servers` config unmodified; server processes are reaped on stream cancellation (disposal proven by the HMR-safety-style test required of registry contributions).
- M3–M5 ship as separate proposed-then-implemented Agent Notes ([this repo's note lifecycle](../../README.md)) referencing the seams fixed here; no milestone edits `ctx.lsp`, `agent-loop`, or the tab registry core.
- Every new `packages/*/src` file meets the per-file 100% coverage gate; new packages carry READMEs with the canonical Model Experience section.

## Risks

`@codemirror/lsp-client` is young (first numbered release 2026-07 per its changelog); the Transport seam caps the exposure — a server-side regression swaps transports, not the editor. Human "anywhere readable" writes widen the mutation surface beyond the workspace root; the read-only latch and version-stale guards are the only fences, and deployments wanting containment can run the session read-only — if that proves too coarse, a per-session write-scope config field is the reserved follow-up, not a v1 knob. Relay process lifecycle (idle servers, crashed servers, multi-client sessions on one workspace) is the M2 design center; one lifecycle controller per (server, workspace) session, never per stream. The `changes` feed relays only instrumented operations, so external (OS-level) edits are invisible until the pre-save `stat` — the version guard makes that race loud rather than silent. Bundle weight: CM6 core plus per-language Lezer grammars is small; shiki already ships for previews, so no second highlighter stack is added to the read path.
