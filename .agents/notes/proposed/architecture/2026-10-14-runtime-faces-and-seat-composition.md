# Agent Note: Runtime faces and seat composition — how one authored package becomes two engines' plugins

Status: proposed

## Problem

Every package in this tree that touches the network lives a double life: its host half runs inside the orchestrating Node process, its client half runs inside a browser — and, after `2026-10-13-vscode-twin-extension-cordis-seat` landed, inside the vscode twin's REH extension host as well. Each runtime composes its own Cordis `Context` tree; nothing is shared by address, only by protocol. The seam that lets one authored package stand in for plugins on both engines is scattered across four machinery families — the tsconfig/face source split, the `package.json` `dsh.*` metadata, the per-package `tsdown.config.ts` one-liners, and the boot-time manifest pipeline — and until now each note touching this surface restated fragments of it. This note composes them into one map.

## Terminology

Names first, because the redesign retires one word entirely and assigns precise meanings to three engines everywhere else. Every later section of this note plus every sibling note speaks exactly this vocabulary:

- **host** — the orchestrating Node process; one Cordis engine rooted at `boot()` (`packages/boot/app-boot`). It owns services, filesystem authority, and the `/api` webserver.
- **web client** — the Cordis engine run inside the browser tab (our own page), composed by `bootClient` over the shipped manifest. It has `dsh.client` as its face key, `tsconfig.client.json` as its aggregate, and is the only engine rendered on a DOM.
- **vscode web client** *(viewed variants)* — the Cordis engine run inside the embedded vscode REH-web instance (currently: one spawned vscode instance per workspace, iframe-mounted in web UI; previously called "twin"). Its face key is `dsh.vscode`, its aggregate `tsconfig.vscode.json`, and it is the only engine composed by a staged `extension.cjs` + `vscode-manifest.json` instead of a served roster.
- **vscode client** *(family noun)* — any engine composed through an REH extension host. The vscode web client is its first (and so far only) instance; a future `vscode client` variant might mean a desktop companion instance listening on an HTTP port. In identifiers use `vscodeClient*` / `vscode-*` for the web variant; reserve `vscodeNative`/`vscode-native` phrasing for future native ones.
- **seat** — one Cordis engine's root `Context` — the host seat, the web seat, the vscode web client's seat. "Seat" is a noun for a Context once it exists, not a build-time fact.
- **plane** — a package mounted as a Cordis plugin on one engine (e.g. `dsh-vscode-timeline`, `@deepseek-ai/dsh-client-ui-vscode`). On the vscode web client, planes are *not* vscode extensions — that rule remains hard.
- **stage** — the per-spawn file-delivery lane each engine family owns (`__DSH_BOOT__` injection for the web client; staged CJS + JSON files under `~/.dsh/cache/vscode-*` for the vscode web client). Staging is per-spawn, never at process startup.
- **manifest** — the frozen artifact of one engine's plane inventory: `window.__DSH_BOOT__` rows for the web client; `vscode-manifest.json` for the vscode web client; nothing equivalent for the host (its roster lands via YAML + Loader directly).
- **retired: "twin"** — the previous name for the vscode web client. It appears nowhere in code or docs after this rename; historic notes that cite old type names (`TwinBridgeIdentity`, `stageTwin*`, `vscode-twin` cache dir) are grandfathered with those names intact in situ, but prose read later should substitute "vscode web client" wherever a 2026-era note writes "twin".

