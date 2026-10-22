# Agent Note: VS Code twin moves from root-scoped parked frames to session-scoped inline iframe

Status: implemented

## Problem

The VS Code twin was mounted as a root-scoped `TwinFrame` in ui-layout's positional `shell.ide` seat, fed by a module-level intent store (`publishTwinIntent`/`useTwinIntent`) that session-scoped `VscodeBody` components published into and released from on mount/unmount. On top of that sat a `readyCache` module Map that was never invalidated. Together these produced the broken-on-switch failure class:

- A host restart (or any twin respawn) changed the twin's port/token, but `readyCache` still held the old answer, so the next session switch resurrected a stale src and the iframe pointed at a dead twin.
- Parked frames (up to 3, LRU) outlived the twin they pointed at, so a respawned twin's stale-token frames 403'd forever.
- Twin identity was three uncoordinated copies (argv token, bridge.json, iframe URL) with no epoch, so orphans from a dead host re-entered the bridge seat race.
- The sh launcher (`bin/code-server-oss`) does not `exec` node, so the host's subprocess handle tracked the shell while the real REH became an orphan on every host death.

## Decision

Move the iframe into the session scope: `VscodeBody` now renders `<TwinFrame src={...} t={...} />` inline when the twin is ready, instead of publishing a src and returning `null`. Consequences:

- No module-level intent store (`publishTwinIntent`, `useTwinIntent`, `subscribeTwinIntent`, `twinIntentSrc`, `resetTwinIntent` deleted).
- No `readyCache` / `resetVscodeReadyCache`: every mount re-polls, so a host restart can never resurrect a stale src.
- No root-scoped `shell.ide` registration of `TwinFrame`; the frame lives inside the body.
- `TwinFrame` now takes `src: string | null` as a prop instead of reading from the global store.
- `TwinFrame` keeps its per-instance record map / boot cover / focus guard; a remount (session switch) creates a fresh document with a fresh src. Workspace switches within one body still park/reuse records.

Host side (api/ide):

- Per-spawn tokens: `ensure` mints `randomBytes(24)` instead of `stableTwinToken`'s pinned value, so an orphaned twin presenting a stale token is rejected 403 and its bridge backs off forever. The port stays pinned (origin/IndexedDB stability).
- Direct node spawn: argv is now `[dist/node, dist/out/server-main.js, ...]` instead of the `bin/code-server-oss` sh wrapper, so `ctx.subprocess` tracks the real REH and `terminate()` kills it. No more orphans.
- Legacy token pin is no longer adopted (port pin still is).

## API changes

Client (`@deepseek-ai/dsh-client-ui-vscode`):

- `VscodeBody` no longer calls `useTwinIntent`; renders `TwinFrame` inline when ready.
- Removed exports: `resetVscodeReadyCache` (from VscodeBody), `subscribeTwinIntent`, `twinIntentSrc`, `publishTwinIntent`, `useTwinIntent`, `resetTwinIntent` (from twin).
- `TwinFrameProps` changed from `PropsRuntime<'shell.ide'> & PropsLocale<'vscode'>` to `{ src: string | null; t }`.
- Client plugin no longer registers into `shell.ide`.

Host (`@deepseek-ai/dsh-api-ide`):

- `ensure` mints a fresh token per spawn; no longer calls `stableTwinToken`.
- Spawn argv uses `node` + `out/server-main.js` directly.
- `stableTwinToken` / `twinTokenPinName` still exported (backward compat) but unused by the spawner.

## Deferred

- Layered liveness watch (HTTP probe every ~2s + bridge-attach grace + capped respawns) and adopt-or-kill on ensure: not implemented in this pass; the direct-spawn + per-spawn-token changes remove the orphan fleet and the seat race, and the client no longer caches stale src. Full liveness reconciliation remains a follow-up.
- The parked-frame custody model (root-scoped `TwinFrame`, LRU cap 3) is removed entirely; workspace switches now reload the workbench behind the boot cover. Assets are service-worker-cached and editor/layout restore from IndexedDB, so the cost is a document boot only.
