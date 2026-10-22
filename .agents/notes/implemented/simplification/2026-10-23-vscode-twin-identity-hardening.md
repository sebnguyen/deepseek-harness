# Agent Note: VS Code twin identity hardened; parked frames retained, readyCache removed

Status: implemented (revised)

## Revision

The first pass of this note moved the iframe into the session scope (inline frames, no parking). That broke file-open: clicking a file forwards an open event, but the vscode body unmounts on the tab/visibility change, destroying the iframe mid-open. This revision restores the root-scoped parked-frame model (TwinFrame in shell.ide, LRU cap 3) so the workbench survives switches, while keeping the identity hardening: per-spawn tokens, direct node spawn, and no readyCache.

## Problem

The VS Code twin was mounted as a root-scoped `TwinFrame` in ui-layout's positional `shell.ide` seat, fed by a module-level intent store (`publishTwinIntent`/`useTwinIntent`) that session-scoped `VscodeBody` components published into and released from on mount/unmount. On top of that sat a `readyCache` module Map that was never invalidated. Together these produced the broken-on-switch failure class:

- A host restart (or any twin respawn) changed the twin's port/token, but `readyCache` still held the old answer, so the next session switch resurrected a stale src and the iframe pointed at a dead twin.
- Parked frames (up to 3, LRU) outlived the twin they pointed at, so a respawned twin's stale-token frames 403'd forever.
- Twin identity was three uncoordinated copies (argv token, bridge.json, iframe URL) with no epoch, so orphans from a dead host re-entered the bridge seat race.
- The sh launcher (`bin/code-server-oss`) does not `exec` node, so the host's subprocess handle tracked the shell while the real REH became an orphan on every host death.

## Decision (final)

Retain the root-scoped parked-frame model (TwinFrame in shell.ide, LRU cap 3) so the workbench survives tab/visibility switches and file-open lands. Apply the identity hardening on top:

- Per-spawn tokens (host): mint randomBytes(24) per spawn; orphaned twins 403 and back off.
- Direct node spawn (host): spawn node+server-main.js directly; no sh-wrapper orphans.
- No readyCache (client): every mount re-polls, so a host restart can never resurrect a stale src; the parked frame with the old token is parked (display:none) and evicted when a new src is published.
- TwinFrame keeps its record map, boot cover, and focus guard.

The earlier 'move iframe into session scope' attempt is reverted: inline frames destroyed the workbench on tab switch, breaking file-open.

## API changes

Client (`@deepseek-ai/dsh-client-ui-vscode`):

- `VscodeBody` keeps publishing its ready src through `useTwinIntent` and returns `null` once ready; the frame renders in the root-scoped seat.
- Removed export: `resetVscodeReadyCache` (and the `readyCache` Map behind it). The intent store (`publishTwinIntent`, `useTwinIntent`, `subscribeTwinIntent`, `twinIntentSrc`, `resetTwinIntent`) is unchanged and stays.
- `TwinFrameProps` is unchanged: `PropsRuntime<'shell.ide'> & PropsLocale<'vscode'>`.
- Client plugin keeps its `shell.ide` registration for `TwinFrame`.

Host (`@deepseek-ai/dsh-api-ide`):

- `ensure` mints a fresh token per spawn; no longer calls `stableTwinToken`.
- Spawn argv uses `node` + `out/server-main.js` directly.
- `stableTwinToken` / `twinTokenPinName` still exported (backward compat) but unused by the spawner.

## Deferred

- Layered liveness watch (HTTP probe every ~2s + bridge-attach grace + capped respawns) and adopt-or-kill on ensure: not implemented in this pass; the direct-spawn + per-spawn-token changes remove the orphan fleet and the seat race, and the client no longer caches stale src. Full liveness reconciliation remains a follow-up.
- The parked-frame cap (3) is a heuristic pinned to the observed three-workspace cycle; it stays as-is.
- A respawn rotates the token, so a parked frame for that workspace is re-pointed to a new record on the next publication rather than reusing the stale one; the old record falls out of the LRU.
