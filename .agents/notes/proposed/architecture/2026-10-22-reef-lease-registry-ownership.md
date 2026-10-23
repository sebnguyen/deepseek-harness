# Agent Note: Reef leases, registry rows, trust attestations, and the instance log have one owner each

Status: proposed

## Problem

Four facts determine whether the Coral and Reef plane wires at all, and the notes disagree about each.

1. **Lease payload.** `reef.mesh` emits `reef/lease-announced` with `{ id, address, carrier }`; `coral.peer-handshake` subscribes to the same name expecting `{ row }`; `reef.trust` expects `{ lease }`. `base.registry` subscribes to `reef/registry-lease`, a name no plugin emits.
2. **Row writer.** `reef.mesh` says lease rows are rebound in the registry; `coral.peer-handshake` says registry rows are written there or nowhere. Two writers make `address-already-bound` ambiguous and can bind the same peer twice.
3. **Trust event.** `reef.trust` emits `reef/token-attested`; `reef.carrier.a2a-server` subscribes to `reef/trust-attested`.
4. **Log event.** `reef.ledger` emits `reef/log-append`; `base.projections` subscribes to `coral/log-append`.

These are not naming preferences: a subscriber with no emitter never fires, and two writers break single-owner binding.

## Proposal

### One lease shape, one emitter

```ts
export interface Lease {
  instanceId: InstanceId
  /** host:port or URL the instance advertises; the flavor decides how to dial it. */
  address: string
  announcedAt: string
  ttlSecs: number
  modality: 'mem-bridge' | 'sse-bridge' | 'k8s-plane' | 'api-server'
}

export interface Mesh extends Disposable {
  announce(lease: Lease): Lease
  leases(scope?: { modality?: Lease['modality'] }): Lease[]
  on(event: 'announced' | 'expired', cb: (lease: Lease) => void): Disposable
}
```

`reef.mesh` emits exactly two events: `reef/lease-announced { lease }` and `reef/lease-expired { instanceId }`. `Lease.carrier` is renamed `modality`: it names the discovery transport, not a protocol carrier, and the old name was the third meaning of "carrier". A lease is renewed by a fresher `announce`, not by a separate event; expiry is death, and a re-announced instance gets a new lease row.

### One registry writer

`coral.peer-handshake` is the only plugin that calls `registry.bind` for federated rows. `reef.mesh` publishes leases and never touches the registry. The handshake performs, in order: read the lease from the event or `hint`; for each standard that owns the advertised flavor, call `detect()`; verify the card or token through `reef.trust`; call `registry.bind(addr, endpoint, standard, record)` for each detected standard; mount the standard's cells; and emit `reef/peer-discovered { addr, cell }`.

`meet(addr, hint)` is idempotent: a second call for the same address returns the same `MountedCell`, and the single-owner bind is the guard rather than a lock. `relisten(instanceId)` re-runs detection on a TTL refresh or card revision and rebinds only when a facet changed. `forget(instanceId)` runs in reverse: unmount cells, delete rows, close links. A failure in one step still proceeds with the rest; a leaked link or row is a bug, not an accepted outcome. When `registry.bind` rejects with `address-already-bound`, the handshake treats the address as already met and returns the existing cell rather than retrying.

### One trust event

`reef.trust` emits `reef/token-attested { tokenId, chain }` and `reef/token-revoked { tokenId, reason }`. `reef.carrier.a2a-server` subscribes to `reef/token-attested`. The `reef/trust-attested` spelling is deleted; there is no alias. A card fetch that fails signature verification never reaches `registry.bind`; the handshake emits `reef/peer-lost { addr, reason: 'POLICY_REFUSED' }` and no row exists. The default is a typed refusal, not a degraded empty cell.

### One log event

`reef.ledger` emits `coral/log-append { envelope, seq }` for every appended row, and `base.projections` keeps its subscription to that name. The ledger also emits `reef/log-crossed { seq, kind }` for rows that represent an instance crossing, which `reef.carrier.api` consumes. The ledger's existing `reef/log-append` is renamed `coral/log-append` because the append fact is intra-instance even though the plugin is reef-line.

### Event namespace rule

The prefix names the scope of the fact, not the line of the emitter.

| Prefix | Meaning | Emitters |
|---|---|---|
| `coral/` | a fact inside one instance | base and coral plugins, and the ledger's intra-instance append |
| `reef/` | a fact that crosses an instance boundary | mesh, trust, federation, reef carriers, and the handshake's peer events |
| `cordis/` | retired | none |

