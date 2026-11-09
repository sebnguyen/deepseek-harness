/** Core Coral vocabulary: transport, codec, channel, cluster, server, client. */

import type { Context } from '@deepseek-ai/cordis'

export type Brand<T, B extends string> = T & { readonly __brand: B }

export type HostId = Brand<string, 'HostId'>
export type ClusterKey = Brand<string, 'ClusterKey'>
export type EndpointId = Brand<string, 'EndpointId'>
export type TransportId = Brand<string, 'TransportId'>
export type StandardId = Brand<string, 'StandardId'>
export type ClientId = Brand<string, 'ClientId'>
export type ConnectionId = Brand<string, 'ConnectionId'>
export type ServerId = Brand<string, 'ServerId'>
export type CodecId = Brand<string, 'CodecId'>

export type RawCapability = unknown
export type TransportFrame = Uint8Array
export type TransportHosting = 'shared' | 'exclusive'

export interface Disposable {
  dispose(): void | Promise<void>
}

export type MethodHandler = (context: unknown) => unknown | Promise<unknown>

export interface HostEndpoint {
  readonly id: EndpointId
  readonly transport: TransportId
  readonly url: URL | null
  readonly meta?: Readonly<Record<string, unknown>>
}

export type EndpointState = 'unknown' | 'probing' | 'reachable' | 'unreachable'

export interface HostRecord {
  readonly id: HostId
  readonly endpoints: readonly HostEndpoint[]
  readonly supports: Map<EndpointId, Map<StandardId, ProbeEvidence>>
  readonly states: Map<EndpointId, EndpointState>
}

/** One dialed link. Honest EOF, visible generation; reconnect policy lives in Channel, not here. */
export interface Connection extends Disposable {
  readonly id: ConnectionId
  readonly transport: TransportId
  readonly host: HostId
  readonly endpoint: EndpointId
  readonly generation: number
  send(frame: TransportFrame): Promise<void>
  readonly read: AsyncIterable<TransportFrame>
}

/**
 * The welcomer: a claim on one bind plus the 0..N inbound Connection stream.
 * `accept()` produces a fresh Connection per accepted peer; a Connection
 * itself is always one link to one peer.
 */
export interface Listener extends Disposable {
  readonly transport: TransportId
  readonly address: unknown
  accept(): AsyncIterable<Connection>
}

export interface Transport extends Disposable {
  readonly id: TransportId
  readonly hosting: TransportHosting
  dial(endpoint: HostEndpoint, cfg: Readonly<Record<string, unknown>>): Promise<Connection>
  bind?(endpoint: HostEndpoint, cfg?: Readonly<Record<string, unknown>>): Listener | Promise<Listener>
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

export type WireMessage = JsonValue

/** Stateful per-link decoder: buffers across frames (one message may span frames). */
export interface Decoder {
  push(frame: TransportFrame): WireMessage[]
}

/**
 * Communication protocol: how bytes become messages. `encode` is stateless;
 * `decoder()` mints one stateful Decoder per link so peers never share a buffer.
 */
export interface Codec {
  readonly id: CodecId
  encode(message: WireMessage): TransportFrame[]
  decoder(): Decoder
}

export interface CodecRegistry {
  register(codec: Codec): Disposable
  get(id: CodecId): Codec | null
}

export interface ChannelPolicy {
  readonly reconnect?: {
    readonly backoffMs: number
    readonly maxAttempts: number
    readonly idempotent?: (method: string) => boolean
  }
  readonly requestTimeoutMs?: number
}

/**
 * Codec ∘ Connection composition. Caller arm `request`, callee arm `subscribe`,
 * one-way arm `notify`; method strings dispatch, types are the standard's skin.
 */
export interface Channel extends Disposable {
  readonly codecId: CodecId
  request(method: string, payload: unknown): Promise<unknown>
  subscribe(method: string, handler: MethodHandler): Disposable
  notify(method: string, payload: unknown): void
}

export interface ProbeEvidence<Raw extends RawCapability = RawCapability> {
  readonly standard: StandardId
  readonly raw: Raw
  readonly observedAt: string
}

export interface Client<Capability extends JsonValue = JsonValue> extends Disposable {
  readonly id: ClientId
  readonly owner: ClusterKey
  readonly standard: StandardId
  readonly host: HostId
  readonly endpoint: EndpointId
  readonly connection: ConnectionId
  readonly capability: Capability
  readonly methods: readonly string[]
  bind(method: string, handler: MethodHandler): Disposable
  describe(): Capability
}

export interface Session extends Disposable {
  readonly id: string
  readonly capabilities: JsonValue
  prompt(input: string): Promise<{ readonly stopReason: string }>
  cancel(): Promise<void>
}

export interface Server extends Disposable {
  readonly id: ServerId
  readonly owner: ClusterKey
  readonly transport: TransportId
  readonly standard: StandardId
  readonly methods: readonly string[]
  bind(method: string, handler: MethodHandler): Disposable
}

export interface ServerLink extends Disposable {
  readonly server: Server
  readonly connection: Connection
}

export interface ServerMatch {
  readonly key?: ClusterKey
  readonly standard?: StandardId
}

export interface ScopeManager {
  readonly key: ClusterKey
  discoverClients(): readonly Client[]
}

export interface ClientRegistry {
  add(client: Client): Disposable
  get(id: ClientId): Client | null
  list(): readonly Client[]
  discover(key: ClusterKey): readonly Client[]
  scope(key: ClusterKey): ScopeManager
  ensure(endpoint: EndpointId, standard: StandardId, owner?: ClusterKey): Promise<Client>
  close(id: ClientId): Promise<void>
}

export interface ServerRegistry {
  register(key: ClusterKey, transport: TransportId, standard: StandardId): Server
  servers(key?: ClusterKey): readonly Server[]
  accept(connection: Connection, match?: ServerMatch): ServerLink
  close(id: ServerId): Promise<void>
}

export interface Cluster {
  readonly key: ClusterKey
  apply(ctx: Context): void | Promise<void>
}

export interface ServerTemplate {
  readonly id: StandardId
  readonly methods: Readonly<Record<string, MethodHandler>>
  readonly notifications?: ReadonlySet<string>
  readonly codec?: Codec
  readonly mount?: (channel: Channel) => Disposable
}

export interface ClientTemplate<Raw extends RawCapability, C extends Client> {
  readonly id: StandardId
  readonly codec?: Codec
  parseCapability(raw: unknown): Raw
  probe(connection: Connection, host: HostRecord): Promise<ProbeEvidence<Raw> | null>
  client(connection: Connection, evidence: ProbeEvidence<Raw>, host: HostRecord, owner?: ClusterKey): Promise<C>
}
