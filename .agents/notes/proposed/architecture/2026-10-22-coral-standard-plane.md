# Agent Note: The Coral standard plane — spec-owned facets, one registry, derived carriers

Status: proposed

## Problem

Coral's recorded carrier contract (`base-carriers.md` v0.2, outside this repository under `Cordises/docs/notes/`) makes one interface the substrate for every protocol: four verbs plus a `CarrierCapabilities` struct that every standard must fill. That shape cannot express discovery. "Speaks A2A" is not a boolean — an A2A card advertises streaming, push notifications, task history, skill media types, security schemes, and interface bindings; ACP advertises `loadSession`, prompt content capabilities, and auth methods, then reveals modes and models only when a session is created. Flattening those into one shared struct either loses fields or grows the shared type for one protocol's sake, and cross-protocol comparisons become lies: `streaming` in A2A is not `promptModes` in ACP.

The contract also duplicates transport facts. `Carrier` names `protocol` and `transport`, the manifest declares a `{protocol, transport, direction}` cell, and the registry's `Endpoint` stores a third flat `carrier` string. Three vocabularies describe the same peer; none is authoritative.

Finally, the carrier is a god plugin. Every protocol must implement the same four verbs even when the protocol has no session (A2A tasks) or no wire (native `ctx.subagents`), and every consumer that only needs "ask this peer to do work" routes through a central binding layer that knows all protocols. DSH already uses the opposite arrangement: `Connection` is a two-sided plugin over multiple transports, the API Gateway dispatches descriptor-driven requests with no authority, and `SubagentCapabilities` declares provider features that the service checks before dispatch. Coral adopts that inversion instead of centralizing it again.

## Proposal

The plane splits into four contracts, each with one owner: a **Standard** plugin per protocol that owns detection, the outbound client, inbound mounts, and facet normalization; a generic **Registry** of `Address → Endpoint + per-standard facet records`; a **Carrier** derived view produced by `adapt()`, the only surface the engine consumes; and a **Bake** that mounts peer tools at session open and releases them at session end. The engine keeps deciding who; standards decide how; the registry answers what exists and what it advertises; the gate answers whether an edge or tool may form.

### The standard plugin

```ts
export type StandardId = 'native' | 'acp' | 'a2a'
export type FlavorId = 'inproc' | 'stdio' | 'http-sse' | 'ws'

export interface FacetSchema<T> {
  parse(value: unknown): T
}

export interface Standard<RawFacet, Client> {
  readonly id: StandardId
  readonly facetSchema: FacetSchema<RawFacet>

  /** Inbound: mount this standard's URL scopes on the instance server. */
  mountHost(server: WebServer): Disposable

  /** Discovery: ask an endpoint whether it speaks this standard. */
  detect(endpoint: Endpoint, host: HostConfig): Promise<RawFacet | null>

  /** Normalize the raw facet into the shared discovery vocabulary. */
  discovery(facet: RawFacet): DiscoveryFacet

  /** Outbound: a client whose surface is gated by the facet. */
  connect(endpoint: Endpoint, facet: RawFacet, host: HostConfig): Client

  /** Adapt the client to the engine's four verbs. */
  adapt(client: Client): Carrier
}
```

`detect` returns the protocol's own capability object, not a boolean. It returns `null` when the endpoint does not speak the standard; it throws a typed `CarrierFault` when the endpoint speaks it but detection fails (timeout, bad signature, protocol violation). An unreachable peer is not "does not speak ACP."

`connect` returns a protocol-native client — an A2A client from the A2A SDK, an ACP client from its library, a `ctx.subagents` facade for native. The client's typed surface is the facet: a method the facet forbids is absent where the SDK supports omission, or present and rejecting with `CAPABILITY_UNSUPPORTED` where it does not. `connect` never returns a carrier.

`adapt` is the only bridge to the engine. It is per standard and small: it projects the six envelope families onto the four verbs and nothing else. The engine imports `Carrier` and never a standard.

### Facets: raw and normalized

Two tiers, deliberately different in authority.

**Raw facet** — the spec's own capability object, stored verbatim and typed by the standard. A2A stores the `AgentCard` fields; ACP stores the `initialize` response's `agentCapabilities`; native stores a projection of DSH's `SubagentCapabilities`. The registry treats it as `unknown`; only the owning standard parses it.

**Discovery facet** — one shared shape, produced only by `Standard.discovery()`. The registry never computes it.

```ts
export interface DiscoveryFacet {
  /** Conversation shape: request/response, or a session or task with updates. */
  protocolClass: 'sync' | 'async'
  /** The peer emits updates before a terminal settle. */
  streaming: boolean
  /** A session or task survives transport loss and can be reattached. */
  resumable: boolean
  /** The terminal payload is schema-checked. */
  structuredOutput: boolean
  /** Largest attachment the peer accepts; null means not declared. */
  maxAttachBytes: number | null
  /** Auth schemes usable by this instance after trust narrowing. */
  authSchemes: AuthScheme[]
  /** Media types accepted and produced, in envelope terms. */
  media: { input: string[]; output: string[] }
}
```

