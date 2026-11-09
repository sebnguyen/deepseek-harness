import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  client as createClientApp,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type ClientNotificationHandlersByMethod,
  type ClientNotificationMethod,
  type ClientRequestHandlersByMethod,
  type ClientRequestMethod,
} from '@agentclientprotocol/sdk'
import { ACP, connectionStream, mountTemplate, ndjsonCodec, type AcpCapability } from '@deepseek-ai/dsh-coral'
import { MethodRegistry, flattenMethods, type RegistryMethodHandler } from '@deepseek-ai/dsh-coral'
import { ClientTemplateRegistry } from '@deepseek-ai/dsh-coral-client-standard-registry'
import { ServerTemplateRegistry } from '@deepseek-ai/dsh-coral-server-standard-registry'
import { ClientRegistry } from '@deepseek-ai/dsh-coral-client-registry'
import { HostRegistry } from '@deepseek-ai/dsh-coral-host-registry'
import { TransportRegistry } from '@deepseek-ai/dsh-coral-transport-registry'
import { PeerToolError } from '@deepseek-ai/dsh-coral'
import type {
  Channel,
  Client,
  ClientId,
  ClientTemplate,
  ClusterKey,
  Codec,
  Connection,
  ConnectionId,
  EndpointId,
  HostId,
  HostRecord,
  JsonValue,
  ProbeEvidence,
  Session,
  StandardId,
  Disposable,
  MethodHandler,
  ServerTemplate,
} from '@deepseek-ai/dsh-coral'

export { ACP, connectionStream, type AcpCapability } from '@deepseek-ai/dsh-coral'

type ClientApp = ReturnType<typeof createClientApp>
type ClientPeer = ReturnType<ClientApp['connect']>

function connectClient(connection: Connection): { readonly app: ClientApp; readonly peer: ClientPeer } {
  const app = createClientApp({ name: 'dsh-coral' })
  return { app, peer: app.connect(connectionStream(connection)) }
}

export class AcpClientTemplate implements ClientTemplate<AcpCapability, AcpClient> {
  readonly id: StandardId = ACP
  readonly codec: Codec = ndjsonCodec

  parseCapability(raw: unknown): AcpCapability {
    return raw as AcpCapability
  }

  async probe(connection: Connection, _host: HostRecord): Promise<ProbeEvidence<AcpCapability> | null> {
    try {
      const { peer } = connectClient(connection)
      const raw = await peer.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      return {
        standard: this.id,
        raw: raw as unknown as AcpCapability,
        observedAt: new Date().toISOString(),
      }
    } catch {
      return null
    } finally {
      await connection.dispose()
    }
  }

  async client(
    connection: Connection,
    evidence: ProbeEvidence<AcpCapability>,
    _host: HostRecord,
    owner: ClusterKey = 'local' as ClusterKey,
  ): Promise<AcpClient> {
    const updates: JsonValue[] = []
    const client = new AcpClient(connection, evidence.raw, updates, owner)
    await client.initialize()
    return client
  }
}

export interface SessionModes {
  readonly currentModeId: string
  readonly availableModes: readonly { readonly id: string; readonly name: string }[]
}

const CLIENT_NOTIFICATION_METHODS = new Set<string>([
  methods.client.session.update,
  methods.client.elicitation.complete,
])

const CLIENT_METHODS = flattenMethods(methods.client)

export type AcpClientMethods = {
  [M in ClientRequestMethod]: {
    readonly context: Parameters<ClientRequestHandlersByMethod[M]>[0]
    readonly result: Awaited<ReturnType<ClientRequestHandlersByMethod[M]>>
  }
} & {
  [M in ClientNotificationMethod]: {
    readonly context: Parameters<ClientNotificationHandlersByMethod[M]>[0]
    readonly result: void
  }
}

export type ClientHandlerRegistry = MethodRegistry<AcpClientMethods>

export interface ClientShell extends Disposable {
  bind<M extends ClientRequestMethod>(method: M, handler: ClientRequestHandlersByMethod[M]): Disposable
  bindNotification<M extends ClientNotificationMethod>(method: M, handler: ClientNotificationHandlersByMethod[M]): Disposable
  readonly methods: readonly string[]
}

