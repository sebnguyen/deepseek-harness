# Agent Note: vscode platform mirror — concrete spec for the twin's client/host machinery

Status: proposed

## Problem

The web UI and the vscode twin ride the same two-engine stack — host Cordis engine + wire namespaces + client Cordis engine — but only the web has the full machinery floor under it: a bundle-layer YAML roster, a host-half scanner (`dsh-client-modules`) that lands `window.__DSH_BOOT__` and combo scripts, per-package one-line `clientBundle()` tsdown configs, and an `api/remotes` catalog that mounts every declared namespace in one pass. The twin currently owns exactly one staged artifact: `extension.cjs` written per spawn by `stageVscodeBridgeExtension`, one scoped bearer-route pair, no roster, no manifest, and no mechanism for a plane package (event projections, timeline, line notes, checkpoint surface) to declare itself shippable. The seat note's acceptance row 4 already reserves `seat.plugin(Loader(...))` over a manifest as the sibling milestone; this note specifies the machinery concretely: which packages exist, which build pipeline serves them, what the manifest artifact reads like, which plugins are pilots, and the protocol by which the next plane is born.

## Proposal

Mirror the web's six-step machinery onto the vscode platform, reusing everything that can be reused verbatim and adding the minimum that must differ. Five concrete artifacts follow.

### Pilot plane interfaces — what a `src/vscode/index.ts` file has

A pilot plane is a plane *package*: one `package.json` with a `dsh.vscode` block declaring `"inject": ["..."], "platform": "vscode"`; one `src/vscode/index.ts` exporting `apply(ctx)` (plus optional `inject`); one `tsdown.config.ts` (the one-liner); optional host half in `src/index.ts` declaring a `TypertRemoteService` namespace; and `tests/*.vscode.spec.ts`. The seat's Loader mounts every `dsh.vscode` row atomically at seat boot — the per-plane interface is:

- **`@deepseek-ai/dsh-vscode-events` (uplink migration)** — moves the uplink projection listeners (save/activeEditor/diagnostics counts) out of `vscode-cordis/src/seat.ts` hard-coded `runSeatLoop` into a plane. Interface:

 ```ts
 import type { Context } from '@deepseek-ai/cordis'

 export const inject = ['remote.ideBridge']

 export function apply(ctx: Context): void {
   vscode.workspace.onDidSaveTextDocument(doc =>
     ctx.remote.ideBridge.report({ token: TOKEN(), event: { type: 'save', path: doc.uri.fsPath } }))
   vscode.window.onDidChangeActiveTextEditor(ed =>
     ctx.remote.ideBridge.report({ token: TOKEN(), event: { type: 'activeEditor', path: ed?.document.uri.fsPath ?? null } }))
   vscode.languages.onDidChangeDiagnostics(evt => { /* aggregate err/warn counts */ })
 }
 ```

- **`@deepseek-ai/dsh-vscode-timeline` (downlink consumer)** — registers a virtual-document window for session checkpoints.

 ```ts
 export const inject = ['remote.timeline']

 export function apply(ctx: Context): void {
   const provider = vscode.workspace.registerTextDocumentContentProvider('dsh-checkpoint', contract)
   ctx.on('dsh/frame/checkpoint/timeline', frame => consume(frame))
 }
 ```

 Its host half declares `timeline extends TypertRemoteService` with stream remote remotes; consumers on either face mount the generated descriptor byte-for-byte identical.

- **`@deepseek-ai/dsh-vscode-line-notes` (deferred `line` forward)** — renders `@path#L<n>` notes as transient editor decorations + inlay hints, and opens the back-direction (user lands on a note → `lineNotes.focus` uplink), with its own `TypertRemoteService` (`lineNotes`) rather than extending the bridge:

 ```ts
 export const inject = ['remote.lineNotes']

 export function apply(ctx: Context): void {
   const provider = vscode.languages.registerInlayHintsProvider({ scheme: 'file' }, render)
   ctx.on('dsh/frame/line-notes', frame => notes.frame(frame))
 }
 ```

### Concrete implementation plan — the code I'll write

**1. Extend `buildFace` to `'vscode'`, and add `vscodeBundle(name, extraEntries)`** — `packages/client/tsdown.client.ts` gains a third/face channel: on `--env.DSH_BUILD_FACE vscode` the same pipeline runs but applies vscode constants per package (`platform: 'node'`, `format: ['cjs']`, `alwaysBundle: [/^@deepseek-ai\//]`, `neverBundle: ['vscode']`, `entry: ['src/vscode/index.ts']`). The packaging script is the same:

```ts
export default vscodeBundle('@deepseek-ai/dsh-vscode-events')
```

The tiny difference from a genuine `clientBundle` call is in *what* it packages, not *how*: both face builds produce one hashed `${face}.js` per package, both ElrEmi `deps.alwaysBundle` for the in-repo closure, both let the loader-composed seat take the 'vscode' import as an external supply.

**2. Aggregate tsconfig for the vscode face** — new `tsconfig.vscode.json`: everything in `packages/*/*/tsconfig.vscode.json` (which nothing yet provides) plus `packages/extensions/vscode-modules/tsconfig.vscode.json` + `packages/extensions/vscode-cordis/tsconfig.client.json` (already exists). TypeScript `references` graph grows by one per vscode-faced package.

**3. `build:lib:vscode` + root tsconfig wiring** — new scripts in `package.json`:

```json
"test:vscode": "$(command -v vitest) run --config vitest.config.vscode.ts",
"build:lib:vscode": "tsc -b tsconfig.vscode.json && tsdown --env.DSH_BUILD_FACE vscode"
```

