import { Service, type Context, type Fiber } from '@deepseek-ai/cordis'
import type {
  Client,
  Cluster as CoreCluster,
  ClusterKey,
  EndpointId,
  HostEndpoint,
  Server,
  StandardId,
} from '@deepseek-ai/dsh-coral'

export type Cluster = CoreCluster

export interface ServerNode {
  readonly endpoint: EndpointId
  readonly standard: StandardId
}

export interface ClientNode {
  readonly endpoint: EndpointId
  readonly standard?: StandardId
}

export interface ClusterNode {
  readonly key: ClusterKey
  readonly kind?: string
  readonly endpoints?: readonly HostEndpoint[]
  readonly servers?: readonly ServerNode[]
  readonly clients?: readonly ClientNode[]
}

export interface ClusterEdge {
  readonly from: ClusterKey
  readonly to: ClusterKey
  readonly standard?: StandardId
}

export interface ClusterGraph {
  readonly master: ClusterKey
  readonly nodes: readonly ClusterNode[]
  readonly edges: readonly ClusterEdge[]
}

export type ClusterRole = 'master' | 'member'
export type ClusterFactory = (node: ClusterNode, role: ClusterRole) => Cluster

export type ClusterState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export interface ClusterStatus {
  readonly key: ClusterKey
  readonly state: ClusterState
  readonly servers: number
  readonly clients: number
  readonly error: string | null
}

export interface ClusterHandle {
  readonly key: ClusterKey
  readonly cluster: Cluster
  status(): ClusterStatus
  start(): Promise<void>
  stop(): Promise<void>
}

interface Mounted {
  readonly cluster: Cluster
  fiber: Fiber | null
  state: ClusterState
  error: string | null
}

interface ClientLookup {
  ensure(endpoint: EndpointId, standard: StandardId, owner?: ClusterKey): Promise<Client>
  discover(key: ClusterKey): readonly Client[]
}

interface ServerLookup {
  servers(key?: ClusterKey): readonly Server[]
}

interface DiscoveryLookup {
  discover(endpoints: readonly HostEndpoint[]): Promise<unknown>
}

const HOSTED = new Set(['socket', 'http', 'ws'])

function edgeKey(from: ClusterKey, to: ClusterKey): string {
  return `${from}\u0000${to}`
}