export class AcpClient implements Client<AcpCapability>, ClientShell {
  readonly id = randomUUID() as ClientId
  readonly standard: StandardId = ACP
  readonly host: HostId
  readonly endpoint: EndpointId
  readonly connection: ConnectionId
  private readonly app: ClientApp
  private readonly peer: ClientPeer
  private readonly requests: ClientHandlerRegistry = new MethodRegistry<AcpClientMethods>()
  private readonly notifications: ClientHandlerRegistry = new MethodRegistry<AcpClientMethods>()
  private readonly attachedRequests = new Set<string>()
  private readonly attachedNotifications = new Set<string>()

  constructor(
    private readonly wire: Connection,
    readonly capability: AcpCapability,
    readonly updates: JsonValue[],
    readonly owner: ClusterKey = 'local' as ClusterKey,
  ) {
    this.host = wire.host
    this.endpoint = wire.endpoint
    this.connection = wire.id
    this.app = createClientApp({ name: 'dsh-coral' })
    for (const method of CLIENT_METHODS) {
      if (CLIENT_NOTIFICATION_METHODS.has(method)) {
        this.attachNotification(method as ClientNotificationMethod)
      } else {
        this.attachRequest(method as ClientRequestMethod)
      }
    }
    this.bindNotification(methods.client.session.update, ({ params }) => {
      this.updates.push(params.update as unknown as JsonValue)
    })
    this.peer = this.app.connect(connectionStream(wire))
  }

  async initialize(): Promise<void> {
    await this.peer.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
  }

  bind(method: string, handler: MethodHandler): Disposable
  bind<M extends ClientRequestMethod>(method: M, handler: ClientRequestHandlersByMethod[M]): Disposable
  bind(method: string, handler: MethodHandler | ClientRequestHandlersByMethod[ClientRequestMethod]): Disposable {
    if (CLIENT_NOTIFICATION_METHODS.has(method)) {
      return this.bindNotification(
        method as ClientNotificationMethod,
        handler as unknown as ClientNotificationHandlersByMethod[ClientNotificationMethod],
      )
    }
    this.attachRequest(method as ClientRequestMethod)
    return this.requests.bind(
      method as ClientRequestMethod,
      handler as unknown as RegistryMethodHandler<AcpClientMethods, ClientRequestMethod>,
    )
  }

  bindNotification<M extends ClientNotificationMethod>(method: M, handler: ClientNotificationHandlersByMethod[M]): Disposable {
    this.attachNotification(method)
    return this.notifications.bind(method, handler as unknown as RegistryMethodHandler<AcpClientMethods, M>)
  }

  get methods(): readonly string[] {
    return [...this.requests.methods, ...this.notifications.methods]
  }

  private attachRequest(method: ClientRequestMethod): void {
    if (this.attachedRequests.has(method)) return
    this.attachedRequests.add(method)
    this.app.onRequest(method, ((context: AcpClientMethods[typeof method]['context']) => {
      if (!this.requests.has(method)) throw RequestError.methodNotFound(method)
      return this.requests.dispatch(method, context)
    }) as ClientRequestHandlersByMethod[typeof method])
  }

  private attachNotification(method: ClientNotificationMethod): void {
    if (this.attachedNotifications.has(method)) return
    this.attachedNotifications.add(method)
    this.app.onNotification(method, ((context: AcpClientMethods[typeof method]['context']) => {
      if (!this.notifications.has(method)) return
      return this.notifications.dispatch(method, context)
    }) as ClientNotificationHandlersByMethod[typeof method])
  }

  describe(): AcpCapability {
    return this.capability
  }

  async openSession(): Promise<AcpSession> {
    const response = await this.peer.agent.request(methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: [],
    })
    return new AcpSession(response.sessionId, this.peer, this.updates, (response.modes ?? null) as SessionModes | null)
  }

  async loadSession(sessionId: string): Promise<AcpSession> {
    const response = await this.peer.agent.request(methods.agent.session.load, {
      sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    }) as { modes?: SessionModes | null } | undefined
    return new AcpSession(sessionId, this.peer, this.updates, response?.modes ?? null)
  }

  async dispose(): Promise<void> {
    this.requests.dispose()
    this.notifications.dispose()
    await this.wire.dispose()
  }
}

export class AcpSession implements Session {
  constructor(
    readonly id: string,
    private readonly peer: ClientPeer,
    readonly updates: JsonValue[],
    readonly modes: SessionModes | null = null,
  ) {}