And `build:lib` gains `&& pnpm run build:lib:vscode`. The fresh `tsconfig.vscode.json` is mounted with `emitDeclarationOnly: true` + `declarationMap: true`. The tsdown-side `tsdown.config.ts` at the root grows a new env-face test in `isBuildFaceClient`: `"vscode" = buildFace === 'vscode' ? return face-selection-for-vscode-'workspace': [...other-face selection still-distinguishing-host-vs-client faces-but-both-now-also-carries-'vscode'-path]`. Its output lands in `lib/vscode.js` per vscode-faced package (per the `vscodeBundle()` factory contract).

**4. New package: `@deepseek-ai/dsh-vscode-modules` at `packages/extensions/vscode-modules`** — the bridge between `lib/vscode.js` bytes and anything that reads them: host authoritatively stages them per spawn; vscode side merely resolves staged CJS files. Its exported classes/functions:

```ts
// packages/extensions/vscode-modules/src/host/index.ts
export class VscodeModulesRegistry extends Service { /* ... */ }
export interface VscodeModulesGraph { rev: string; plugins: VscodeModulesPlugin[] }
export function vscodeModulesRegistryClientConvention(...): Service
export function stageToSpawn(stateDir: string): Promise<void>
export function manifestPath(stateDir: string): string
export function readVscodeManifest(stateDir: string): VscodeModulesGraph
```

