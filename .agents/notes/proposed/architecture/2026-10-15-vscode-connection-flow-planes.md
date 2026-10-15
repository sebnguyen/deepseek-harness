# Agent Note: Connection-flow planes — the bridge owns transport only; every flow is one plane

Status: proposed

## Problem

The vscode twin has exactly one connection flow whose semantics live inside the bridge package `vscode-cordis` instead of a plane: the open-file downlink. `packages/extensions/vscode-cordis/src/extension.ts:134-152` defines `openHandler` and subscribes it to `dsh/frame/ideBridge/open` through a hand-reached emitter escape hatch; the frame guard `isOpenFrame` sits at extension.ts:192-196. The handler has no teardown — `stop()` (extension.ts:173-184) never removes it — because lifecycle there is manual. Every other flow is already a plane with the uniform interface documented in [the plane-interfaces note](2026-10-15-vscode-plane-interfaces.md): `vscode-events` (uplink projections), `vscode-line-notes`, `vscode-timeline`, `vscode-modules` (delivery). One bridge-resident flow breaks the rule the plane system was built for, and it is precisely the flow whose forgotten teardown is today's known leak.

## Rule

**The bridge owns transport only. Every connection flow — downlink frame handling or uplink projection — is one plane.**

`vscode-cordis` keeps exactly these, and nothing with a verb in it:

1. Identity + config: `bridge.json` read, `twinCore.token`.
2. Connection assembly: `typert/registry`, `connection`, `gateway`, `remote.$mount(...)` of the generated remote slices (`ideRemote`, `timelineRemote`, `lineNotesRemote`, …) — the same lift the web client does.
3. The Loader + plane mounting loop (extension.ts:118-131 today) fed by `vscode-modules`.
4. The `vscodeApi` facade (`vscode-api.ts`) bound once onto the seat context.
5. `runSeatLoop` — the sole downlink consumer, emitting each frame as `dsh/frame/<extId>/<verb>` (`seat.ts:31,92-99`), plus frame-verb hygiene (`FRAME_VERB_PATTERN`, seat.ts:39).
6. `runSeatLoop`'s uplink `hello` (connection-level identity, not a flow).

A **plane** carries everything else: its frame verb(s), its remote calls, its vscode effects. Standard plane interface (unchanged): `dsh.vscode` manifest block, `inject` keys, self-contained `lib/vscode.js`, downlink via `ctx.on('dsh/frame/<extId>/<verb>')`, uplink via `ctx.remote.<ns>.*`.

## Feasibility — no wire or host change is required

Three facts in the tree make this a pure extraction, not a redesign:

1. **The fan-out is already generic.** `runSeatLoop`/`publish` emits every well-formed frame into the local event space under its type (`seat.ts:92-99`); nothing about `ideBridge/open` is privileged. A plane can subscribe to `dsh/frame/ideBridge/open` today with zero change to the host's frame shape (queued at `packages/api/ide/src/index.ts:446-447`).
2. **Plane listeners reach seat-emitted events.** `Context.extend()` builds children via `Object.create(this)` (`vendor/cordis/src/context.ts:99-107`), so only the root ever runs `new EventsService` (`context.ts:80`) — `ctx.events` resolves to the one root table. A plane's `ctx.on(...)` registers a hook carrying its ctx (`vendor/cordis/src/events.ts:121-123,254-259`) and receives any dispatch not scoped by a `Context.filter` thisArg; the seat emits with none (`extension.ts:169`).
3. **Plane-side teardown is free.** Listener registration is a fiber effect (`events.ts:256`: `this.ctx.fiber.effect(...)`; documented at :287: "removed automatically when the fiber unloads"). Moving the open handler into a plane **deletes today's missing-teardown leak** rather than copying it.

The facade the plane needs already exists: `VscodeApiFacade.window.showTextDocument(path, { line? })` (`vscode-cordis/src/vscode-api.ts:24-26,64-71`).

## Design

### The plane roster under the standard

