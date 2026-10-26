# Cordis to React: the seam, stores, and observables

This page explains how a Cordis plugin (plain JavaScript) produces React components, how state flows from a plugin's service object into a React component's props, and why some data uses zustand stores while other data uses bare observables and scopes. It is written for a reader who understands React and zustand but has not yet internalized the Cordis plugin model this codebase uses.

The surrounding Web Client architecture is in [Web Client architecture](web-client.md). Slot declarations, cardinality, and scope are in [Web Client Slots](slots.md). Cordis itself is introduced in [Cordis primer](../cordis-primer.md) and [Cordis tutorial](../cordis-tutorial/index.md).

## The three layers

Every browser-side UI feature in this codebase passes through three layers in order.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Cordis kernel (plain JS)                          │
│  Plugins register services, hooks, and slot contributions.   │
│  apply(ctx) runs once per plugin at boot.                   │
└──────────────────────────┬──────────────────────────────────┘
                           │  ctx.slots.register(...)
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 2: Slot registry (the bridge)                        │
│  Maps slot names → React components.                        │
│  Tracks which session is "current" (observable).            │
│  Creates and caches zustand store instances.                 │
└──────────────────────────┬──────────────────────────────────┘
                           │  renderSlot('root', {})
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 3: React tree                                        │
│  SlotOutlet subscribes to registry changes via              │
│  useSyncExternalStore. When the registry says "session       │
│  changed", React re-renders; key changes cause remounts.    │
└─────────────────────────────────────────────────────────────┘
```

The seam is one function call: `ctx.slots.renderSlot('root', {})` returns a React element. Everything above that line is Cordis. Everything below is React. The slot registry is the only thing that speaks both languages.

## Layer 1: Cordis plugins

A client UI package is a Cordis plugin. It exports two things:

```ts
export const inject = ['slots', 'sessions', 'locale']

export function apply(ctx: Context): void {
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: VSCODE_ID,
      locale: 'vscode',
      inject: (): VscodeInjected => face,
    }, VscodeBody))
}
```

- `inject` declares which Cordis services this plugin needs. The kernel resolves them before `apply` runs.
- `apply(ctx)` receives a context object. It calls `ctx.slots.register(...)` to place a React component into a named slot.
- `ctx.slots.inject(key, callback)` defers registration: the callback runs when the slot owner mounts, and its effects are cleaned up when the owner unmounts. This is how a feature plugin contributes into another package's slot without importing that package's runtime values.

A plugin never imports another plugin's component. It registers into a slot name. The registry mediates.

## Layer 2: the slot registry

### Registration

`ctx.slots.register({name, children, store, inject, locale}, Component)` does four things:

1. **Records the component** in the registry's ledger under the named slot.
2. **Declares child slots** (the `children` map). This authorizes `renderSlot` calls for those child names.
3. **Acquires a store handle** if `store` is provided. The registry caches one instance per handle × scope key.
4. **Runs inside the caller's Cordis effect** so disposal cascades: when the plugin unloads, the registration disappears.

### Rendering

The root component (`AppFrame`, registered into the `root` slot by `ui-layout`) calls `renderSlot('sidebar', ...)` and `renderSlot('main', ...)` etc. Each `renderSlot` call looks up the registry, finds registered components, and renders them as React elements.

For a `single` slot, the highest-priority winner renders. For a `keyed` slot, the owner passes an `entryKey` and the matching cell renders. For a `list` slot, all cells render in order.

### Scopes: the remount mechanism

Every slot has a scope: `root`, `session-maybe`, or `session`.

- **`root`**: the component mounts once and lives forever. No remount on session switch.
- **`session`**: the component is wrapped in `<Fragment key={sessionId}>`. When the session changes, React sees a new key, destroys the old instance, and mounts a new one. All component state is lost.
- **`session-maybe`**: like `session` but renders even without a resolved session; session values are optional.

The session scope is installed by `ui-session`. Its adapter publishes an observable binding whose `key` field is the current session id. The renderer subscribes to that observable through React context and uses `binding.key` as the React key.

**This is why TwinFrame must be root-scoped.** If it were session-scoped, every session switch would destroy the iframe element, killing the workbench and forcing a full reload. The root scope keeps the iframe alive across session switches.

### The scope adapter

`ui-session` installs a `SlotScopeAdapter`:

```ts
this.adapter = {
  current: {
    getSnapshot: () => this.currentBinding,   // { key: sessionId, ... }
    subscribe: (listener) => { ... },          // notifies on session change
  },
  resolve: (key) => this.resolve(key),         // resolve a specific session
  renderArea: renderSessionArea,                // renders children keyed by sessionId
}
```

The adapter's `current` observable is a plain object with `getSnapshot` and `subscribe` — the exact shape `useSyncExternalStore` consumes. The renderer's `ScopeProvider` subscribes to it and publishes the binding through React context.

When the user clicks a different session, the session list store updates, `ui-session`'s `publishCurrent()` fires, the observable notifies, `ScopeProvider` re-renders, context updates, and the session-scoped outlet's `key={binding.key}` changes — triggering remount.

## Layer 3: React

### The observable-to-hook bridge

Cordis services and slot stores are plain JavaScript objects with `getSnapshot`/`subscribe`. React cannot consume them directly. The bridge is one function:

```ts
// bind.ts
function bindSnapshotSelector(w: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = w.subscribe.bind(w)
  const getSnapshot = w.getSnapshot.bind(w)
  return function useSnapshotSelector(sel, eq) {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, sel, eq)
  }
}
```

This closes `subscribe` and `getSnapshot` into stable closures and returns a hook that calls `useSyncExternalStoreWithSelector`. The `undefined` server snapshot means this is client-only.

### Hook caching

The bridge is wrapped by `observableHook(source)` (in `bindings.tsx`), which caches the bound hook in a `WeakMap` keyed by the source object. This matters because the renderer spreads a fresh kit object on every render — without caching, every component would resubscribe on every render.

```ts
const hookCache = new WeakMap<HostObservable<unknown>, SnapshotSelectorHook<unknown>>()