and on vscode side (still in the same package — `tsconfig.vscode.json` covers both its faces, pro -- the face logical-half isn't half)). `src/vscode/index.ts`:

```ts
// packages/extensions/vscode-modules/src/vscode/index.ts
export function vscodeSeatConsumer(...) { /* resolver of ./exts/<plane>/extension.cjs */ }
```

Dependencies mirrored from `dsh-client-modules` strictly: one class on each face, sessions, negative-expand.

**5. vscode-cordis restructure** — two edits:

a. `packages/extensions/vscode-cordis/src/seat.ts` grows manifest-consume: after the bridge identity poller completes, instead of manually starting each projection, `runSeatLoop` opens `./vscode-manifest.json` and iterates its rows through the Loader:

```ts
seat.plugin(Loader)
ctx.loader.internal = vscodeModulesResolver(identity)  // from vscode-modules
for (const row of manifest.plugins) {
  await ctx.loader.create({ name: row.id, inject: row['inject'] })
}
```

b. Its `tsdown.config.ts` keeps spitting one emergent shell (`dist-extension/extension.cjs`) — vscode-modules' `extension.json` stages alongside it per spawn; both converge in the `<stateDir>/stage/` directory the stem breeds.

**6. `vscode-modules`'s own tsdown.config.ts** — the modules' horsepower stays entirely host-side (registry + stageToSpawn); its seat-side piece (`twinModulesResolver(identity)` — now `vscodeModulesResolver(identity)`) lives in `packages/extensions/vscode-modules/src/vscode/index.ts` but is thin enough to bin with `vscodeBundle` untouched via its config: `vscodeBundle('@deepseek-ai/dsh-vscode-modules')`. Its exports target `main: 'lib/index.js'` (host) + `'./vscode': 'lib/vscode.js'` (the resolver plane).

**7. Pilot planes**

Each at `packages/extensions/vscode-<pilot>/`:

```text
# packages/extensions/vscode-{events,timeline,line-notes}
├── package.json                # dsh.vscode block (platform: 'vscode', inject list)
├── tsconfig.vscode.json        # aggregate project (new)
├── tsconfig.client.json        # forwards to tsconfig.vscode.json
├── tsdown.config.ts            # one-line vscodeBundle wrapper
└── src/
    └── vscode/
       └── index.ts            # apply(ctx) (imported via inject)


# api/remotes catalog learns two shared namespaces
- packages/api/remotes/tsdown.config.ts  # as is today
- packages/api/timeline/src/index.ts    # NEW — timeline.history, timeline.slice (host)
- packages/api/line-notes/src/index.ts   # NEW — lineNotes.focus, notes.state (host)
- packages/api/remotes/src/index.ts      # +timeline +lineNotes mounts
```

**8. Dev loop**

New script `dev:vscode` = `tsx scripts/dev-vscode.ts --poll` (three watch stages, mirror of `dev:web.ts`):

```text
1. tsc --watch tsconfig.vscode.json
2. tsdown --watch --env.DSH_BUILD_FACE vscode
3. open (vscode native instance or REH of twin) --watch on the terminal
```

plus hot-reload protocol: `dsh/frame/rebuild/<planes>` downlink frame → bridge seat listener → Loader `dispose`/recreate per updated plane, preserving `vscode:`.

**9. Host side staging hookup**

`packages/api/ide/src/manager.ts` adds one stage call after `stageVscodeBridgeIdentity`:

```ts
await ctx.vscodeModules.stageToSpawn(stateDir)   // sets up vscode-manifest.json + exts/
```

where `vscodeModules` is the new namespace ([implementation of #4 above]). `vscode-manifest.json` is written beside `bridge.json` (already existing in stageVscodeBridgeIdentity).

**10. Package-by-package tsdown update list** (when it lands)

| package | gets |
|---|---|
| `packages/extensions/vscode-modules` | `tsconfig.vscode.json`, `tsdown.config.ts`, host half `VscodeModulesRegistry` |
| `packages/extensions/vscode-events` | full face tree + `tsconfig.vscode.json` |
| `packages/extensions/vscode-timeline` | full face tree + its own `tsconfig.host.json` (api side) |
| `packages/extensions/vscode-line-notes` | full face tree + its own `tsconfig.host.json` |
| `packages/api/timeline` | new — timeline namespace + `tsconfig.host.json` |
| `packages/api/line-notes` | new — lineNotes namespace + `tsconfig.host.json` |
| `packages/api/remotes` | mount entries for timeline + lineNotes |
| `packages/extensions/vscode-cordis` | its tsdown.config + seat.ts boot-stage edit |
| `packages/api/ide` | `manager.ts` compose call, `vscode-manifest.json` staging schema update |

### Packages introduced

1. **Seat (shipped, locked) — `@deepseek-ai/dsh-vscode-cordis` at `packages/extensions/vscode-cordis`**: the one scanned vscode extension (`dsh.do-harness-bridge`, activation `onStartupFinished`, `platform: 'node'`). This milestone adds exactly one capability: it becomes the Loader-bearing seat (see "Seat implementation" below) instead of a programmatically-composed singleton. Its `extension.cjs` stays immutable per harness commit.
2. **Scanner / registry (new) — `@deepseek-ai/dsh-vscode-modules` at `packages/extensions/vscode-modules`**: the twin analog of `dsh-client-modules`, host-face only. On the host ctx, `VscodeModules` Service with `inject = ['loader']`; it subscribes to the host loader's `internal/plugin` fiber lifecycle, finds each active entry's `package.json`, gates on `dsh.vscode`, locates the plane's built `lib/vscode.js` output, computes the rev, and exposes one synchronous entry point `stageToSpawn(stateDir): Promise<void>` that `api/ide`'s `manager.ensure()` calls alongside `stageVscodeBridgeExtension`. On its vscode face it exports nothing mountable — the seat's resolver is built per spawn (see "Seat implementation"). Its tests assert the eligibility filter doesn't silently absorb a `dsh.vscode` key through `dsh.client`'s parser, split keyed fields by face as intended.
3. **Pilot plane 1 — `@deepseek-ai/dsh-vscode-events` at `packages/extensions/vscode-events`**: uplink-migration pilot. Moves the uplink projections (save saves, active text editor, diagnostics error/warning counts) out of seat.ts's hard-coded body into its own Cordis plugin using the vscode.workbench events; it emits `ctx.remote.ideBridge.report({ token, event })` typed on `IdeBridgeReportEvent`. After the move, `vscode-cordis`'s `seat.ts` slims to protocol-only (hello + downlink fan-out), and each projection event is a manifest-row answer.
4. **Pilot plane 2 — `@deepseek-ai/dsh-vscode-timeline` at `packages/extensions/vscode-timeline`**: downlink-consumer pilot. Listens on reserved `dsh/frame/checkpoint/timeline` frames, mounts a `TextDocumentContentProvider` on the virtual scheme `dsh-checkpoint:`, and surfaces the session checkpoint timeline as a virtual document any vscode panel can navigate. Its host half declares one `TypertRemoteService` (`timeline` namespace) — the interface the twin's `api/remotes` mount would consume identically if a web-side plane ever does.
5. **Pilot plane 3 — `@deepseek-ai/dsh-vscode-line-notes` at `packages/extensions/vscode-line-notes`**: the deferred `line` forward consumer. Renders `@path#L<n>` chip lines as transient editor decorations, consumes `dsh/frame/line-notes` frames, and publishes an uplink `lineNotes.focus` remote when the user lands on a note. It owns its own host `TypertRemoteService` (`lineNotes`) — the line note's forward contract leaves `ideBridge/open` untouched and gains its own namespace.

### Build pipeline introduced

The compile chain parallels `build:lib:client` verbatim except for instance-unique swaps:

- **Root script**: `"build:lib:vscode": "tsc -b tsconfig.vscode.json && tsdown --env.DSH_BUILD_FACE vscode"` — typecheck the vscode face aggregate, then fan out the face's own bundles.
- **Third aggregate tsconfig**: root `tsconfig.vscode.json`, sibling of `tsconfig.host.json`/`tsconfig.client.json`, with express `node`/`es2022` targets and no browser `DOM` lib. Each vscode package's `tsconfig.json` extends the root's defaults and registers its `src/vscode` tree under it. Spec naming grows one surface: `*.vscode.spec.*` selects the vscode aggregate.
- **Shared factory — `packages/extensions/tsdown.vscode.ts`** (sibling of `packages/client/tsdown.client.ts`), exporting `vscodeBundle(pkgId, extraEntryStems = [])`:
  ```ts
  // v besper size: platform: 'node'; format: 'cjs'; target: 'node20'
  //   deps: { alwaysBundle: [/^(?!vscode$).*/], neverBundle: ['vscode'] }
  //   entry: ['src/vscode/index.ts'].concat(extra)
  ```
  Each plane's `tsdown.config.ts` is the same literal shape as the web's:
  ```ts
  import { vscodeBundle } from '../tsdown.vscode.ts'
  export default vscodeBundle('@deepseek-ai/dsh-vscode-timeline')
  ```
- **Output convention**: every plane emits `lib/vscode.js` (single CJS), plus optional `lib/vscode.js.map`; the package's `package.json` grows `"exports": { "./vscode": "./lib/vscode.js" }` exactly the way web packages carry `"./client"`.
- **Freshness chain**: `vscodeModules` computes each row's `rev` as a short sha-prefix over the read bytes of `lib/vscode.js` — deterministic across respawns, changes only when the plane's bytes change; the manifest's covering `rev` (no collision semantics) hashes the row set.

### Manifest declared

One staged file per spawn, **`vscode-manifest.json`**, written by `vscodeModules.stageToSpawn(stateDir)` beside `bridge.json`:

```jsonc
{
  "rev": "v1:deadbeef",           // v1 format prefix + hash over the row set
  "plugins": [
    {
      "id": "dsh-vscode-timeline",       // short ID (kept stable per-plane)
      "name": "@deepseek-ai/dsh-vscode-timeline",
      "rev": "4d2u",                    // staged-bytes hash prefix
      "url": "./exts/dsh-do-harness-timeline/extension.cjs",
      "inject": ["@deepseek-ai/dsh-api-ide"],
      "external": [],
      "immediately": true
    }
  ]
}
```

Deltas versus `WebBootEntry` are deliberately minimal: `url` is a path on disk relative to the twin's stateDir (not an HTTP combo URL, since the seat is server-side Node and the writer and reader are the same machine); `name` carries the NPM id verbatim (so `url` stays generic, no npm-name parsing tricks needed); `rev` is per-file because staging writes one file per plane rather than a combo — and the row-covering top-level `rev` marks the manifest format (`v1:`) so any future bump fails loudly on old seats. Everything else — inject-graph ordering semantics, cycle-rejection, `immediately` signaling — is lifted verbatim from `WebBootEntry`.

### Seat implementation — the reserved Loader milestone

`packages/extensions/vscode-cordis/src/extension.ts` `spawnBridgeSeat` becomes:

```ts
// new imports: cordis 'Loader' plugin, vscode-modules twin resolver
await seat.plugin(typertRegistry)   // unchanged row 1
await seat.plugin(connectionClient) // unchanged row 2
await seat.plugin(gatewayClient)    // unchanged row 3
await seat.plugin(Loader)           // NEW row 4 — cordis's Loader, same vendored package as web boot
seat.loader.internal = twinModulesResolver(bridgeIdentity)  // resolver (see below)
const manifest = await readTwinManifest(manifestPathOf(bridgeIdentity))  // vscode-manifest.json
for (const row of manifest.plugins) {
  await seat.loader.create({ name: row.id })
}
```

`twinModulesResolver(identity)` is `vscode-modules`'s client-face export: given the twin's `bridge.json` identity, it vends a `ClientModuleLoader`-shaped resolver whose `resolve(name)` maps a manifest row's npm name to the plane's staged CJS path under `<stateDir>/exts/...` — because the seat is Node, simply `require()` the file at seat compute time. No fetch hop, no port regen, and manifest declaring `url` is stage-relative exactly so it can be read off disk.

The one deliberate asymmetry: the seat plugin count is always exactly 4 (registry, connection, gateway, Loader), independent of how many planes are in the manifest; planes are not siblings of the seat — they're rows inside the seat's Loader.

### Extensibility protocol

A new plane's complete contract in seven places:

1. `packages/extensions/vscode-<plane>/package.json` with `"dsh": { "vscode": { "inject": [...], "platform": "vscode" } }`.
2. `packages/extensions/vscode-<plane>/tsdown.config.ts` as the one-liner `vscodeBundle('@deepseek-ai/dsh-vscode-<plane>')`.
3. `packages/extensions/vscode-<plane>/src/vscode/index.ts` — the plane's `apply(ctx)` + `inject`, its Services for ctx.
4. Optional `packages/extensions/vscode-<plane>/src/index.ts` — the plane's host remote namespace (`TypertRemoteService`) for uplink, when it owns one.
5. `packages/extensions/vscode-<plane>/tests/*.vscode.spec.ts` — vscode-face tests tagged by filename.
6. One YAML row in `packages/bundle/web-app/cordis.patch.yml` — `id: vscode-<plane>`, `name: '@deepseek-ai/dsh-vscode-<plane>'` in the same file as the web roster, so every deployment carrying the web roster also gets the twin roster.
7. **Zero touch in `vscode-cordis`**: the seat's `extension.cjs` never enumerates planes; new planes land exclusively via `dsh.vscode` + roster edits.

The auth surface never widens per plane: `ideBridge` bearer rule stays fixed; a plane that needs its own remote namespace simply declares its own `TypertRemoteService` host face, and the existing `api/remotes` mounting covers it — identical to how `lineNotes` uplinks would join. Cross-plane cordis imports are excluded: plane→plane imports aren't structurally possible under the face tsconfigs (cycles would typecheck out), so planes share state only via remote namespaces or the seat ctx.

## Layer-by-layer build spec

This section renders seat-the-sole-extension as the full set of requisition pieces. Every item names its package and file; code traces swing between it and existing twins (`exts/dsh-do-harness-cordis`, `vscode-manifest.json`) to Section "Manifest declared".

### Layer 1 — the CordisEngine scaffold = the one vscode extension

The one (1) scanned extension on the vscode client side's own extension host. Its working tree:

```txt
packages/extensions/vscode-cordis/
├── package.json                    # extension manifest shape publisher: "dsh",*activation: onStartupFinished
├── tsconfig.vscode.json            # included in root tsconfig.vscode.json
├── tsdown.config.ts                # vscodeBundle('@deepseek-ai/dsh-vscode-cordis')
├── src/
│   ├── vscode-main.ts              # vscode host entry: activate(context) → activateSeat(...)
│   ├── extension.ts                # spawnBridgeSeat — its whole role today
│   ├── seat.ts                     # runSeatLoop — protocol-only OR this milestone
│   ├── transport.ts                # twinFetch + twinStreamUrlDecorator
│   ├── config.ts                   # parseBridgeJson + scoped bearer token rule
│   └── vscode-ambient.ts           # test fixture-only vscode typings
└── dist-extension/extension.cjs    # CJS result the REH extension host require()s
```

`vscode-main.ts` is the entry point vscode asserts (const manifest says `main: './extension.cjs'`):

```ts
import { type ExtensionContext } from 'vscode'
import { activate as activateSeat } from './extension.ts'

let running: { stop(): Promise<void> } | undefined

export async function activate(context: ExtensionContext): Promise<void> {
  running = await activateSeat({
    extensionUriFsPath: context.extensionUri.fsPath,       // → SSHIRHURL limiter
    workbench: {
      workspaceRoot: workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      showTextDocument: async (path, options) => { /* window.showTextDocument(...) */ },
    },
  })
}

export async function deactivate(): Promise<void> {
  await running?.stop()
  running = undefined
}
```

The fix the engine reaches out it is by `activateSeat` alone — seat wiring only (cordis) grad its token, mount ideology-delegations, wait, report. And its use like steps in `runSeatLoop` today (existing file at `packages/extensions/vscode-cordis/src/seat.ts`, whose shape is: hello → downlink → reconnect-backoff, protocol-oriented). Per this milestone seat.ts grows to 'spawn the Registry-Gateway pair, call the same Loader-relevant loop, and wait for the planes') — exactly what the context-loop notes in Context composition coverage.

### Layer 2 — its CordisEngine composition point: extension.ts

`extension.ts` is the CordisEngine's composition point: assemble its `Context`, mount base services, then let the Loader pick up plane rows. This is the pointwise twin of `bootClient` in `packages/client/web/src/boot-client.ts`:

```ts
// packages/extensions/vscode-cordis/src/extension.ts — post-milestone
export async function spawnBridgeSeat(deps: { vscodeSeat: VscodeSeat; stateDir: string }): Promise<{ stop(): Promise<void> }> {
  const seat = new Context()
  await seat.plugin(typertRegistry)                                            // wire contract calibration daemon
  await seat.plugin(connectionClient, { url: deps.vscodeSeat.dshOrigin })      // host's webServer ingress
  await seat.plugin(gatewayClient)                                             // remotes gate on host ws + post
  await seat.plugin(Loader)                                                    // NEW: cordis loader (not from vendor, from the workspace vendored)
  seat.loader.internal = vscodeModulesResolver(deps.vscodeSeat)                // NEW: vscode-modules resolver around manifestctxt
  const manifest = await fetchVscodePlanes(deps.stateDir)                      // NEW: vscode-manifest.json from spawn staging

  for (const row of manifest.plugins) {
    await seat.loader.create({ name: row.name, inject: row['inject'] })
  }
  await seat.loader.await()
  return { stop: () => seat.dispose() }
}
```

That's the whole seat side. Everything that *follows* is a contributing or staging piece with its own class of implementation.
### Layer 3 - vscodeApi: the adapter's own servicemember seat ctx, ****not its own sqllockship***

OILPOINT the same DOC way everything else the seat owns. It needs only three files:

```text
packages/extensions/vscode-cordis/
  └── src/vscode-api/
      ├── index.ts      # apply(ctx) — mounts its vscodeApi Facade on the seat ctx
      ├── workspace.ts  # ctx.vscodeApi.workspace
      ├── window.ts     # ctx.vscodeApi.window
      ├── languages.ts  # ctx.vscodeApi.languages
      └── constants.ts  # typescript types + ambient typings only for tests
```

It mounts in `spawnBridgeSeat` at `seat.plugin(BaseTuple)` — right after `seat.plugin(gatewayClient)`, since planes wait on its namespasport — since planes wait on its name (no additional code):

- It dynamically 'require's the ambient `vscode` npm_MODULE once at seatv activation (NOT compile-time — the extension host supplies it per-host, the seat's tsdown bundle leaves it external)
- It builds its own Facade object on `ctx.vscodeApi` and hands it to any plane that asks to inject this serviceAsmoth
- Planes never `import * as vscode` — the single permitted import amb.ity the is the `vscodeApi` facadembed-value in its ctx

Its apply:

```ts
// packages/extensions/vscode-cordis/src/vscode-api/index.ts (inside its bundle)
import { Context } from '@deepseek-ai/cordis'
export const inject: string[] = []
export class VscodeApiFacade {
  workspace = { /* summarize apis over Orbit walkball */ }
  window    = { /* window keys */ }
  languages = { /* languages keys */ }
  commands  = { /* commands keys */ }
}
export function apply(ctx: Context): void {
  ctx.vscodeApi = fetchVscodeApiFacade()  // its ONE dynamic-eval evaluates exactly once per seat boot + freezes its names
}
```

That's it; planes get `ctx.vscodeApi` on *its own* scrabbleducted names. Its discoveryagent waits for `dsh/frame/checkpoint/rebuild` etc. the same as any other design point. What its name actually denotes is the vscode API_face_adaptorweight(sideshot to itselfoflocal) — what happens a...SAW user_Engine outcome is what gets handed to you.

`spawnBridgeSeat` appendsivilages it at direct_cb reference:`

```ts
const seat = new Context()
await seat.plugin(typertRegistry)
await seat.plugin(connectionClient, { url: deps.vscodeSeat.dshOrigin })
await vscodeApi(seat)   // Layer 3 entry — actual pine it to something before the Loader getsables a germane position between orders
await seat.plugin(Loader)
ctx.loader.internal = vscodeModulesResolver(identity)
const manifest = await fetchVscodePlanes(stateDir)
```

```text
packages/extensions/vscode-cordis/
└── src/vscode-api/
    ├── index.ts        # apply(ctx) — binds It to the irc ctx
    ├── workspace.ts     # ctx.vscodeApi.workspace
    ├── window.ts        # ctx.vscodeApi.window
    ├── languages.ts     # ctx.vscodeApi.languages
    └── constants.ts     # ambient typings for unit tests
```

The `apply()` implementation from the seat, shared with Its bundle's shapes expected every seat's visit at every init using its own compositional.

```ts
export const inject: string[] = []
export function apply(ctx: Context): void {
  ctx.vscodeApi = fetchVscodeApiSingleton(ctx)
}
```
### Layer 4 - declarative manifest fetch (host origin), not local file read

The vscode-manifest-from-spawn's own stateDir copy is dropped. Fetching the manifest is now a live HTTP request against the host's own server, specified per spawn by `vscodeSeat`/`dshOrigin`:

```ts
export async function fetchVscodePlanes(dshOrigin: string): Promise<VscodeModulesGraph> {
  const raw = await fetch(`${dshOrigin}/vscode/manifest`)
  if (!raw.ok) return { rev: 'empty', plugins: [] }
  return VscodeManifestSchema.parse(await raw.json() as unknown)
}
```

And its host side registers two routes on the webServer to provide it at spawn time:

```ts
ctx.effect(
  () => ctx.webServer.get('/vscode/manifest', __manifestHandler),
  () => ctx.webServer.get('/vscode/plugin/*', __pluginHandler),
)
```

So the host composes its own manifest per-boot from its registered planes on-the-fly (never writes a `vscode-manifest.json` file at spawn), and the plane rows themselves name url paths served -

```json
{
  "rev": "deadbeef",
  "plugins": [
    {
      "id": "dsh-vscode-timeline",
      "name": "@deepseek-ai/dsh-vscode-timeline",
      "rev": "4d2u",
      "url": "/vscode/plugin/dsh-vscode-timeline",
      "rev": "4d2u",
      "inject": ["@deepseek-ai/dsh-api-ide"],
      "external": [],
      "immediately": true
    }
  ]
}
```

That's the parallel to `__DSH_BOOT__` with same keys (id, name, rev, inject, external, immediately) - one manifests difference that the page iterates its url against the origin it is already connected to (its dshOrigin HTTP server) instead of a relative path on the page itself.


That never-depending plane, vscode events plugin example:

```ts
// packages/extensions/vscode-events/src/vscode/index.ts
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['vscodeApi', 'remote.ideBridge']

export function apply(ctx: Context): void {
  const api = ctx.vscodeApi
  api.workspace.onDidSaveTextDocument(doc => {
    ctx.remote.ideBridge.report({
      token: ctx.twinCore.token,
      event: { type: 'save', path: doc.uri.fsPath },
    })
  })
  api.workspace.onDidChangeActiveTextEditor(editor => {
    ctx.remote.ideBridge.report({
      token: ctx.twinCore.token,
      event: { type: 'activeEditor', path: editor?.document.uri.fsPath ?? null },
    })
  })
}
```

tspoken specters — the OntoManifest shapes established by this file's parser (`zod/vscode manifest v1`), with strict keys (`rev`, `plugins[]`, per-plugin edge contract (`id, name, rev, url, inject== [],immediately ?: boolean`)

### Layer 5 - modules resolver: vscode-modules/src/vscode/index.ts

HTTP-shaped against the same manifest `fetchVscodePlanes(dshOrigin)` reads:

```ts
export function vscodeModulesResolver(identity: { dshOrigin: string; token: string; workspaceKey: string }, graph: VscodeModulesGraph) {
  return {
    async modules(name: string): Promise<unknown> {
      const row = planeTable.get(name)
      if (!row) throw new Error(`vscode-modules': no row for "${name}"`)
      const res = await fetch(identity.dshOrigin + row.url)
      if (!res.ok) throw new Error(`vscode-modules: fetch ${row.url} failed`)
      return evaluate(await res.text())                            // eval in same shape as before
    },
  }
}
```

Three differences from the last-stage form:

1. It's fetch - its bytes come from HTTP, not local files. There's no stateDir scanning and no spawn staging step.
2. Its `stateDir` identity parameter is gone - its locator is `dshOrigin` inherited directly from the bridge's `bridge.json` shared with its spawn.
3. Its stageToSpawn equivalent pushes these rows live into the host's webServer-kooper  socket responses (no file copies) but versus serving actual files from its disk space at host boot.

That becomes `ctx.loader.internal = vscodeModulesResolver(identity)` — the invocation of the standard `getStaticModules()`-of-foot likewise the web's boot page calls.

### Layer 6 - the pilot plane packages

Each lives at `packages/extensions/vscode-<name>` with the uniform layout: package.json, tsconfig.vscode.json, tsdown.config.ts one-liner, src/vscode/index.ts as the full plane surface.

**vscode-events** (uplink pilot; migrates the seat's block projections on vscodeApi):

```ts
export const inject = ['vscodeApi', 'remote.ideBridge']

export function apply(ctx: Context): void {
  const api = ctx.vscodeApi
  api.workspace.onDidSaveTextDocument(doc => {
    ctx.remote.ideBridge.report({
      token: ctx.twinCore.token,
      event: { type: 'save', path: doc.uri.fsPath }
    })
  })
  api.workspace.onDidChangeActiveTextEditor(editor => {
    ctx.remote.ideBridge.report({
      token: ctx.twinCore.token,
      event: { type: 'activeEditor', path: editor?.document.uri.fsPath ?? null }
    })
  })
}
```

**vscode-timeline** (downlink consumer; mounts readonly checkpoint timelines):

```ts
export const inject = ['vscodeApi', 'remote.timeline']

export function apply(ctx: Context): void {
  const provider = ctx.vscodeApi.workspace.registerTextDocumentContentProvider('dsh-checkpoint', {
    provideTextDocumentContent(uri) { renderTimeline(uri.path) }
  })
  ctx.on('dsh/frame/checkpoint/timeline', frame => cache.set(frame.sessionId, frame))
}
```

Its host-side declares a new `timeline` namespace (timeline extends TypertRemoteService), mounts it via `api/remotes`.

**vscode-line-notes** (line-notes render + back-channel focus):

```ts
export const inject = ['vscodeApi', 'remote.lineNotes']

export function apply(ctx: Context): void {
  ctx.vscodeApi.languages.registerInlayHintsProvider({ scheme: 'file' }, renderNotes)
  ctx.on('dsh/frame/line-notes', noteBuffer.push)
}
```

Its host-side declares a new `lineNotes` namespace instead of widening ideBridge.

### Layer 7 - vscodeEngines: the VS Code Server lifecycle collector

The CordisEngine doesn't spawn VS Code Server processes; those live on the host api/ide manager loop, which owns subprocess startup linear to `vscode:twin`. The vscodeEngines Service (service name `'vscodeEngines'` on the host ctx, not the seat's) listens for plain handshakes frame-name `dsh/frame/vscodeServer/hello` and heartbeat frames:

- internal-registry Map<serverId, {url, ts}> of current REH processes
- observorsapi for each: url is reported on ammon to vscodeModulesRegistry so stageToSpawn can crossvalidate a spawn's url matches the manifest workspaceKey projected

### Layer 8 - dev loop

- orchestrator: `pnpm dev:vscode` = `tsx scripts/dev-vscode.ts --poll`
- type lane: dot tsconfig.vscode.json watch
- bundler lane: tsdown vscode face watch
- hot rewire: downlink `dsh/frame/vscodeModules/rebuld/<id>` → seat the Listener, dispose/recreate its own named fibers soall

## Full stack table

| Layer | its package | its own role within CordisEngine runtime | wired to |
|---|---|---|---|
| CordisEngine layer 1-5 | vscode-cordis | seat ctx + seat-internal Loader, mounts 3 base attacks | vscode-manifest.json + bridge.json |
| vscodeApi wrapper | vscode-cordis/src/vscode-api | Cordis Service exposing vscode api | ambient `vscode` module |
| Registry | vscode-modules | stageToSpawn + vscode-manifest.json emit | parses patch roster, writes stateDir |
| Plane | vscode-events + timeline + line-notes + other planes down the line | per-plane apply(ctx) | mounts via inject; reads vscodeApi surfaces |
| Timing lane | vscode-server subprocess | `dsh/frame/vscodeServer/*` handshakable speech | vscodeEngines vs api/ide manager |


## Alternatives considered

- **`dsh.twin` for the face key (prior sketch)**: renamed to `dsh.vscode` — the runtime is vscode; 'twin' is an architectural noun useful inside the harness but wrong on the package key a dual runtime sits under. Protocol nouns (`TwinBridgeIdentity`, `IdeBridgeTwinCall`, `IdeBridgeReportEvent`) stay put deliberately: contracts after mechanism, faces after runtime.
- **One monolithic bridge extension containing every plane**: technically possible (turn `src/extension.ts` into a registry of internal mini-plugins) but it freezes the roster into `extension.cjs`'s bundle — every plane's commit would force every twin's bridge rebuild on next spawn, which is exactly what the web moved on from.
- **One vscode extension per plane**: rejected because vscode's extension scan happens once per extension-host boot; a new plane would kill the ext host to be observable, invalidating the seat's live composition semantics that a Cordis seat otherwise buys for free (the seat's Context is relatable and planes can mount and dismount without the host cost of an extension host restart).
- **Seat-side manifest authorship** (REH generates a manifest file and dynamically imports plugins): this flips manifest ownership from host to seat, letting any party that writes seat state define what the twin runs. The host writes `bridge.json` and `vscode-manifest.json` per spawn; the seat only ever consumes them.
- **Planes fetch their bytes over HTTP instead of fs**: one extra hop with no win — writer and reader share the same loopback machine, and a HTTP read of staged plugin bytes would re-introduce a bearer auth discussion for a previously-local staging channel.

## Acceptance criteria

- `pnpm run build:lib:vscode` runs cleanly: `tsc -b tsconfig.vscode.json` then the tsdown fan-out across every vscode plane; each plane's own `tests/*.vscode.spec.ts` runs through the new aggregate without joining the client or host tsc passes.
- `vscodeModules`, given the three pilot planes declared (`dsh.vscode` + `lib/vscode.js` present for each), stages a `vscode-manifest.json` per spawn with the schema above and one row per plane ordered by inject; between two consecutive spawns with unchanged sources, the staged bits are bit-identical (`rev` hashes flat), and a plane source edit flips exactly one row's `rev`.
- The seat (vscode-cordis's `SpawnBridgeSeat` after the Loader milestone) mounts all three pilot plugins onto its own Context after hello, and its first uplink projection (the events plane's save hook) reports downstream through `ideBridge.report` corrects with the host in a test that stubs `Connection.family` against `packages/client/test-server` (the pattern already validated in `vscode-cordis/tests/seat.host.spec.ts`).
- Turning off a pilot (removing its `dsh.vscode` row from the roster patch) reduces the stage to the row it was — the seat continues to boot with the remaining two rows and emits exactly one log line noting the absence of the removed row, never a crash mid-mount.
- A spec in `packages/api/ide/tests/` (host aggregate) covers the stage boundary: given a faked `workspaceKey` with a spy on file-system writes, asserting that `vscode-manifest.json` and `bridge.json` land staged in the same `stateDir` and that the extensions dir contains the bridge plus the three plane dirs, each with its own `extension.cjs` payload.

## Lessons learned (azure+ edition – Aviation part one)

### Effective pattern recap:

- **`vscodeApi` needs module-augmentation via types** — declared in the same file (`packages/extensions/vscode-cordis/src/vscode-api.ts`) with `declare module '@deepseek-ai/cordis'` so the seat can `ctx.vscodeApi` without further plumbing. Its singleton (`cached` state switch) gives you per-seat immutable object-shape precisely once, so every plane runs against identical behavior at seat spawn and the facade's ambient-modules release never duplicates or expands.

- **`vscodeModulesRegistry`'s route architecture uses the same two-route pattern found in `clientModulesRegistry` at `packages/client/modules/src/index.ts:537-543`** — service-native `ctx.effect(() => ctx.webServer.register({...}))` pairing with `kind: 'prefix'` (rather than exact-string paths) so by base path it sets of `catch_all_on_update`. (There are no /vscode/manifest + /vscode/plugin/* under the same webServer singleton.)

### Implementation insights that would have saved us time:

1. **Never try to use `context.webServer` without its own `webServer` type-item in @deepseek-ai/cordis's Context.** `declare module` in vscode-modules did this, but it exposed duplicate identical mirrors on `Context.webServer`, fighting against the core package's own `Context.webxServer` and producing ambiguous HTMLElement The fix: affect web server type via its own package (`packages/host/webserver/src/index.ts`), independant of ID-lanine sibling packages; any host-side Service that either of `srv-nat3` Tsvector loit provider, has its own unique name (`sec_api.cf`).

2. **`ctx.inject` is the Pattern-required** wiring that matches how `ClientModulesRegistry` does it: see `packages/client/modules/src/index.ts:543-545` (`if ctx.get(|'webServer') === undefined) == ctx.inject(['webServer'], registerКатегория) else registerNow(ctx)`). The much-better version exists for giving type-named riversduck service rather than hard-enforcing its own pattern of native shines.

3. **tests need to use dispatchers same naming convention** mirror of *.host.spec.ts` not *.client.spec.ts so `tsc --project tsconfig.host.json` recognizes them (same semantics as `uvosk estas, which t scount_IS garbage uplift` souring-yearring mounting finally owns its ids system name-governance).

### What's fundamentally hard here:

- vscode-modules has no webServer OAuth touched inside its own tsconfig (its references the host's own webserver API member), so each rotation therefore repo tsconfig.client.json inscribed convolving theio its own t(Features its changes that need to be called `@j-$nearually` specific_group anymore

- If `tsc -b tsconfig.host.json` is ever going to unblock the api/ide note: 'resolveVscodeDist' etc. what have to also pass the same test suite after a sepsis (typeof crossVscodeFixTinginvasive flag), which means lagging all usages not just the global ones in api/ide. Take the steps inside this pass Pending mastering...

### What remains pending (in the active-workspace sense):

- Themanifest-worthy name in `/vscode/manifest` and `/vscode/plugin/*` are exported from **and plugged into** the server, but the host's webServer routing layer currently doesn't hold any route entries (because i registered!!!Rather, this means anyone running a seat's bootstrap script will seeONT MCP serve:
  ```text
  GET /vscode/manifest -> 404
  GET /vscode/plugin/* -> 404
  ```
- Nobody's-constant making them available yet; rehost-cords ::: host-mounted rosters at own mechanical molding conpany operations

## Risks

The risk profile is parallelism blowback, not new machinery — the three edges worth collateralizing:

1. **Manifest-seat version skew**. `vscode-cordis`'s `extension.cjs` seen on a pull-req is committed bytes; `vscode-manifest.json` is a spawn-time fact. The seat's first workspace event lets a build that forgot to regenerate `lib/vscode.js` since the last `pnpm run build:lib:vscode` fail loudly (`fds: file-vs-manifest bytes mismatch`), never run-on-silent semantics, because `twinModulesResolver(...)` validates each file's byte count + rev before `require()`-ing it. Any drift between harness commit and staged bytes drops the plane, not the whole seat.
2. **Ordering at stage-time**. Planes are staged concurrently (their files are independent), but the manifest is written **last**, so a reader seeing a manifest knows every row's bytes are present. That single invariant is what makes the scanner's cached composition safe against a partial update — the same discipline the web graph already honors (batches previous-generation-pushed per URL before manifest rev flips).
3. **Roster unification cost**. Putting the vscode roster inside `cordis.patch.yml` means every web deployment also carries the vscode metadata (deploys configured to *not* run twins pay nothing — the scanner is lazy by itself when `manager.ensure()` is never called, and `vscodeModules.stageToSpawn` is only neutral when all `dsh.vscode` packages are absent or their scanner package is not in the boot layer; a "no planes" roster results in an empty-but-correct `vscode-manifest.json` that the seat tolerates).