| Plane | Flow | Direction |
|---|---|---|
| `vscode-modules` | plane manifest/bytes delivery | transport-adjacent (reads host HTTP, not frames) |
| `vscode-open` *(new)* | `dsh/frame/ideBridge/open` → open file at line | downlink |
| `vscode-events` | save / activeEditor / diagnostics → `ideBridge.report` | uplink |
| `vscode-line-notes` | `dsh/frame/line-notes` → decorations; note-create uplink | both |
| `vscode-timeline` | `dsh/frame/checkpoint/timeline` → virtual docs / scrubber | downlink |

Direction is deliberately not made symmetric: the standard is about *packaging* (one flow = one plane), not about mirroring uplink and downlink. `vscode-events` stays the shared uplink-projection plane because uplink projections are one joined funnel into a single `report` union; downlink flows stay one-per-plane because each owns its verb.

### `vscode-open` — the moved flow

```ts
// packages/extensions/vscode-open/src/vscode/index.ts
export const inject = ['vscodeApi'] as const

export function apply(ctx: Context): void {
  ctx.on('dsh/frame/ideBridge/open', (frame: { path: string; line?: number }) => {
    void ctx.vscodeApi.window.showTextDocument(frame.path,
      frame.line === undefined ? {} : { line: frame.line },
    ).then(undefined, (error: unknown) => {
      // open failure must never die as an unobserved rejection (same comment the
      // bridge handler carried: a silent drop is the "click, nothing happens" ghost)
      ctx.logger('vscode-open').warn('ideBridge/open failed for %s:', frame.path, error)
    })
  })
}
```

The bridge keeps the frame-shape validation it already has, one level up: `publish`'s verb-pattern gate (seat.ts) plus the host's own `assertOpenRequest` (`api/ide/index.ts:614-625`) remain the contract; the plane may add its own defensive guard but is not the authority.

### Migration phases

1. **Phase 1 — pure extraction, zero wire change.** Create `packages/extensions/vscode-open` as above; delete `openHandler`, `isOpenFrame`, and the open-listener subscription from `extension.ts` (132-152, 192-196). The bridge's escape-hatch emitter stays only for the seat loop's emit; subscribers vanish. Host, client, and wire tuple all unchanged — `ui-vscode` → `ideBridge.open` → `dsh/frame/ideBridge/open` → new plane.
2. **Phase 2 (optional, breaking) — verb ownership.** Rename the host-queued frame type from `ideBridge/open` to a verb naming its owning plane (`openFile/open`), so wire verbs read `<plane>/<verb>` end-to-end. This touches `api/ide/index.ts:446-447`, `bridge.host.spec.ts:97-116`, and the plane's subscription. Value: the manifest roster becomes the verb registry; cost: a coordinated two-package change. Not required for the standard to hold — the seat fan-out never couples verbs to planes — but recommended once a second open-family verb appears.

### What the bridge loses (and keeps on purpose)

Two sterilizations worth recording: (a) the `unloadTimeline`/`unloadLineNotes` hooks in `stop()` (extension.ts:178-180) are remote `$mount` teardowns — transport, stays; (b) the twin-core *identity* (`twinCore.token`) stays in the bridge because planes (`vscode-events` already) read it for uplink calls, and identity is a property of the seat, not of any flow. Everything with a verb in it — open, line notes, timeline scrubbing, future hello/close-confirm flows — becomes a plane or a part of one.

## Consequences

- The bridge's known-leakable manual listener die; each flow's lifecycle rides its plane fiber.
- Every flow becomes testable identically: the existing plane specs pin `inject` + `apply` against a fake `vscodeApi` (pattern at `vscode-timeline/tests/timeline.vscode.spec.ts`), replacing today's bridge-specific seat spec for open-frames (migrate coverage from `vscode-cordis/tests/seat.vscode.spec.ts:40-86` into `vscode-open`'s plane spec).
- Adding a flow is one new package + zero bridge diff — the shape the roster loader (extension.ts:118-131) already handles for four planes.
