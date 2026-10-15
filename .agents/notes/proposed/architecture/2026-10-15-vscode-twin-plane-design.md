# Agent Note: VS Code twin plane design — one standard, six plugins, before and after

Status: proposed

Supersedes: [2026-10-15-vscode-plane-interfaces](2026-10-15-vscode-plane-interfaces.md) and [2026-10-15-vscode-connection-flow-planes](2026-10-15-vscode-connection-flow-planes.md), which this consolidates. Builds on [2026-10-13-vscode-twin-extension-cordis-seat](2026-10-13-vscode-twin-extension-cordis-seat.md).

## The one standard

**The bridge owns transport only. Every connection flow — downlink frame handling or uplink projection — is one plane.**

A plane is a cordis plugin package, never a vscode extension: a `dsh.vscode` block in package.json (`{ platform: 'vscode', inject: [...] }`), an inert host face (`inject = []`, empty `apply()` — present only so the roster sees it), and a vscode face built to a self-contained `lib/vscode.js` CJS bundle under `DSH_BUILD_FACE=vscode` (`vscode` the sole external). Downlink arrives as `dsh/frame/<extId>/<verb>` cordis events; uplink goes through `ctx.remote.<ns>.*`; vscode access goes exclusively through the frozen `vscodeApi` facade — planes never `import 'vscode'`.

Why planes can hear the seat at all, and why their lifecycle is free:

- `Context.extend()` is prototypal (`vendor/cordis/src/context.ts:99-107`); only the root runs `new EventsService` (`context.ts:80`), so every context shares one hooks table. A plane's `ctx.on(...)` receives any seat-emit (the seat emits with no scoping thisArg, `vscode-cordis/src/extension.ts:169`).
- Plane listeners are fiber effects (`vendor/cordis/src/events.ts:256`, "removed automatically when the fiber unloads") — no manual `off` anywhere in plane code.

## Shared interface (every plane consumes)

| Key | Provided by | Surface |
|---|---|---|
| `vscodeApi` | `vscode-cordis` facade (`src/vscode-api.ts:17-32`) | `workspace.workspaceRoot()` · `workspace.onDidSaveTextDocument` · `workspace.onDidChangeActiveTextEditor` · `workspace.registerTextDocumentContentProvider(scheme, provider)` · `window.showTextDocument(path, { line? })` · `languages.onDidChangeDiagnostics` · `languages.getDiagnostics` · `languages.registerInlayHintsProvider` |
| `remote.<ns>` | `$mount` in the bridge (`src/extension.ts:106-108`) | Typert namespaces: `remote.ideBridge`, `remote.timeline`, `remote.lineNotes` (add `remote.checkpoint` — see §vscode-timeline) |
| `ctx.twinCore.token` | bridge identity | seed value for uplink `report` calls |
| `dsh/frame/*` events | seat loop fan-out (`src/seat.ts:31,92-99`) | verbs gated by `FRAME_VERB_PATTERN` (`seat.ts:39`) |

