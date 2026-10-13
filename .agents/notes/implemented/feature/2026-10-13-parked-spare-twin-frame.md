# Agent Note: A parked spare twin frame for cheap workspace switching

Status: implemented

## Problem

The [positional singleton seat](../architecture/2026-10-13-positional-seat-for-the-twin-frame.md) set one invariant — one iframe per app — and recorded its deliberate cost: every workspace *switch* navigates the single frame to the new workspace's twin, a full workbench boot each time. In practice that cost lands where users live: the A↔B flip between two active workspaces pays the boot twice per round-trip, even though each workspace's twin server stays warm for the harness run (the spawner already runs one process per workspace root, `api/ide`) and each workspace's origin-keyed IndexedDB restores its editors and layout after every navigation.

Server warmth is an O(1) per workspace already spent; the client-side document boot is what the user feels at every switch. The seat note left the door open — its keying was 'forward-compatible with growing a second frame' — and the measured pain is exactly that case.

## Decision

**One live frame plus at most one parked spare.** The singleton's intent store keeps carrying exactly one active src per mounted body; the seat's custody layer quietly keys its records by src (insertion order serves as the recency queue). On a switch the previous record parks alive with `display: none` — never a removal, so no browsing-context reset — and a flip back is a pure unhide: zero reload, zero boot. Past the spare, the least-recently-shown record falls out: workbench documents are heavyweight, and the evicted workspace's twin server keeps its stable port and IndexedDB, so a return there is a document boot against a hot twin rather than a cold spawn.

The seat, layering, and positional geometry from the seat note are untouched — this change is confined to the custody model inside `twin.tsx` (`MAX_LIVE_FRAMES = 2`, the record map, the eviction walk), and it specifically does not rehabilitate any float-era machinery: no document-level portal, no rect polling, no z negotiation.

## Alternatives considered

**Cross-workspace pre-warm only** (spawn sibling sessions' twins at boot so a switch never hits a cold server): judged insufficient — it removes the *server* half of the cost, which was already O(1) per visited workspace at the spawner, and leaves the client iframe navigation paid per switch, which is the felt clunk. It remains composable with this decision if unvisited-workspace first-visits also prove slow.

**Unbounded per-workspace frames** (keep every visited workspace's document alive): rejected — a heavyweight workbench document per workspace with no cap is a memory machine whose cost grows with the exact behavior it is meant to make free.

**Reinstate keyed custodial frames wholesale from the float era** (record store, `MAX_TWIN_FRAMES` eviction semantics, boot hero portalling): rejected — the cache belongs to the seat's custody layer alone; the float era's other half (document-level placement machinery) stays deleted.

**Do nothing — accept the per-switch boot**: rejected by observed pain; the seat note recorded the single-iframe sacrifice as deliberate *pending measurement*, and the measurement arrived.

## Consequences

**Bought:** a workspace flip (A→B→A) costs a re-render — the parked spare unhides with its document, scroll, and focus intact; switching *costs* are now bounded by the eviction walk, not by the server. **Costs:** the client holds up to two heavyweight workbench documents (the spare is deliberately capped at one), and an evicted-then-revived workspace pays a hot-server document boot. The seat note's custody claim narrows to 'one visible frame, at most one parked spare, keying where measurement demanded it'; its geometry and registration decisions stand unchanged. Boot-cover caveat worth keeping recorded: `settled` is per record, so unhiding a settled record never reseals the cover.

The VscodeBody `readyCache` resets per spec case (`resetVscodeReadyCache`), because a stale cached workspace between unconnected test sessions can synthesize a transient wrong-workspace intent and pollute the LRU queue — production sessions cannot hit the same path (one session maps to one workspace).

## Testing

`packages/client/ui-vscode/tests/vscode-twin.client.spec.tsx` — parked spare restore by unhide with element identity, LRU eviction past the spare, no document-level portal, per-record boot settle without resealing on flip, and stale-publisher immunity for the intent store.

## Related

- [A positional, root-lifetime seat for the VS Code twin frame](../architecture/2026-10-13-positional-seat-for-the-twin-frame.md) — the seat this custody layer grows on; this note amends its custody claim alone.
- `packages/api/ide/src/index.ts` — the spawner's one-process-per-workspace warmth this client model mirrors.