export class Orchestrator extends Service {
  private graphValue: ClusterGraph | null = null
  private readonly records = new Map<ClusterKey, Mounted>()
  private readonly factories = new Map<string, ClusterFactory>()
  private readonly edges = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'coralOrchestrator')
  }

  private clientStore(): ClientLookup {
    const registry = this.ctx.get('coralClients', false) as ClientLookup | undefined
    if (registry === undefined) throw new Error('coral: coralOrchestrator requires coralClients')
    return registry
  }

  private serverStore(): ServerLookup {
    const registry = this.ctx.get('coralServers', false) as ServerLookup | undefined
    if (registry === undefined) throw new Error('coral: coralOrchestrator requires coralServers')
    return registry
  }

  registerFactory(kind: string, factory: ClusterFactory): { dispose(): void } {
    this.factories.set(kind, factory)
    this.ctx.effect(() => () => { this.factories.delete(kind) })
    return { dispose: () => { this.factories.delete(kind) } }
  }

  async add(cluster: Cluster): Promise<ClusterHandle> {
    if (this.records.has(cluster.key)) throw new Error(`coral: cluster ${cluster.key} already exists`)
    const record: Mounted = { cluster, fiber: null, state: 'idle', error: null }
    this.records.set(cluster.key, record)
    return this.handle(cluster.key)
  }

  get(key: ClusterKey): ClusterHandle | null {
    return this.records.has(key) ? this.handle(key) : null
  }

  list(): readonly ClusterStatus[] {
    return [...this.records.keys()].map(key => this.status(key))
  }

  serversOf(key: ClusterKey): readonly Server[] {
    return this.serverStore().servers(key)
  }

  clientsOf(key: ClusterKey): readonly Client[] {
    return this.clientStore().discover(key)
  }

  servers(key: ClusterKey): readonly Server[] {
    return this.serversOf(key)
  }

  clients(key: ClusterKey): readonly Client[] {
    return this.clientsOf(key)
  }

  endpoints(key: ClusterKey): readonly HostEndpoint[] {
    return this.graphValue?.nodes.find(node => node.key === key)?.endpoints ?? []
  }

  graph(): ClusterGraph {
    if (this.graphValue === null) throw new Error('coral: no graph applied')
    return this.graphValue
  }

  async applyGraph(graph: ClusterGraph): Promise<void> {
    if (this.graphValue !== null) throw new Error('coral: graph already applied')
    this.validate(graph)

    const master = graph.nodes.find(node => node.key === graph.master)
    if (master === undefined) throw new Error(`coral: no master node for ${graph.master}`)
    const ordered = [master, ...graph.nodes.filter(node => node.key !== graph.master)]
    const records = new Map<ClusterKey, Mounted>()

    try {
      for (const node of ordered) {
        const role: ClusterRole = node.key === graph.master ? 'master' : 'member'
        const factory = node.kind === undefined ? undefined : this.factories.get(node.kind)
        if (factory === undefined) {
          throw new Error(`coral: no cluster factory for ${node.kind ?? node.key}`)
        }
        const cluster = factory(node, role)
        if (cluster.key !== node.key) throw new Error(`coral: factory returned ${cluster.key} for ${node.key}`)
        const record: Mounted = { cluster, fiber: null, state: 'starting', error: null }
        records.set(node.key, record)
        const fiber = this.ctx.plugin({
          name: `coral.cluster(${node.key})`,
          apply: (child: Context) => cluster.apply(child),
        })
        record.fiber = fiber
        await fiber
        record.state = 'running'
      }

      const discovery = this.ctx.get('coralDiscovery', false) as DiscoveryLookup | undefined
      if (discovery !== undefined) {
        for (const node of graph.nodes) {
          if (node.endpoints !== undefined && node.endpoints.length > 0) {
            await discovery.discover(node.endpoints)
          }
        }
      }
    } catch (error) {
      for (const record of [...records.values()].reverse()) await record.fiber?.dispose()
      for (const record of records.values()) record.state = 'failed'
      throw error
    }

    this.records.clear()
    for (const [key, record] of records) this.records.set(key, record)
    this.graphValue = graph
    this.edges.clear()
    for (const edge of graph.edges) this.edges.add(edgeKey(edge.from, edge.to))
  }

  async connect(from: ClusterKey, to: ClusterKey, standard?: StandardId): Promise<Client> {
    const graph = this.graph()
    if (!this.edges.has(edgeKey(from, to))) {
      throw new Error(`coral: cluster ${from} is not linked to ${to}`)
    }
    const allowed = graph.edges.some(edge =>
      edge.from === from
      && edge.to === to
      && (edge.standard === undefined || standard === undefined || edge.standard === standard))
    if (!allowed) throw new Error(`coral: ${from} -> ${to} does not allow ${standard}`)

    const target = graph.nodes.find(node => node.key === to)
    if (target === undefined) throw new Error(`coral: unknown cluster ${to}`)
    const server = target.servers?.find(candidate => standard === undefined || candidate.standard === standard)
    if (server === undefined) throw new Error(`coral: cluster ${to} has no server ${standard ?? '*'}`)
    const endpoint = target.endpoints?.find(candidate => candidate.id === server.endpoint)
    if (endpoint === undefined) throw new Error(`coral: unknown endpoint ${server.endpoint}`)
    return this.clientStore().ensure(endpoint.id, server.standard, from)
  }

  async start(key: ClusterKey): Promise<void> {
    const record = this.record(key)
    if (record.state === 'running') return
    if (record.state === 'starting' || record.state === 'stopping') {
      throw new Error(`coral: cluster ${key} is ${record.state}`)
    }
    record.state = 'starting'
    record.error = null
    try {
      const fiber = this.ctx.plugin({
        name: `coral.cluster(${key})`,
        apply: (child: Context) => record.cluster.apply(child),
      })
      record.fiber = fiber
      await fiber
      record.state = 'running'
    } catch (error) {
      await record.fiber?.dispose()
      record.fiber = null
      record.state = 'failed'
      record.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async stop(key: ClusterKey): Promise<void> {
    const record = this.record(key)
    if (record.state === 'idle' || record.state === 'stopped') return
    record.state = 'stopping'
    await record.fiber?.dispose()
    record.fiber = null
    record.state = 'stopped'
    record.error = null
  }

  async remove(key: ClusterKey): Promise<void> {
    await this.stop(key)
    this.records.delete(key)
  }

  async dispose(): Promise<void> {
    for (const key of [...this.records.keys()].reverse()) await this.stop(key)
    this.records.clear()
    this.factories.clear()
    this.edges.clear()
    this.graphValue = null
  }

  private record(key: ClusterKey): Mounted {
    const record = this.records.get(key)
    if (record === undefined) throw new Error(`coral: unknown cluster ${key}`)
    return record
  }

  private status(key: ClusterKey): ClusterStatus {
    const record = this.record(key)
    return {
      key,
      state: record.state,
      servers: this.serversOf(key).length,
      clients: this.clientsOf(key).length,
      error: record.error,
    }
  }

  private handle(key: ClusterKey): ClusterHandle {
    const record = this.record(key)
    return {
      key,
      cluster: record.cluster,
      status: () => this.status(key),
      start: () => this.start(key),
      stop: () => this.stop(key),
    }
  }

  private validate(graph: ClusterGraph): void {
    const keys = new Set<ClusterKey>()
    for (const node of graph.nodes) {
      if (keys.has(node.key)) throw new Error(`coral: duplicate cluster ${node.key}`)
      keys.add(node.key)
    }
    if (!keys.has(graph.master)) throw new Error(`coral: master ${graph.master} is not a node`)

    const endpoints = new Set<EndpointId>()
    for (const node of graph.nodes) {
      for (const endpoint of node.endpoints ?? []) {
        if (endpoints.has(endpoint.id)) throw new Error(`coral: duplicate endpoint ${endpoint.id}`)
        endpoints.add(endpoint.id)
        if (HOSTED.has(endpoint.transport) && node.key !== graph.master) {
          throw new Error(`coral: hosted endpoint ${endpoint.id} must be owned by ${graph.master}`)
        }
      }
      for (const server of node.servers ?? []) {
        if (!(node.endpoints ?? []).some(endpoint => endpoint.id === server.endpoint)) {
          throw new Error(`coral: server ${server.endpoint} is not an endpoint of ${node.key}`)
        }
      }
    }
    for (const edge of graph.edges) {
      if (!keys.has(edge.from)) throw new Error(`coral: edge from unknown ${edge.from}`)
      if (!keys.has(edge.to)) throw new Error(`coral: edge to unknown ${edge.to}`)
    }
  }
}

export const orchestrator = {
  name: 'coral.orchestrator',
  apply(ctx: Context): void {
    void new Orchestrator(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralOrchestrator: Orchestrator
  }
}
