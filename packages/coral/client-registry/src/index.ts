import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  Client,
  ClientId,
  ClientRegistry as ClientRegistryContract,
  ClientTemplate,
  ClusterKey,
  Disposable,
  EndpointId,
  HostEndpoint,
  HostRecord,
  ProbeEvidence,
  ScopeManager,
  StandardId,
  Transport,
} from '@deepseek-ai/dsh-coral'

interface HostLookup {
  findEndpoint(endpoint: EndpointId): { host: HostRecord; endpoint: HostEndpoint } | null
}

interface TransportLookup {
  get(id: Transport['id']): Transport | null
}

interface StandardLookup {
  get(id: StandardId): ClientTemplate<unknown, Client> | null
}

function disposer(fn: () => void): Disposable {
  return { dispose: fn }
}

export class ClientRegistry extends Service implements ClientRegistryContract {
  private readonly clients = new Map<ClientId, Client>()

  constructor(ctx: Context) {
    super(ctx, 'coralClients')
  }

  add(client: Client): Disposable {
    for (const existing of this.clients.values()) {
      if (existing.host === client.host && existing.endpoint === client.endpoint && existing.standard === client.standard) {
        throw new Error(`coral: client already exists for ${client.host}/${client.endpoint}/${client.standard}`)
      }
    }
    this.clients.set(client.id, client)
    return disposer(() => { this.clients.delete(client.id) })
  }

  get(id: ClientId): Client | null {
    return this.clients.get(id) ?? null
  }

  list(): readonly Client[] {
    return [...this.clients.values()]
  }

  discover(key: ClusterKey): readonly Client[] {
    return this.list().filter(client => client.owner === key)
  }

  scope(key: ClusterKey): ScopeManager {
    return new ClientScope(this, key)
  }

  byEndpoint(endpoint: EndpointId): readonly Client[] {
    return this.list().filter(client => client.endpoint === endpoint)
  }

  byStandard(standard: StandardId): readonly Client[] {
    return this.list().filter(client => client.standard === standard)
  }

  remove(id: ClientId): void {
    this.clients.delete(id)
  }

  async ensure(endpoint: EndpointId, standard: StandardId, owner: ClusterKey = 'local' as ClusterKey): Promise<Client> {
    const existing = this.list().find(client =>
      client.owner === owner && client.endpoint === endpoint && client.standard === standard)
    if (existing !== undefined) return existing

    const hosts = this.ctx.get('coralHosts', false) as HostLookup | undefined
    const transports = this.ctx.get('coralTransports', false) as TransportLookup | undefined
    const standards = this.ctx.get('coralClientStandards', false) as StandardLookup | undefined
    if (hosts === undefined) throw new Error('coral: coralClients.ensure requires coralHosts')
    if (transports === undefined) throw new Error('coral: coralClients.ensure requires coralTransports')
    if (standards === undefined) throw new Error('coral: coralClients.ensure requires coralClientStandards')

    const found = hosts.findEndpoint(endpoint)
    if (found === null) throw new Error(`coral: unknown endpoint ${endpoint}`)
    const evidence = found.host.supports.get(endpoint)?.get(standard)
    if (evidence === undefined) throw new Error(`coral: ${endpoint} does not support ${standard}`)
    const transport = transports.get(found.endpoint.transport)
    if (transport === null) throw new Error(`coral: no transport ${found.endpoint.transport}`)
    const template = standards.get(standard)
    if (template === null) throw new Error(`coral: no client standard ${standard}`)

    const connection = await transport.dial(found.endpoint, {})
    try {
      const client = await template.client(connection, evidence as ProbeEvidence, found.host, owner)
      this.add(client)
      return client
    } catch (error) {
      await connection.dispose()
      throw error
    }
  }

  async close(id: ClientId): Promise<void> {
    const client = this.clients.get(id)
    if (client === undefined) return
    this.clients.delete(id)
    await client.dispose()
  }
}

class ClientScope implements ScopeManager {
  constructor(
    private readonly registry: ClientRegistry,
    readonly key: ClusterKey,
  ) {}

  discoverClients(): readonly Client[] {
    return this.registry.discover(this.key)
  }
}

export const clientRegistry = {
  name: 'coral.client.registry',
  apply(ctx: Context): void {
    void new ClientRegistry(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralClients: ClientRegistry
  }
}