function observableHook(source) {
  let hook = hookCache.get(source)
  if (!hook) {
    hook = bindSnapshotSelector(source)
    hookCache.set(source, hook)
  }
  return hook
}
```

### How a component receives its store

For each registered entry, the renderer's `standardKit` function:

1. Calls `host.storeOf(entry, scopeBinding)` to resolve the store instance (creating it if needed).
2. If a store exists, sets `kit['useStore'] = observableHook(store)` and `kit['actions'] = store.actions`.
3. Injects these into the component's props.

The component declares its props as `PropsStore<H>` (where `H` is the store handle type) and receives `useStore` and `actions` as props. It never calls `create()` or `useSyncExternalStore` directly.

## Stores: zustand as projection

### What a store is

A store is a zustand vanilla store wrapped by this codebase's engine. It holds a snapshot (the state) and exposes:

- `getSnapshot()` — returns the current state.
- `subscribe(listener)` — notifies on change.
- `actions` — baked mutators that use immer internally.
- `clearPersisted()` — clears localStorage persistence.

The engine is in `packages/client/store/src/index.ts`. It uses `createStore` from `zustand/vanilla` with `subscribeWithSelector` middleware, `immer`'s `produce()` for updates, and a hand-rolled localStorage persistence layer.

### Defining a store

```ts
const handle = defineStore({
  init: () => ({ panelInfo: defaultPanelInfo, layoutInfo: defaultLayoutInfo }),
  persist: 'dsh.layout',        // optional localStorage key
  flush: 'sync',               // 'sync' or 'raf' (coalesce notifications)
  actions: {
    setPanelInfo: (draft, info) => { draft.panelInfo = info },
    setViewportWidth: (draft, width) => { draft.layoutInfo.viewportWidth = width },
  },
})
```

`defineStore` returns a **handle** — a recipe, not an instance. The handle's `create(scopeKey?)` mints one instance. The `scopeKey` suffixes the persist key for session-scoped stores.

Key design: **actions are immer draft mutators.** The first parameter is the draft state; the engine bakes it away so the component sees `actions.setPanelInfo(info)` with no draft parameter.

### Store lifecycle through slots

1. Plugin calls `defineStore(...)` → gets a handle.
2. Plugin registers the handle as a store seat: `register({name, store: handle}, Component)`.
3. SlotRegistry acquires the handle (refcounted; disposed on plugin unload).
4. When React mounts the component, the renderer calls `resolveStore(handle, scopeBinding)`:
   - Root scope: one instance under a fixed key (`ROOT_INSTANCE_KEY`).
   - Session scope: one instance per session id, cached in a `Map<key, instance>`.
5. The instance is created via `handle.create(key)` on first access.
6. The renderer injects `useStore` (the bound hook) and `actions` (the mutators) as component props.
7. When a session dies, `clearStoreScope(key)` calls `clearPersisted()` on every non-root instance.

### Why stores instead of plain observables

A store is justified when:

- State is **mutable view state** shared across entries or preserved across remounts.
- State needs **persistence** (localStorage).
- State has **complex update logic** (immer drafts).
- Multiple components need to **read and write** the same state.

A bare observable is justified when:

- State is **read-only projection** of a model (e.g., session list, workspace list).
- State is **owned by a Cordis service** and components only subscribe.
- State changes are **driven by the Host**, not by user interaction in the component.

## Observables: the non-store path

### HostObservable

A `HostObservable<T>` is the simplest bridgeable source:

```ts
interface HostObservable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
```

Any object with these two methods can be bound to React via `observableHook(source)`. This includes:

- zustand store instances (they have `getSnapshot` and `subscribe`).
- Cordis service observables (e.g., session list state).
- Hand-rolled observables (e.g., the twin intent store in `ui-vscode`).

### Slot-level injection: `hooks`

A registration's `inject` factory can return a `hooks` object containing bare observables:

```ts
ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: VSCODE_ID,
  inject: (): VscodeInjected => ({
    status: ideBridge.status(sessionId),   // an observable
    hooks: { status: ideBridge.status(sessionId) },  // bare observable → becomes useStatus hook
  }),
}, VscodeBody)
```

The renderer converts `hooks: { status }` into a `useStatus(selector)` prop. The component calls `useStatus(s => s.ready)` to read; it never touches the observable directly.

### Standard props: `provideRoot` and `uiSession.provide`

Plugins can add standard hooks available to all components in a scope:

```ts
ctx.slots.provideRoot({
  hooks: {
    sessions: ctx.sessions.list,        // observable → becomes useSessions
    sessionPendingInteraction: service.pendingInteractions,
  },
})
```

These become `useSessions` and `useSessionPendingInteraction` props on every component. The renderer binds them the same way: `observableHook(source)` cached per source identity.

### When to use which

| Mechanism | Use when | Example |
|---|---|---|
| **Store** (`defineStore`) | Mutable view state, persistence, shared read/write | Layout geometry, sidebar width, browser view state |
| **Observable** (`HostObservable`) | Read-only projection of a model or service | Session list, workspace list, panel info |
| **Scope** (`session`/`session-maybe`) | Component needs to follow the current session and remount on change | Tab bodies, conversation views |
| **Injection** (`inject`/`hooks`) | One entry's private callbacks and observables | VS Code status polling, file forwarding |

## The vscode twin: putting it together

The `ui-vscode` package registers one body, and that body owns its frame:

1. **`VscodeBody`** into `sidebar.right.pane.tab` (keyed, session scope). This body:
   - Polls `ideBridge.status(sessionId)` every 1.5 s.
   - Forms `src = url/?tkn=<token>&folder=<workspaceRoot>` from each ready answer.
   - Shows the boot hero while the answer is not ready, disabled, or failed.
   - Renders **`TwinFrame`** in its own box once the answer is ready.

2. **`TwinFrame`** lives inside the body, not in a root-scoped seat. There is no
   `shell.ide` slot and no singleton frame cache: the workbench document lives
   and dies with the tab body.
   - The tab type declares `surface: true`, so the right column renders this
     body as the column's content.
   - The iframe fills the body; the boot cover stays until the document's
     `load` plus a 1.2 s settle margin, then lifts.
   - Switching the tab or session unmounts the body, so the next visit boots
     the workbench cold.

## Why the seam feels confusing

The confusion comes from three things:

1. **Cordis effects vs React effects.** `ctx.effect(() => ...)` registers a Cordis lifecycle hook (runs on plugin activation/deactivation). `useEffect(() => ...)` is a React lifecycle hook (runs on component mount/unmount). They look similar but belong to different systems. A plugin's `apply` runs `ctx.effect` to register slot contributions; the component uses `useEffect` to announce presence.

2. **Observables vs stores.** Both bridge to React via `useSyncExternalStore`. The difference is ownership: a store is created by the slot registry and injected as `useStore`/`actions`; an observable is created by a Cordis service and injected via `hooks` or `provideRoot`. The bridge mechanism is identical; the lifecycle and mutability differ.

3. **Scopes vs components.** A scope (`root`/`session`/`session-maybe`) is a slot property, not a component property. The same component registered into a `root` slot never remounts; registered into a `session` slot it remounts on every session switch. The component code does not change; only the registration's scope string changes.

## Key files

| File | Role |
|---|---|
| `packages/client/ui-renderer/src/client/registry.ts` | SlotRegistry: registration, store acquisition, scope management |
| `packages/client/ui-renderer/src/client/scoped-slots.tsx` | SlotOutlet, standardKit, RootEntry, StrictSessionEntry |
| `packages/client/ui-renderer/src/client/bind.ts` | `bindSnapshotSelector`: the one `useSyncExternalStore` bridge |
| `packages/client/ui-renderer/src/client/bindings.tsx` | `observableHook`, `maybeObservableHook`, providers |
| `packages/client/store/src/index.ts` | `createSnapshotStore`, `defineStore`, persistence |
| `packages/client/ui-slots/src/index.ts` | SlotCore, SlotMap, cardinality/scope types |
| `packages/client/ui-slots/src/renderer.ts` | SlotRendererHost, SlotScopeAdapter, HostObservable |
| `packages/client/ui-session/src/client/index.ts` | UiSession service, scope adapter, provideRoot |
| `packages/client/ui-layout/src/client/index.ts` | Root seat declaration, store registration |
| `packages/client/ui-vscode/src/client/index.ts` | VscodeBody registration + surface election |
| `packages/client/ui-vscode/src/client/twin.tsx` | TwinFrame: iframe custody |
| `packages/client/ui-vscode/src/client/VscodeBody.tsx` | VscodeBody: polling, frame ownership |
