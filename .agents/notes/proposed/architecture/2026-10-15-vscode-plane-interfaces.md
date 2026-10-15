# Agent Note: VS Code twin planes — the interface contract of vscode-events, vscode-line-notes, vscode-modules, vscode-timeline

Status: proposed

## Problem

The four vscode plane packages (`packages/extensions/vscode-{events,line-notes,modules,timeline}`) share one shape — a self-contained cordis plugin bundle injected into the twin seat by the bridge — but their individual contracts (inject keys, vscode APIs consumed, frame routes, remote namespaces) live only in source scattered across four packages plus the facade definition in `vscode-cordis`. This note is the reference sheet: what each plane's interface IS today, and (for the two skeleton planes) what it is declared to become. It follows the design laid down in [the vscode twin bridge seat note](2026-10-13-vscode-twin-extension-cordis-seat.md): one real vscode extension (`vscode-cordis`, id `dsh.do-harness-bridge`) owns the seat; everything else is a cordis plugin under it.

## The shared plane interface

Every plane is a **two-faced cordis package**, not a vscode extension:

| Facet | Convention | Evidence |
|---|---|---|
| Host face | `src/index.ts` (built to `lib/index.js`); deliberately inert for the pure planes — `inject = []`, empty `apply()` — exists only so the vscode-modules roster scan sees the package | `vscode-events/src/index.ts:8-11`; `vscode-line-notes/src/index.ts:8-11`; `vscode-timeline/src/index.ts:8-11` |
| Vscode face | `src/vscode/index.ts` built **only** under `DSH_BUILD_FACE=vscode` to `lib/vscode.js` (CJS, node20); `vscode` is the sole external left unbundled | `packages/extensions/tsdown.vscode.ts`; each plane's `tsdown.config.ts` (`vscodeBundle(...)`) |
| Roster declaration | `dsh.vscode` block in package.json: `{ platform: 'vscode', inject: [...] }`; parsed/zod-validated by vscode-modules into a manifest row `{ id, name, rev, url, inject, external, immediately }` | `vscode-modules/src/manifest.ts`; `registry.ts:127-166` |
| Exports | `"." -> ./lib/index.js`, `"./vscode" -> ./lib/vscode.js`; plane id = npm name minus `@deepseek-ai/` scope | each plane's package.json; `vscode-modules/src/manifest.ts:88-90` |

Two inject keys every plane consumes, both supplied by `vscode-cordis`:

- **`vscodeApi`** — the frozen facade over the ambient `vscode` module (`packages/extensions/vscode-cordis/src/vscode-api.ts:17-32`). Planes never `import 'vscode'`; they consume only the facade, whose surface today is:
  - `workspace.workspaceRoot(): string | null`
  - `workspace.onDidSaveTextDocument(listener)`
  - `workspace.onDidChangeActiveTextEditor(listener)`
  - `workspace.registerTextDocumentContentProvider(scheme, provider)`
  - `window.showTextDocument(path, { line? })`
  - `languages.onDidChangeDiagnostics(listener)`, `languages.getDiagnostics(uri)` (severity 0 = Error, 1 = Warning), `languages.registerInlayHintsProvider(selector, provider)`
- **`remote.<ns>`** — Typert remote namespaces mounted by the bridge during activation (`vscode-cordis/src/extension.ts:106-108`: `$mount(ideRemote)`, `$mount(timelineRemote)`, `$mount(lineNotesRemote)`).

