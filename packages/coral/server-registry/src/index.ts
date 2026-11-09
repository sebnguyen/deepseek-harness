import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  ClusterKey,
  Connection,
  Disposable,
  MethodHandler,
  Server,
  ServerId,
  ServerLink,
  ServerMatch,
  ServerRegistry as ServerRegistryContract,
  ServerTemplate,
  StandardId,
  Transport,
  TransportId,
} from '@deepseek-ai/dsh-coral'

class RegisteredServer implements Server {
  readonly id = randomUUID() as ServerId
  readonly methods: readonly string[]
  private readonly handlers = new Map<string, MethodHandler>()
  private readonly defaults = new Map<string, MethodHandler>()

  constructor(
    readonly owner: ClusterKey,
    readonly transport: TransportId,
    readonly standard: StandardId,
    template: ServerTemplate,
  ) {
    this.methods = Object.keys(template.methods)
    for (const method of this.methods) {
      const handler = template.methods[method] ?? (() => undefined)
      this.defaults.set(method, handler)
      this.handlers.set(method, handler)
    }
  }

  bind(method: string, handler: MethodHandler): Disposable {
    this.handlers.set(method, handler)
    return {
      dispose: () => {
        const fallback = this.defaults.get(method)
        if (fallback === undefined) this.handlers.delete(method)
        else this.handlers.set(method, fallback)
      },
    }
  }

  dispose(): void {
    this.handlers.clear()
    this.defaults.clear()
  }
}

class AcceptedServerLink implements ServerLink {
  private disposed = false

  constructor(
    readonly server: Server,
    readonly connection: Connection,
    private readonly links: Set<ServerLink>,
  ) {}

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.links.delete(this)
    await this.connection.dispose()
  }
}

export class ServerRegistry extends Service implements ServerRegistryContract {
  private readonly byId = new Map<ServerId, RegisteredServer>()
  private readonly links = new Set<ServerLink>()
  private readonly claims = new Map<ServerId, Disposable>()

  constructor(ctx: Context) {
    super(ctx, 'coralServers')
  }

  register(key: ClusterKey, transport: TransportId, standard: StandardId): Server {
    const transports = this.ctx.get('coralTransports', false) as {
      get(id: TransportId): Transport | null
      claim(transport: Transport, standard: StandardId): Disposable
    } | undefined
    if (transports === undefined) throw new Error('coral: coralServers requires coralTransports')
    const found = transports.get(transport)
    if (found === null) throw new Error(`coral: unknown transport ${transport}`)
    const claim = transports.claim(found, standard)
    const template = this.template(standard)
    const server = new RegisteredServer(key, transport, standard, template)
    this.byId.set(server.id, server)
    this.claims.set(server.id, claim)
    return server
  }

  servers(key?: ClusterKey): readonly Server[] {
    return [...this.byId.values()].filter(server => key === undefined || server.owner === key)
  }

  accept(connection: Connection, match: ServerMatch = {}): ServerLink {
    const candidates = [...this.byId.values()].filter(server =>
      server.transport === connection.transport
      && (match.key === undefined || server.owner === match.key)
      && (match.standard === undefined || server.standard === match.standard))
    const target = `${connection.transport}/${match.key ?? '*'}/${match.standard ?? '*'}`
    const candidate = candidates[0]
    if (candidate === undefined) throw new Error(`coral: no server for ${target}`)
    if (candidates.length > 1) throw new Error(`coral: multiple servers match ${target}`)
    const link = new AcceptedServerLink(candidate, connection, this.links)
    this.links.add(link)
    return link
  }

  async close(id: ServerId): Promise<void> {
    const server = this.byId.get(id)
    if (server === undefined) return
    this.byId.delete(id)
    for (const link of [...this.links]) {
      if (link.server === server) await link.dispose()
    }
    this.claims.get(id)?.dispose()
    this.claims.delete(id)
    server.dispose()
  }

  async dispose(): Promise<void> {
    for (const link of [...this.links]) await link.dispose()
    for (const server of this.byId.values()) server.dispose()
    for (const claim of this.claims.values()) claim.dispose()
    this.byId.clear()
    this.claims.clear()
  }

  private template(standard: StandardId): ServerTemplate {
    const registry = this.ctx.get('coralServerStandards', false) as {
      get(id: StandardId): ServerTemplate | null
    } | undefined
    const found = registry?.get(standard)
    return found ?? { id: standard, methods: {} }
  }
}

export const serverRegistry = {
  name: 'coral.server.registry',
  apply(ctx: Context): void {
    void new ServerRegistry(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralServers: ServerRegistry
  }
}