  get capabilities(): JsonValue {
    return {
      modes: this.modes?.availableModes.map(mode => mode.id) ?? [],
      currentModeId: this.modes?.currentModeId ?? null,
      models: [],
      mcpServers: [],
    }
  }

  async setMode(modeId: string): Promise<void> {
    await this.peer.agent.request(methods.agent.session.setMode, { sessionId: this.id, modeId })
  }

  async prompt(input: string): Promise<{ readonly stopReason: string }> {
    const response = await this.peer.agent.request(methods.agent.session.prompt, {
      sessionId: this.id,
      prompt: [{ type: 'text', text: input }],
    })
    return { stopReason: response.stopReason }
  }

  async cancel(): Promise<void> {
    await this.peer.agent.notify(methods.agent.session.cancel, { sessionId: this.id })
  }

  async dispose(): Promise<void> {}
}


export class AcpServerTemplate implements ServerTemplate {
  readonly id: StandardId = ACP
  readonly codec: Codec = ndjsonCodec
  readonly notifications: ReadonlySet<string>
  readonly methods: Readonly<Record<string, MethodHandler>>

  constructor() {
    this.notifications = new Set<string>([
      methods.agent.session.cancel,
      methods.agent.document.didOpen,
      methods.agent.document.didChange,
      methods.agent.document.didClose,
      methods.agent.document.didSave,
      methods.agent.document.didFocus,
      methods.agent.nes.accept,
      methods.agent.nes.reject,
    ])
    this.methods = Object.fromEntries(
      flattenMethods(methods.agent).map(method => [method, () => undefined]),
    )
  }

  mount(channel: Channel): Disposable {
    return mountTemplate(this, channel)
  }
}

export class AcpClients extends Service {
  constructor(ctx: Context) {
    super(ctx, 'coralAcpClients')
  }

  private standards(): ClientTemplateRegistry {
    return this.ctx.get('coralClientStandards', false) as ClientTemplateRegistry
  }

  private clients(): ClientRegistry {
    return this.ctx.get('coralClients', false) as ClientRegistry
  }

  private hosts(): HostRegistry {
    return this.ctx.get('coralHosts', false) as HostRegistry
  }

  private transports(): TransportRegistry {
    return this.ctx.get('coralTransports', false) as TransportRegistry
  }

  list(): readonly AcpClient[] {
    return this.clients().list().filter((client): client is AcpClient => client instanceof AcpClient)
  }

  byEndpoint(endpoint: EndpointId): AcpClient | null {
    return this.list().find(client => client.endpoint === endpoint) ?? null
  }

  async ensure(endpoint: EndpointId, owner: ClusterKey = 'local' as ClusterKey): Promise<AcpClient> {
    const existing = this.byEndpoint(endpoint)
    if (existing !== null) return existing
    const found = this.hosts().findEndpoint(endpoint)
    if (found === null) throw new PeerToolError('UNKNOWN_ENDPOINT', `coral: unknown endpoint ${endpoint}`)
    const evidence = found.host.supports.get(endpoint)?.get(ACP)
    if (evidence === undefined) throw new PeerToolError('UNSUPPORTED_CAPABILITY', `coral: ${endpoint} does not support acp`)
    const transport = this.transports().get(found.endpoint.transport)
    if (transport === null) throw new PeerToolError('NO_CLIENT', `coral: no transport ${found.endpoint.transport}`)
    const standard = this.standards().get(ACP) as unknown as ClientTemplate<AcpCapability, AcpClient> | null
    if (standard === null) throw new PeerToolError('NO_CLIENT', 'coral: no acp client standard')
    const connection = await transport.dial(found.endpoint, {})
    const client = await standard.client(connection, evidence as ProbeEvidence<AcpCapability>, found.host, owner)
    this.clients().add(client)
    return client
  }
}

export const acpStandard = {
  name: 'coral.standard.acp',
  apply(ctx: Context): void {
    void new AcpClients(ctx)
    const clients = ctx.get('coralClientStandards', false) as ClientTemplateRegistry
    const servers = ctx.get('coralServerStandards', false) as ServerTemplateRegistry
    const client = new AcpClientTemplate()
    const server = new AcpServerTemplate()
    ctx.effect(() => {
      const clientRegistration = clients.register(client)
      const serverRegistration = servers.register(server)
      return () => {
        clientRegistration.dispose()
        serverRegistration.dispose()
      }
    })
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralAcpClients: AcpClients
  }
}