Downlink frames arrive on the cordis event bus as `dsh/frame/<extId>/<verb>` (seat's sole-owner fan-out, `vscode-cordis/src/seat.ts:31,99`); uplink goes through `remote.ideBridge.report({ token, event })` where `token = ctx.twinCore.token`.

## Per-plane contracts

### vscode-modules — the plane-delivery pair (functionally complete)

The only plane with a real host half. **Host face** (`src/index.ts`, `src/manifest.ts`, `src/registry.ts`): scans installed packages' `dsh.vscode` blocks, zod-validates each row, reads `lib/vscode.js` bytes into a `PlaneRecord` (warns loudly when a declared face has no built `lib/vscode.js`, `registry.ts:142-145`), and serves the manifest at `GET <dshOrigin>/vscode/manifest`, each plane's bytes at `/vscode/plugin/<id>`. **Vscode face** (`src/vscode/index.ts`, consumed by `vscode-cordis/src/extension.ts:21,117-118`) exports:

```ts
fetchVscodePlanes(dshOrigin): Promise<VscodeModulesManifest>  // GET /vscode/manifest
vscodeModulesResolver(identity, graph, evaluate?): { resolve(name: string) }
// resolve() fetches `${dshOrigin}${row.url}` and evaluates via
// new Function('module','exports', code)(mod, mod.exports)
// throws `vscode-modules: <name> not declared …` / `vscode-modules: fetch <url> failed (<status>)`
```

Because the evaluator supplies only `module`/`exports`, every plane bundle must be self-contained with `vscode` as the only external. No `dsh/frame/vscodeModules/rebuild/*` consumer exists — seat-side hot rebuild is a design note (`scripts/dev-vscode.ts:13`), not implemented.

### vscode-events — uplink-projection pilot (functionally complete)

`inject = ['vscodeApi', 'remote.ideBridge']`. Subscribes to three facade listeners and projects each into one `remote.ideBridge.report({ token: ctx.twinCore.token, event })` call (`src/vscode/index.ts:49-69`):

| Facade subscription | Workbench event | Uplink event |
|---|---|---|
| `workspace.onDidSaveTextDocument` | a document save | `{ type: 'save', path }` |
| `workspace.onDidChangeActiveTextEditor` | active editor switch | `{ type: 'activeEditor', path | null }` |
| `languages.onDidChangeDiagnostics` + `getDiagnostics` | error/warning churn | `{ type: 'diagnostics', path, errors, warnings }` (severity 0/1 counts) |

Documents without `fsPath` (in-memory buffers) are dropped; report rejections are swallowed. Declares `twinCore: { token: string }` on the cordis Context. The host-side union it feeds is at `packages/api/ide/src/types.ts:56-70`.

### vscode-line-notes — `@path#L<n>` note decorations (skeleton)

Contract: `inject = ['vscodeApi', 'remote.lineNotes']`. Intent (header doc): render line-attached notes as transient decorations and inlay hints, fed by the `lineNotes` remote whose state arrives over `dsh/frame/line-notes` downlink frames (`packages/api/line-notes/src/index.ts:6`). **Today: a no-op** — `apply(ctx)` is `void ctx` (`src/vscode/index.ts:16-18`); no vscode API call anywhere. Its only realized value is the `dsh.vscode` declaration that makes vscode-modules roster it. Tests pin only the inject list (`tests/line-notes.vscode.spec.ts`).

### vscode-timeline — checkpoint timeline virtual documents (placeholder)

Contract: `inject = ['vscodeApi', 'remote.timeline']`. Intent: mount sandbox checkpoint-timeline frames (delivered as `dsh/frame/checkpoint/timeline`, `packages/api/timeline/src/index.ts:8`) as read-only virtual documents at scheme `dsh-checkpoint:`. **Today: one effect** — `apply` registers a `TextDocumentContentProvider` for `dsh-checkpoint` whose `provideTextDocumentContent` unconditionally returns the literal `'<checkpoint placeholder>'` (`src/vscode/index.ts:25-33`); no normalization, frame receipt, or editor-intent tracing exists yet. Nothing opens the scheme.

## State-of-the-world summary

| Plane | inject | Realized behavior | Consumes frames / remote |
|---|---|---|---|
| `vscode-modules` | host face owns the roster; vscode face = fetch/eval | fetches + evaluates all planes into the seat's Loader | `GET /vscode/manifest`, `/vscode/plugin/<id>` |
| `vscode-events` | `['vscodeApi', 'remote.ideBridge']` | 3 workbench events → `ideBridge.report` uplink | uplink only |
| `vscode-line-notes` | `['vscodeApi', 'remote.lineNotes']` | none (no-op `apply`) | declared: `dsh/frame/line-notes` |
| `vscode-timeline` | `['vscodeApi', 'remote.timeline']` | registers `dsh-checkpoint:` provider returning placeholder | declared: `dsh/frame/checkpoint/timeline` |

Open items: `dsh-checkpoint:` has no entry point that opens it; seat-side plane hot-rebuild (`dsh/frame/vscodeModules/rebuild/*`) is unimplemented; the HTTP handler wiring the host registry to `GET /vscode/manifest` lives in the harness app, not in vscode-modules.