Four rules keep the projection honest. Every field is derivable from the raw facet; a standard that cannot answer a field sets `false`, or `null` for `maxAttachBytes`, and never guesses. `protocolClass` is a fence, not a capability: a gate compares facets only within one class, where `sync` means a single call/response and `async` means a session or task that emits updates. `authSchemes` is the intersection of what the peer advertises and what the instance can present after `reef.trust` narrows it. `media` uses envelope names (`text/plain`, `application/json`, `image/png`, `resource_link`), never wire names.

### Registry rows

```ts
export interface Endpoint {
  /** null = in-process; otherwise the origin the flavor dials. */
  url: string | null
  flavor: FlavorId
  /** Flavor-specific connection material, opaque to the registry. */
  meta?: Record<string, unknown>
}

export interface FacetRecord {
  level: 'agent' | 'session'
  raw: unknown
  discovery: DiscoveryFacet
  observedAt: string
  cardRev?: string
}

export interface RegistryRow {
  addr: Address
  endpoint: Endpoint
  standards: ReadonlyMap<StandardId, FacetRecord>
}

export interface Registry extends Disposable {
  resolve(addr: Address): Endpoint | null
  bind(addr: Address, endpoint: Endpoint, standard: StandardId, record: FacetRecord): Disposable
  supported(addr: Address, standard: StandardId): boolean
  facetsOf(addr: Address, standard: StandardId): FacetRecord | null
  list(scope: 'local' | 'federated', q?: Partial<Address>): Address[]
  format(addr: Address): string
  parse(text: string): Address
}
```

The registry stores no protocol nouns. `supported` is `facetsOf(...) !== null`; it is a convenience, not a second truth. The first `bind` for an address establishes its endpoint; later binds for the same address either match that endpoint or reject with `endpoint-mismatch`. Binding is single-owner per `(addr, standard)`; a second live bind rejects with `address-already-bound`, and the caller must `relisten` or `forget`. `resolve` returns the endpoint only, never the facets, so a caller that needs capability asks for it explicitly.

The registry has no lease subscription. Discovery produces rows through the handshake, and the handshake is the only writer ([the reef ownership note](2026-10-22-reef-lease-registry-ownership.md)).

### Session levels and the runtime bake

A standard's capability arrives in two stages. The agent level exists after detection: the A2A card, the ACP `initialize` response, or the native provider registry row. The session level exists only after the conversation is created: ACP's `session/new` returns modes, models, and slash commands; A2A's `message/send` returns a Task with its own state; native's `start()` returns a `SubagentAddress` and a narrowed tool filter.

```ts
export type SessionHandle =
  | { kind: 'native'; address: Address }
  | { kind: 'acp'; sessionId: string }
  | { kind: 'a2a'; taskId: string }

export interface SessionOpen {
  addr: Address
  standard: StandardId
  handle: SessionHandle
  record: FacetRecord // level: 'session'
}

export interface Bake extends Disposable {
  /** Mount the peer tools this session's facet permits; release on dispose. */
  open(open: SessionOpen, ctx: Context): Disposable
}
```

The bake runs at `SessionOpen`, filters the standard's session-level tools by the session facet, mounts them into the agent's scoped tool layer, and releases them when the session closes or the agent disposes. It reuses two existing DSH mechanisms rather than inventing a third: the dynamic package mount that `tool-cordis` uses installs the mounted set effect-scoped, and `ctx.tools.restrict({ allow, deny })` narrows the agent's global tool set where a peer tool is global. Mounting is never ambient; a tool that talks to a peer exists only while a session with that peer exists.

Stale facets do not widen. A card revision or a new model list does not retroactively mount tools on a live session; the session keeps the facet it opened with until it is rebound, and rebinding is an explicit document edit.

### The capability gate

One function, three inputs, one rule:

```ts
export interface GateRequest {
  requires: DiscoveryFacetRequirement
  standard?: StandardId
}

export interface GateResult {
  ok: boolean
  standard?: StandardId
  fault?: CarrierFaultCode
}

export function gate(
  request: GateRequest,
  session: DiscoveryFacet,
  card: DiscoveryFacet,
): GateResult
```

`ok` is true only when the edge's requirement is satisfied by the session facet and the session facet is no wider than the card facet. A miss returns `CAPABILITY_UNSUPPORTED`; a policy refusal returns `POLICY_REFUSED`. The registry answers what exists; the facet what it may; the gate whether a caller may attempt it; the bake what the agent has on hand. No other component re-implements the comparison.