Delivery for all of them: `vscode-modules` serves `GET /vscode/manifest` + `/vscode/plugin/<id>` (zod-validated rows from each package's `dsh.vscode` block); the seat fetches the manifest and evaluates each bundle via `new Function('module','exports', code)` into the Loader (`vscode-modules/src/vscode/index.ts:18-52`).

---

## Plugin 1 · `vscode-cordis` — the bridge (transport only)

**Interface (what remains):** bridge.json identity + `ctx.twinCore.token`; connection assembly (typert/registry, connection, gateway, `remote.$mount`); the Loader + plane-mount loop (`extension.ts:118-131`); the `vscodeApi` facade; `runSeatLoop` sole downlink (`seat.ts`) with hello uplink reconnect; `stop()`.

**Before:** contains one flow's semantics — `openHandler` subscribed to `dsh/frame/ideBridge/open` via a hand-reached emitter escape hatch (`extension.ts:134-152`), with guard `isOpenFrame` (`:192-196`) and **no teardown** (`stop()` at :173-184 never removes the listener).

**After:** nothing with a verb in it. The open handler and guard move to `vscode-open` (§3). The bridge keeps `$mount` teardown (`unloadTimeline`/`unloadLineNotes`, :178-180) and identity, because transport and seat identity are not flows. ~45 lines deleted; the escape hatch remains only for the seat loop's own emit.

---

## Plugin 2 · `vscode-modules` — plane delivery (unchanged)

**Interface:** host face — scans `dsh.vscode` blocks, zod-validates manifest rows `{ id, name, rev, url, inject, external, immediately }` (`src/manifest.ts`), warns loudly on declared-but-unbuilt planes (`src/registry.ts:142-145`), serves manifest + plugin bytes. Seat face — `fetchVscodePlanes(dshOrigin)`, `vscodeModulesResolver(identity, graph, evaluate?)`; evaluator contract `new Function('module','exports', code)` forces fully-inlined bundles.

**Before / After:** identical. This is the plane the standard takes its delivery model from; the only open item is the unimplemented `dsh/frame/vscodeModules/rebuild/*` hot-rewire (header note in `scripts/dev-vscode.ts:13`).

---

## Plugin 3 · `vscode-open` — file-open flow (new; extracted from the bridge)

**Interface:** `inject = ['vscodeApi']`. Consumes `dsh/frame/ideBridge/open`, calls `ctx.vscodeApi.window.showTextDocument(path, { line? })`; open failures are logged, never unobserved rejections (the "click, nothing happens" ghost).

**Before:** openFile already works end-to-end — web click → `ui-vscode/forward.ts:41-55` → `remote.ideBridge.open` → host queue (`api/ide/index.ts:442-447`) → downlink → bridge handler (`extension.ts:134-152`) → `showTextDocument`. It is served *today*, but by the wrong owner with a lifecycle leak.

**After:** the flow lives in its own plane (~20 lines), listener disposed by plane fiber, host/wire/client untouched (the generic fan-out already emits `dsh/frame/ideBridge/open`). Validation stays split as today: authority in the host (`assertOpenRequest`, `api/ide/index.ts:614-625`) + seat verb-pattern gate; the plane's guard is defense, not contract. Tests migrate from `vscode-cordis/tests/seat.vscode.spec.ts:40-86` into a plane spec matching the timeline spec pattern.

**Optional phase 2 (breaking):** rename the wire verb `ideBridge/open` → `openFile/open` so verbs name their owning plane (`api/ide/index.ts:446-447`, `bridge.host.spec.ts:97-116`, one line in the plane). Deferred until a second open-family verb forces the question.

---

## Plugin 4 · `vscode-events` — uplink projections (unchanged)

**Interface:** `inject = ['vscodeApi', 'remote.ideBridge']`. Three facade subscriptions projected into `remote.ideBridge.report({ token: ctx.twinCore.token, event })`: save → `{type:'save', path}`, active editor → `{type:'activeEditor', path|null}`, diagnostics → `{type:'diagnostics', path, errors, warnings}` (severity 0/1 counts; eventless buffers dropped; rejections swallowed — `src/vscode/index.ts:39-69`).

**Before / After:** identical — this plane was already the standard's shape. It stays the single uplink-projection funnel specifically because uplink projections all feed one `IdeBridgeReportEvent` union (`api/ide/src/types.ts:56-70`); downlink flows get a plane per verb-owner. Known non-item: twin→tab `activeEditor` projection is deliberately unhooked (forward.ts doc).

---

## Plugin 5 · `vscode-line-notes` — notes in the twin, comments into the composer

**Interface (target):** `inject = ['vscodeApi', 'remote.lineNotes']` — unchanged. Downlink: `dsh/frame/line-notes` notes state → inlay hints at note lines (`languages.registerInlayHintsProvider`, already in the facade — zero facade change). Uplink: note creation → one new typed remote `lineNotes.add` writing `putSlot({ kind: 'note', path, line, retained, detail: { text } })` into the checkpoint register.

**Before:** three disconnected pieces — (a) the **dormant** `api/line-notes` service (in-memory `Map`, `state`/`focus` remotes, `publish`/`clear` host-only, no production callers; its promised frame producer doesn't exist); (b) the **live** web note flow that bypasses it entirely: `ui-line-note` gutter `+` → popover → checkpoint slot `kind:'note'` in `slots.jsonl`; (c) the vscode plane is a **no-op** (`apply` is `void ctx`, `src/vscode/index.ts:16-18`). Composer injection already exists downstream: the `@` palette lists note candidates as `@path#L<n>#<id>` chips (`ui-reference`), expanding `detail.text` at submit.

**After:** one note model — the checkpoint slot register (`remote.checkpoint.slots/putSlot`): persisted, tombstone-aware, already read by web gutter and `@` palette. `api/line-notes` is either retired or redefined as a thin projection over slots (it must not stay a parallel in-memory store). Display lands in the twin as inlay hints; creation lands as `lineNotes.add` (a mutation gets a typed remote, not a `report` variant); composer injection rides the existing chip path — the scoped `slash/input-insert-reference` event (chip-preserving, draftRev CAS), **never** `inputActions.setDraft` (flattens chips, clobbers in-flight drafts). The web precedent for plain-text quoting already exists (`ChangesSurface.tsx:255-268`, `quoteInput`).

**Open product choice:** comment UX in the twin — vscode-native comment controller (gutter threads; requires adding a `comments` namespace to the facade) vs command + quick-input (works near today's facade). Decide before implementation.

---

## Plugin 6 · `vscode-timeline` — checkpoints in the twin: native Timeline view + top-of-file scrubber

**Interface (target):** `inject = ['vscodeApi', 'remote.timeline', 'remote.checkpoint']` — gains `checkpoint` (the seat does not mount `checkpointRemote` today; one `$mount` line in the bridge is the only transport change this note needs). Data source is `remote.checkpoint.stops(slot register)` + `remote.checkpoint.blob(digest)` — the live model (per-file before/after sha256 digests, tool/turn metadata).

**Before:** two ghost surfaces and one live one. The generic `api/timeline` service (`TimelineRow {index, label, at}`) is **unwired**: no host mount, no publisher, and its promised `dsh/frame/checkpoint/timeline` frame has no type anywhere. The vscode plane is a placeholder: registers `dsh-checkpoint:` whose provider returns the literal `'<checkpoint placeholder>'` (`src/vscode/index.ts:25-33`), and nothing opens that scheme. The live model is `remote.checkpoint` (slots/stops/blob, `fs/checkpoint`), rendered on the web as the editor's Timeline mode (`ChangesSurface`: scrubber + unified diff). No `registerTimelineProvider` / `TimelineItem` anywhere in the repo yet.

**After:**

1. **Native vscode Timeline view** — a runtime `registerTimelineProvider` (no static `contributes` needed) over `checkpoint.stops(path)`; each item labeled tool/turn, and `TimelineItem.command` opens `vscode.diff` between two `dsh-checkpoint://<digest>` virtual docs. This gives the existing provider real semantics: `dsh-checkpoint://<digest>` → `checkpoint.blob(digest)` text. Restore rides the already-wired `checkpoint.restore` remote.
2. **Top-of-file view** — vscode's line-0 slot is CodeLens, but the facade has none, so the zero-facade-change equivalent is an **inlay hint at position (0,0)**: `◀ stop 3/12 · ReadFile · turn 3 ▶`, prev/next via inlay-hint command args feeding the same stops source. (CodeLens stays the small facade addition if the hint proves cramped.)

`api/timeline` is retired or redefined as a projection over checkpoints — it must not be populated as a second timeline truth. Facade additions needed: `window.registerTimelineProvider` (+ CodeLens only if chosen).

---

## Roster view — before → after

| Plugin | Before | After |
|---|---|---|
| `vscode-cordis` | transport **+ one flow** (openFile) with a leak | transport only, 6 verbs keepers: hello on the seat loop |
| `vscode-modules` | delivery pair | same |
| `vscode-open` | — | new plane owning `ideBridge/open` |
| `vscode-events` | uplink projections | same |
| `vscode-line-notes` | no-op plane; dormant api; live web notes on slots | slot-backed twin hints + `lineNotes.add` + chip injection |
| `vscode-timeline` | placeholder provider, ghost api | native Timeline items + line-0 inlay scrubber over checkpoints |

**Implementation order:** §3 (vscode-open, pure extraction, fixes the leak) → §5 facade-free parts (`lineNotes.add` + inlay hints) → §6 (needs the only two substrate changes: `checkpointRemote` mount + `registerTimelineProvider` facade addition).

**Open decisions:** line-notes comment UX (comment controller vs quick-input); `api/line-notes` and `api/timeline` retire-vs-project; optional openFile verb rename.