Mechanical rename table for the names currently written differently:

| Old | New |
|---|---|
| `cordis/carrier-fault` | `coral/carrier-fault` |
| `cordis/carrier-delivery-downgraded` | `coral/carrier-delivery-downgraded` |
| `cordis/child-started` | `coral/child-started` |
| `cordis/child-settled` | `coral/child-settled` |
| `cordis/acp-session-settled` | `coral/acp-session-settled` |
| `cordis/acp-turn-evaled` | `coral/acp-turn-evaled` |
| `cordis/a2a-task-complete` | `coral/a2a-task-complete` |
| `cordis/a2a-task-blocked` | `coral/a2a-task-blocked` |
| `cordis/live-view-changed` | `coral/live-view-changed` |
| `cordis/edit-proposed` | `coral/edit-proposed` |
| `cordis/gate-pressed` | `coral/gate-pressed` |
| `reef/registry-lease` | deleted; the registry does not subscribe |
| `reef/trust-attested` | `reef/token-attested` |
| `reef/log-append` | `coral/log-append` for appends, `reef/log-crossed` for crossings |

### Lifecycle and failure rules

A lease expiry calls `forget(instanceId)` once, and the handshake emits `reef/peer-lost` after the cell unmounts. `relisten` is the only path that observes a card revision; a live session keeps its old facet until rebound. `requireTrustedCards: true` is the only supported default; a degraded cell requires an explicit config change and is a typed `POLICY_REFUSED`, not an empty mount. `teardown()` forgets every mounted cell before unload, and a failed forget still unmounts the cell, row, and link together.

## Alternatives considered

**Two writers: mesh for lease rows, handshake for meet rows.** It reads naturally — mesh owns discovery, handshake owns identity — but both would bind the same `Address`, and the second bind would either fail or silently overwrite. The registry's single-owner rule makes one writer the only coherent choice.

**Keep `reef/registry-lease` and have mesh emit it.** This would make the registry a subscriber to discovery and require it to understand lease payloads. The registry is data; discovery feeds it through the one writer, not by direct subscription.

**Keep `reef/log-append` and move projections onto it.** The log row is an intra-instance fact even though the ledger is reef-line; naming it `reef/*` forces a base plugin to subscribe to a reef name and splits the append stream from the projections' documented inlet. Splitting append from crossing keeps the prefix rule honest.

**Keep `cordis/*` as the client namespace.** No note declares a boundary for it, the same fact appears under both `cordis/` and `coral/`, and the template uses `cordis/x` as an example. Retiring it removes a third vocabulary rather than documenting one.

**Silent degradation when a card fails verification.** An unverified row is a name, not a capability; binding it would let the engine send to an unauthenticated peer. A typed refusal is louder and cheaper to debug.

## Acceptance criteria

- A manifest and event test proves every subscribed event has exactly one declared emitter and every emitted event is declared by its plugin.
- Two `meet()` calls for one address return the same `MountedCell`; no `address-already-bound` reaches the caller.
- A lease expiry calls `forget` once, unmounts the cell, deletes the row, closes the link, and emits `reef/peer-lost`.
- A card that fails signature verification leaves no row and emits `reef/peer-lost` with `POLICY_REFUSED`.
- `reef/registry-lease`, `reef/trust-attested`, and every `cordis/` name are absent from the tree after the rename.
- The ledger's append test shows one `coral/log-append` per row and one `reef/log-crossed` per crossing row.

## Risks

- The rename is mechanical but wide; a missed consumer fails at runtime because the event bus rejects undeclared subscriptions at load. A grep gate should run for the retired names.
- Removing mesh's registry write changes startup ordering: a lease now produces a row only after the handshake detects and verifies, so a peer is briefly visible in mesh but not addressable in the registry. That is the intended trust boundary but a behavior change for callers that assumed `leases()` implies `resolve()`.
- `forget` is multi-step; a partial failure can leak a link. The rule is that unmount always proceeds, but the link close needs its own timeout and a test.
- Splitting `log-append` from `log-crossed` doubles the ledger's event surface; a consumer that only wants crossings must filter by kind or subscribe to the narrower event.
- `requireTrustedCards: true` makes the plane unusable in a test environment without a trust key; fixtures must provide one.