### Event and ownership rules

Event prefixes name the scope of the fact, not the line of the emitting plugin. `coral/*` carries facts inside one instance; `reef/*` carries facts that cross instance boundaries. `cordis/*` is retired, and every existing `cordis/` name is renamed mechanically in [the reef ownership note](2026-10-22-reef-lease-registry-ownership.md). The handshake is the one coral-line plugin that emits `reef/*` events, because peer discovery is a cross-instance fact.

### Relationship to the other notes

[The standard-cell note](2026-10-22-coral-standard-cells.md) owns each standard's raw facet, detection call, session trigger, and normalization table. [The webserver note](2026-10-22-coral-webserver-scopes.md) owns the inbound route scopes and trust fences. [The reef ownership note](2026-10-22-reef-lease-registry-ownership.md) owns lease, registry-writer, trust, log, and event-name reconciliation.

## Alternatives considered

**Keep `Carrier` as the substrate interface.** This is the v0.2 contract: every protocol implements `start/send/observe/dispose` and fills `CarrierCapabilities`, and a central binding layer gates everything. It loses because discovery is not representable, the shared capability struct grows for one protocol at a time, and the central layer must know every protocol's verbs — the god plugin the design set out to remove.

**Keep one `CarrierCapabilities` struct and add fields.** Cheaper to migrate, but the same defect: a new A2A capability edits a type owned by no protocol, and a consumer comparing ACP's `promptModes` to A2A's `streaming` compares unrelated facts. The two-tier facet keeps the shared vocabulary deliberately small.

**Boolean capability map instead of facets.** A `Map<StandardId, true>` answers "does it speak me" but not "can it stream", "can it resume", or "which media does it accept". The registry would then be unable to answer the questions the gate and bake actually ask, and each consumer would re-detect.

**No registry; consumers call standards directly.** Works for one consumer, but the engine must move envelopes without protocol nouns, the handshake must bind rows once for all consumers, and every consumer would otherwise repeat detection and trust. The registry is the one place a fact is stored; standards are the one place it is derived.

**Put the standard and registry plane inside `coral.engine`.** The engine is pure and holds no sockets; detection dials. Keeping standards outside the engine also lets a new protocol ship as one package with no engine change.

**Use the upstream SDK clients directly and delete the standard wrapper.** The A2A and ACP SDKs already provide typed clients; wrapping them adds code. It loses because the engine needs the six envelope families, faults must be typed and emitted, and trust must narrow before a client is usable. The standard wraps the SDK rather than replacing it; raw facet types extend the SDK's spec types.

## Acceptance criteria

- A new standard ships as one package exporting `Standard`; adding it requires no edit to the engine, the registry, or another standard.
- The dependency graph contains no edge from one standard package to another, and no edge from the engine package to a standard package.
- The registry package imports no standard and contains no protocol noun; its row for an A2A peer holds the card's raw capability object and a `DiscoveryFacet` produced only by the A2A standard.
- The engine binds an edge using only `Carrier`; a grep of the engine package for `a2a`, `acp`, or `native` finds no protocol handling.
- `detect()` on an endpoint that speaks a different standard returns `null` within the configured timeout; a detection failure on a peer that does speak the standard throws a typed fault and binds no row.
- A session-level facet mounts exactly the tools whose requirements it satisfies; the test asserts the tool set before open, during the session, and after close.
- `gate()` returns `CAPABILITY_UNSUPPORTED` when the session facet is wider than the card facet or the requirement is unsatisfied, and no caller re-implements the comparison.
- Every `coral/*` and `reef/*` event used by the plane has exactly one declared emitter and a manifest declaration.

## Risks

- **Facet projection lies across classes.** A standard could map an unrelated field to `streaming`. The `protocolClass` fence and per-standard tests limit the damage, but the projection remains a trust boundary; a wrong mapping is a silent capability overclaim.
- **Registry growth.** A generic store invites query semantics ("find any peer that can stream") that turn it into a service. Keep it a map with bind/resolve/list and push selection into the gate.
- **Two-level facets are uneven.** ACP has a clean `session/new`; A2A has a task; native has a spawn. The standard-cell note defines each trigger, but the bake API is uniform while the semantics are not.
- **Bake versus restrict.** Two narrowing mechanisms can disagree. The rule is that bake mounts and unmounts, and `restrict` narrows within a mount; a tool that is both mounted and restricted appears only in the intersection.
- **Migration cost.** The v0.2 notes, the three adapter notes, and the carrier-plane overview restate the old contract; they must be rewritten in the same change or they become competing authorities.
- **SDK coupling.** Extending A2A and ACP SDK types couples the standards to their release cadence; a spec rename becomes a compile error, which is the intended failure but still a maintenance cost.