Cross-cutting nouns that stay engine-agnostic, so they are never overloaded once the rename lands: **engine** (host / web client / vscode web client), **face** (one package's per-platform source half, `src/index.ts` host vs `src/client/index.ts` web / `src/vscode/index.ts` vscode web), **wire** (the two surfaces `POST /api/<ns>/<m>` and `WS /api/remote.mux`), **namespace** (the `<ns>/<method>` vocabulary of a `TypertRemoteService`), **stage** (write files to a per-spawn location), **resolver** (who maps names to code at activation), **manifest** (the frozen row list of one engine).

## Proposal

Land one consolidated architecture reference for the runtime-face system: the two-engine model, the per-package face conventions (`src/index.ts` / `src/client/index.ts` / reserved `src/vscode/`), the compile chain that produces each face's bytes, the ship pipelines that stage those bytes into each runtime, and the vscode-cordis extension as the third engine's seat. No code changes accompany this note — it is the grounded map that `2026-10-14-vscode-platform-mirror` (and the extension work of `2026-10-13`) hangs off, so every plane that follows a different runtime extension starts from the same authored picture rather than a re-derivation.

### Two engines, one vocabulary

Two `Context` roots exist concurrently and share no address-level identity. On the host, `packages/boot/app-boot/src/index.ts` drives the vendored cordis `Loader` against the leaf `cordis.yml` chain (bundle layers `base` to `web-app`, profile patch overlays appended). In the page, `packages/client/web/src/boot-client.ts` creates a fresh `Context`, installs the same vendored `Loader`, sets `loader.internal` to the code-arrival module system, and creates one entry per `BootManifest` row. The vscode twin adds a third engine: `packages/extensions/vscode-cordis/src/extension.ts` mounts the same minimal client-seat plugin tuple inside the REH extension host at activation.

The shared vocabulary between any pair is never objects — only namespaces and the wire. A namespace is declared exactly once, host-side, by a `TypertRemoteService` subclass: `class Ide extends TypertRemoteService` with `super(ctx, 'ideBridge')` in `packages/api/ide/src/index.ts` is the working exemplar. Its `@Remote`-decorated methods form the contract; every other engine mounts a generated descriptor of that contract onto its own `ctx.remote`. Three packages make the conversation legible on both ends:

- `packages/typert/protocol` — decorators, error/call-frame types, stream grammar (the '$events' + '$stop' + stream-header vocabulary).
- `packages/typert/registry` — the service-key registration in ctx both engines mount first.
- `packages/api/gateway` — the package that reads as two stacked programs under one npm name. Host face: `TypertGateway` self-discovers every registered `typertRemote` binding on the host ctx and owns `RemoteStreamMuxServer` at `/api/remote.mux`. Client face: `ClientRemoteService` accepts mounts (`remote.$mount(...)`) and renders remotes as `ctx.remote.<ns>`.

`packages/client/connection` supplies the split transports (`HostConnectionService` POST ingress plus upgrade fences; `ClientConnectionService` fetch+ws aboard on the client). Nothing else crosses between engines — no timers, no shared file handles, no CommonJS side effects. On top of that structure, auth admits two orthogonal carriers: the web's `dsh-auth-<authority>` cookie, and the scoped Bearer rule the twin uses (`ConnectionBearerRule` registrations from `registerBearerRule`, today exactly `['ideBridge/downlink','ideBridge/report']`).

## The face seam per package

A dual-faced package is not one file shoehorned into two engines; it is two sources of truth typeset by convention:

- `src/index.ts` — host face: exports the host plugin `apply`/`inject` and, where relevant, the `TypertRemoteService` class.
- `src/client/index.ts` — client face: exports the client plugin `apply`/`inject`, plus a `dsh.client` block on `package.json` (`inject`, `platform`, optional `external`) that marks the package as web-eligible.
- `src/vscode/index.ts` — reserved milestone; same shape when the vscode face lands.

Which file runs in which engine is decided by nothing more glamorous than resolution: the host loader imports the package root; the web engine imports whatever the code-arrival system hands it for that package name; the twin REH imports whatever the seat loader materializes. Neither face ever imports the other.

Eligibility is not implicit. `dsh-client-modules` (host half, `packages/client/modules/src/index.ts`) marks a loader entry as "client-shipped" only when that entry's `package.json` declares a `dsh.client` block (`parseDshClient` in `packages/client/modules/src/client/manifest.ts` is the gate; `packages/client/ui-vscode/package.json` is the live exemplar). Host-only packages never enter the scan. On the twin side, the reserved mirror key is `dsh.vscode` — spelled out in `2026-10-14-vscode-platform-mirror`.

## The compile chain per face

Compile once at the root; per-face engineering lives in the per-package one-line config.

1. Types and d.ts emission: root `tsc -b tsconfig.host.json` / `tsc -b tsconfig.client.json`. Each aggregate picks which specs it compiles by filename (`*.host.spec.ts`, `*.client.spec.*`), which is how one package's tests can live on both engines without config duplication. `packages/**/src/*.d.ts` is gitignored, so ambient declarations live in `.ts` files.
2. Runtime bundles: `pnpm run build:lib:client` runs `tsdown --env.DSH_BUILD_FACE client` across the worker, and every client-faced package's `tsdown.config.ts` is one declarative line — `packages/client/ui-vscode/tsdown.config.ts` is `clientBundle('@deepseek-ai/dsh-client-ui-vscode', ['lib/types/index.js'])`. All real engineering (entry convention `src/client/index.ts` → `lib/client`, platform, externals, dep-resolution rules) lives once in `packages/client/tsdown.client.ts`; packages pass their npm id and extra entry stems only. The vscode-cordis tile is the same shape shaken once more for the REH platform: `packages/extensions/vscode-cordis/tsdown.config.ts` produces `dist-extension/extension.cjs` with everything inlined except `vscode` (`deps.alwaysBundle:[/^@deepseek-ai\//]`, `neverBundle:['vscode']`).
3. The Typert half-step: remote-bearing host packages add `typertPlugin()` to their `tsdown.config.ts`. It reflects on the host class's decorated methods and emits `lib/typert.remote-client.js` (plus `typert.remote-events.*` when declared) — zod-coded argument/return contracts, namespace key, `mode:'stream'` marks. This generated artifact is the only wire contract a client engine ever imports, and it is committed to git (`packages/api/ide/lib/typert.remote-client.js` regenerated in commit `7ecc553b7a` to fold in `report`).

## What physically ships to each engine

Authoring says which packages exist; one host half decides what bytes each engine ever receives.

- Roster (static): bundle-layer `cordis.patch.yml` rows — `packages/bundle/web-app/cordis.patch.yml` declares the web roster as `- id: ... / name: '@deepseek-ai/dsh-client-...'` entries (the inline comments call it the "browser plugin roster" for good reason).
- Eligibility scan (host): `dsh-client-modules` listens to `internal/plugin` fiber lifecycle on the host loader, resolves each entry's owning package, gates on `dsh.client`, caches the verdict per loader specifier.
- Frozen manifest (server-rendered): each accepted package becomes a `WebBootEntry` (id, url, rev, inject, external, immediately per `packages/client/modules/src/client/manifest.ts`), `rev` derived from the combined artifact bytes — no timestamps. Rows land in the served page as an `IndexInjection` global `__DSH_BOOT__` plus combo script URLs `/plugins/?<ids>&rev=...` (`comboUrl`, `comboScript` in `packages/client/modules/src/index.ts`).
- Consumption (page): `boot-client.ts` reads `__DSH_BOOT__`, points `loader.internal` at `ClientModuleLoader` (the code-arrival system the modules package publishes), and runs `loader.create({name})` per row. Same `Loader` class on both sides; only `loader.internal` is per-engine.

### From built to shipped — how bytes actually reach each engine

The one load-bearing insight above: engines are never joined in memory; they are joined — once — by an HTTP rope and a manifest. The full handoff for the web client (the vscode client keeps the same six-step semantic with three physical substitutions; full spec in `2026-10-14-vscode-platform-mirror.md`):

**Stage A — built stays on the host disk.** `pnpm run build` exits with everything on disk: `lib/client.js` per client-faced package (factory-wrapper CJS) and its sourcemap. No execution triggered, no signatures computed at build time — compiler output sits exactly where `tsc` + `tsdown` dropped it.

**Stage B — host reads the bytes back and re-exports them over HTTP.** When `dsh web` boots, the `dsh-client-modules` host face's Service (`ClientModuleRegistry`):

1. **Scans the host loader's own entries** (`ctx.loader.entries()`), resolves each row's owning `package.json`, gates on `dsh.client.platform === 'web'`, and **reads `lib/client.js` back into memory** — one in-memory record per package.
2. **Re-packs the bytes into its own artifacts**: `compose()` sorts rows (`orderByModuleGraph`), concatenates several plugin sources into one or more combo scripts, hashes the contents into a `rev` (content-addressed: identical bytes, identical hash), and assigns each combo a URL — `comboUrl([...])` → `/plugins/??pkg-a,pkg-b&rev=<hash>`. Assembled bodies sit in host RAM (`responses`/`batchResponses`), keyed by URL.
3. **Mounts one HTTP route**: `webServer.register({ kind: 'prefix', path: '/plugins', handler: serveBundle })` — the host also becomes a static server of exactly those combos, alongside `/api`.
4. **Injects the pointer set into the served page** at `index.html` render: a queue-facade script (`window.__ModuleLoader__ = { mode: 'queue', pendingQueue, load(reg), create(opts) }`), combo preload/script tags, and the manifest global `window.__DSH_BOOT__ = { entries: [{id, url, rev, inject, external, immediately}] }`.

**Stage C — the web client consumes them from inside its own engine.** Page load:

1. The boot-page reads `window.__DSH_BOOT__`, calls `__ModuleLoader__.create(...)` — pops the bootstrap entry (`dsh-client-modules`) off the queue, runs its factory, and uses its exports to construct `ClientModuleSystem` (the client module table).
2. `bootClient(ctx, ...)` installs the same vendored cordis `Loader` class on a fresh hostless Context, and sets `loader.internal = modules` — `create(name)` on a loader entry now resolves by HTTP fetch.
3. For every manifest row, `loader.create({ name })` triggers `loadBundle(url)` (one `<script>` insertion per URL), fetching the combo from `/plugins/...&rev=...`; each combo body hands its plugin factory to `__ModuleLoader__.load(id, factory)` on execution — registration only — materializes lazily (`factory(require)` → `exports`), and returns the module to the Loader, which composes `apply`/`inject` onto the page Context.

Four anchors to internalize: the host **builds** offline; the host's webserver **re-serves** the bytes at boot over HTTP; the page **discovers** them via injection globals before any factory executes; the receiving engine's own Loader vindicates **what composes** — the crossing is one rope, one manifest, nothing shared in memory.

The vscode client follows the same six-step semantic with three physical substitutions (full spec in `2026-10-14-vscode-platform-mirror.md`):

- the bundle is `lib/vscode.js` (CJS per plane, Node typography) instead of `lib/client.js`;
- writer stage = `vscodeModules.stageToSpawn(stateDir)` per spawn, dropping `<stateDir>/exts/<plane>/{package.json, extension.cjs}` plus `vscode-manifest.json` beside `bridge.json` — filesystem custody instead of HTTP, because writer (`api/ide`) and reader (vscode client REH host on localhost) live on the same machine;
- reading stage = the seat reads `vscode-manifest.json` once at start, then `require()`s each staged CJS in manifest order — same `Loader.create(...)` per row, same `loader.internal` shape, no fetch hop, no port.

## ### From `pnpm run build` to a running client plane, in plain terms

The six-step mental model before the code narrative:

1. **Build writes files, not runtime**. `pnpm run build` runs `tsc` per face aggregate + `tsdown` per package with each package's own one-line `tsdown.config.ts` (`clientBundle('<pkg>')`). Output: `lib/client.js` per client package — a factory-wrapper CJS file that does nothing when executed, it only *registers itself* when the right parent calls it. Also its sourcemap. Nothing is signed at build time, nothing is downloaded, nothing is alive — compiler output sits on disk.
2. **The host boots, reads bundles back, and hands URLs for them**. `dsh web`'s host compose mounts `dsh-client-modules` (host half). It scans the host loader for `dsh.client` rows, reads each package's `lib/client.js` back into memory, and mounts one static-server URL per combo set: `/plugins/??pkg-a,pkg-b&rev=d4f3ab12cd34`. "Combo" = several bundles concatenated — one script tag covers N plugins.
3. **The `rev` is a cache key, not a signature or a version mark**: the first 12 hex chars of a sha1 over the combo's exact bytes. Identical bytes → identical rev. Any source edit anywhere inside crosses into a different rev. It's a content-addressed cache key; the page's *whole* invalidation scheme is invisible and per-set (if the whole combo rebuilds at the same rev, zero bytes move for the page again). Isolated from all authorization and integrity concerns.
4. **The manifest is a pointer-file for URLs, not a dependency graph**: a JSON object injected into the served `index.html` as `window.__DSH_BOOT__ = { entries: [{id, url, rev, inject, external, immediately}] }`. One object per boot. The page knows which plane rows exist and which URL each ships from; it does not know dependencies nor contents from it.
5. **The vscode client splits at the broadcast hop**: writer stage becomes `vscodeModules.stageToSpawn(stateDir)` — no HTTP, bytes land as `<stateDir>/exts/<plane>/extension.cjs` + `vscode-manifest.json` beside `bridge.json`; reader stage (the vscode client REH host on localhost) just `require()`s the staged files. Same six-step story, HTTP replaced by filesystem custody because writer and reader are both machine-local processes.
6. **At compose time the vendored cordis `Loader` picks up** — not the bundler, not the static entry: `loader.create({name})` per row, using the same `Loader` class the host runs; only `loader.internal` differs per engine (host's include/group, page's `ClientModuleSystem`, twin's per-spawn file resolver).

A one-line shorthand: **manifest = the page's pointer-set to bytes delivered by build-and-serve**, rev = **the coarse checksum on those bytes that invalidates stale URLs**.

### The vscode analog — same four steps, one reservation

`packages/extensions/vscode-cordis` is the third engine's seat, mapped stage-for-stage onto the web chain:

- Build: `tsdown.config.ts` compiles `src/vscode-main.ts` to single-file CJS `dist-extension/extension.cjs` (498 kB; only `vscode` externalized because the platform provides it at activation).
- Per-spawn staging (runtime): `stageVscodeExtension(extensionsDir)` in `packages/api/ide/src/twin-theme.ts` writes `<stateDir>/exts/dsh-do-harness-bridge/{package.json,extension.cjs}` fresh on every spawn — twin content is bit-for-bit the harness commit at spawn; upgrades land on next respawn. Beside it, `stageVscodeIdentity` writes `<stateDir>/bridge.json` carrying `{dshOrigin, token, workspaceKey}`, `bridgeIdentityPath(extensionDir)` resolves it as one level up from the extension dir.
- Seat composition (third engine): `spawnBridgeSeat` composes the minimal client seat programmatically (`typertRegistry`, `connection` client, `gateway` client) without Loader machinery — there is exactly one row (the bridge itself), so Loader would idle under it. The seat then mounts `ideRemote` (the generated descriptor), `runSeatLoop` in `src/seat.ts` drives `hello` + the downlink stream + `dsh/frame/<type>` local emits, and `transport.ts` `twinFetch`/`twinStreamUrlDecorator` extend the standard transports to use `bridge.json` (`Authorization: Bearer` for unary; `?tkn=` on the mux upgrade URL).

The one reservation that maps to the Loader milestone from the earlier seat note: the twin currently mounts exactly one seat-internal plugin tuple and has no roster of planes. That is the remaining work — and it is what the mirror note (`2026-10-14-vscode-platform-mirror`) resolves.

## Consumption chain at runtime (unified)

    host ctx                            client ctx                       twin ctx
    ==========                          ==============                   ===========
    cordis Loader (cordis.yml + patch)  bootClient (Loader)              spawnBridgeSeat
       | rows>                               | manifest>                      | seat tuple>
    packages own `super(ctx,'ns')`      plugins add `ctx.remote.<ns>`     seat lifecycle + `dsh/frame/*` emits
       `- @Remote -> typertPlugin -> lib/typert.remote-client.js
                 wire: POST /api/<ns>/<m>, WS /api/remote.mux?tkn=

`packages/api/remotes` is the catalog face: it mounts every generated `typert.remote-client.js` onto the client engine in one pass, and sibling packages (e.g. `ui-vscode`) declare `remote.ideBridge` in `dsh.client.inject` without mounting anything themselves.

## `pnpm run build`, stage by stage with plugin coverage

`scripts/build.ts` runs a strict chain; every stage has exactly one consumer, and no stage is skippable because its output feeds the next.

### Stage 1 — `build:native-system` (host-only)

Purpose: compile the OS-level native addon (`native/system`). Output: shared object under `native/system/.release`. Consumer: `dsh web` runtime's native addon injector.

### Stage 2 — `build:lib` — two face-bound passes

Order is enforced (`host` must precede `client`): the client pass reads its type baseline out of what the host pass emits into `lib/types`.

**2a — `build:lib:host'`** (`tsc -b tsconfig.host.json` + `tsdown --env.DSH_BUILD_FACE host`):
- `tsc` emits `lib/types/*.js` + `lib/types/*.d.ts` under every host package — this is the type catalog the remaining stages pick from.
- `tsdown` (env.DSH_BUILD_FACE=host) builds `workspace: ['vendor/*', 'packages/*/*', 'apps cli', 'apps/desktop', 'apps/desktop-host']` globs with `typertPlugin({ mode: 'workspace', faces: ['host'] })` already attached — so every `TypertRemoteService` host face is reflected here: one `lib/typert.remote-client.js` per remote-safe host package, one `lib/index.js` host entry per host package. Consumers: host service imports, `api/remotes`'s catalog `. $mount(...)` list.

**2b — `build:lib:client'`** (`tsc -b tsconfig.client.json` + `tsdown --env.DSH_BUILD_FACE client`):
- Runs on the client face's 64 packages (each `dsh.client.platform='web'`). Each package's own `tsdown.config.ts` computes its own entry; the packages without a client bundle emit `[SKIP_WORKSPACE_BUILD]` and pass through unscathed.
- Each client pkg emits: host-entry `lib/index.js` (`clientBundle('<pkg>[, entries]')`), **and** its registered-artifact `lib/client.js` (factory-wrapped CJS) at the client pass — only this face uses `lib/client.js` names.
- Consumer: `ClientModuleRegistry` reads back `lib/client.js` files, and the client facades (e.g. `ClientRemoteService`, `ClientConnectionService`) mount their services over `ctx.remote` against `@deepseek-ai/dsh-client-modules` resolver.

### Stage 3 — `build:web` (`vite build` in apps/web)

Emits the page shell only (`dist/index.html` + first-boot chunks). Zero of the 65 face packages' emissions appears in the page's own chunks above the shell's static-imported seeds (`@deepseek-ai/dsh-client-web`, `@deepseek-ai/dsh-css-vars`, and their platform peers). Injected at serve-time by the host via `__DSH_BOOT__`.

### Stage 4 — `postbuild`: `pnpm run vscode:twin`

Off the core orchestrator, fetch lane under `scripts/bootstrap-vscode-twin.sh` clones/pins/builds the vscode fork into `~/.dsh/cache/vscode-twin/dist`. Consumer: `api/ide` per-spawn materialization. `postinstall`'s `pnpm run vscode:twin:fetch` is the same lane constrained to fetch-only so first-run doesn't rebuild it.

## `pnpm run web` — what the server actually does with those artifacts

`pnpm dsh web` is zero build work: `dsh web` boots the host engine which now does the run-time ship. `dsh web` is where the build artifacts meet the network: the host loader mounts rows from `cordis.yml`, the `dsh-client-modules` composition registry reads each `lib/client.js` back into memory, mounts `/plugins/?<ids>&rev=<hash>` on its webServer, and composes `__DSH_BOOT__` for the page to use once it takes over. That's the only runtime-side piece in the whole scheme that consumes the build outputs directly — everything else was introspection to emit them.

## Per-plugin summary

| Plugin | tsc inklusive | tsdown inklusive | Runtime venue |
|---|---|---|---|
| `@deepseek-ai/dsh-api-gateway` | host + client | `clientBundle(...)` — Lib/client and Node shared | Host: TypertGateway, Client: ClientRemoteService. |
| `@deepseek-ai/dsh-api-ide` | host + client | host tsdown pass + Per-package `tsdown.config.ts` | `IdeBridgeService` + mounted `ideBridge` at both feet. |
| `@deepseek-ai/dsh-api-remotes` | host | none extra | `RemoteCatalog` mounts every namespace on both messages. |
| `@deepseek-ai/dsh-client-modules` | host | host half of the same package is the module compiler strategy itself; no topology delegates | Host: ClientModuleRegistry. |
| `@deepseek-ai/dsh-client-web` | client | `staticLinked(...)` | Web: AppWebEntry boot page. |
| The 34 remaining `dsh.client` ui-* packages | client only | `clientBundle(...)` per package | Plugin faces on the web seat. |
| `@deepseek-ai/dsh-client-connection` | host + client | `clientBundle(...)` | Host: HostConnectionService; Client: ClientConnectionService. |
| `@deepseek-ai/dsh-cordis-client-runner` | client | `clientBundle(...)` | Client-side runner shell. |
| `@deepseek-ai/dsh-vscode-modules` | host | host only | `VscodeModulesRegistry` schema (what vscode-manifest.json is named after). |
| `@deepseek-ai/dsh-vscode-events/timeline/line-notes` | vscode face | `vscodeBundle(...)` per package (reserved milestone) | Their planes on the vscode client seat. |
| `@deepseek-ai/dsh-typert-{protocol,registry}` | shared | shared | `TypertRegistry` at ctx, `TypertGateway` host. |

## Alternatives considered

- **Split per-runtime docs** (a "web architecture note" + a "vscode architecture note" + engine READMEs): each runtime has genuinely different staging, and per-runtime prose reads more naturally. Rejected because the seam that matters — how one `package.json` block declares eligibility for either — spans both runtimes; separate docs would each restate the shared Loader/compile chain and diverge as it evolves. The alternative that survives is a single map with per-runtime *sections*, which is what this note is.
- **Fold the map into the two existing vscode notes** (`2026-10-13-…seat` and the feature notes): those notes authorship the seat-detailed decisions (bearer rules, staging, `dsh/frame/*` emit conventions) and touching them with a full compile-chain sketch would duplicate what `packages/client/web`'s README owns on the web side. A dedicated note keeps the per-seam states orthogonal: seat note = twin entrypoint contract; platform note (the mirror) = tail-end work; this note = the architecture spine.
- **Add the full machinery to READMEs of the owning packages** (`client/modules`, `client/web`, `client/connection` …): package READMEs are the right home for module-export semantics (what `ClientModuleLoader` exposes, what `parseDshClient` accepts) but not for cross-engine map without which those exports have no anchoring — "why does `dsh.client` exist" is a whole-system question, not an export question.

## Acceptance criteria

- A reader who opened only this note can answer: why the host serves a page that never contains host-state references; how the page knows which `client.js` bundles to fetch; what a plugin author must write to opt a package into either engine (one `dsh.client` yaml block, one face source tree, one tsdown config one-liner); and where the vscode seat breaks that pattern and why (Bearer-bridge scope instead of full roster, no `api/remotes` catalog mount — one namespace only).
- Follow-on notes (plane packages, `vscode-manifest.json` milestone) can point here for every compile/staging detail instead of restating it — the note's Owns-this vs Points-to boundary stays clean: it owns the architecture, and points at `2026-10-14-vscode-platform-mirror` for `dsh.vscode`/`vscode-manifest.json` specifics.
- No contradictions with the landed code — every path, package, tsdown factory, and spec reference cited has been verified on `master` at the commit this note's draft was composed (all `pnpm` and `tsc -b` assertions in the Problem/Proposal map to grep-verified sources under `packages/`).

## Risks

Three edges matter across this surface. First, the `internal/plugin` fiber lifecycle drives modules-host scanning — heavy loader churn rebuilds the cached verdict and costs rescan work per entry flip, though it misses nothing. Second, `lib/typert.remote-client.js` as checked-in authoritative contract — a host `@Remote` shape that grows without regenerating the artifact leaves the client face stale; the regenerated file is committed alongside host changes precisely so drift shows as a diff someone has to explain. Third, per-spawn stamp identity — the twin's extension content matches the harness commit at spawn, so a twin spawned before a vscode-cordis commit must be respawned to receive upgrades; `IdeTwinManager` owns that lifecycle in `packages/api/ide/src/manager.ts`. The `vscode-manifest.json` milestone in the mirror note closes the roster edge: planes can then land on the twin without growing the bridge extension's bundle.