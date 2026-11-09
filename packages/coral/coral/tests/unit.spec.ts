import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ACP } from '../../standard-acp/src/index.ts'
import { InprocTransport } from '../../transport-inproc/src/index.ts'
import { SocketTransport } from '../../transport-socket/src/index.ts'
import { ServerRegistry } from '../../server-registry/src/index.ts'
import { TransportRegistry } from '../../transport-registry/src/index.ts'
import { ClientRegistry } from '../../client-registry/src/index.ts'
import { clusterPlugin } from '../../cluster/src/index.ts'
import { endpoint, pair, ref } from './helpers.ts'
import type {
  Client,
  ClientId,
  Cluster,
  ClusterKey,
  ConnectionId,
  EndpointId,
  HostId,
  ServerLink,
  StandardId,
  TransportId,
} from '../src/types.ts'

describe('coral server registry', () => {
  function serverContext(): { ctx: Context; transports: TransportRegistry; servers: ServerRegistry } {
    const ctx = new Context()
    const transports = new TransportRegistry(ctx)
    transports.register(new InprocTransport())
    transports.register(new SocketTransport())
    return { ctx, transports, servers: new ServerRegistry(ctx) }
  }

  it('registers multiple servers for one cluster and filters by owner', async () => {
    const { ctx, transports, servers } = serverContext()
    const key = 'cluster-a' as ClusterKey

    const inproc = servers.register(key, 'inproc' as TransportId, ACP)
    const socket = servers.register(key, 'socket' as TransportId, ACP)

    expect(servers.servers(key)).toHaveLength(2)
    expect(inproc.owner).toBe(key)
    expect(socket.transport).toBe('socket')
    expect(servers.servers('other' as ClusterKey)).toHaveLength(0)

    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a second server on an exclusive transport and releases on close', async () => {
    const { ctx, transports, servers } = serverContext()
    const key = 'cluster-a' as ClusterKey

    const first = servers.register(key, 'socket' as TransportId, ACP)
    expect(() => servers.register(key, 'socket' as TransportId, ACP)).toThrow(/already hosts/)

    await servers.close(first.id)
    const second = servers.register(key, 'socket' as TransportId, ACP)
    expect(second.transport).toBe('socket')

    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts a server-side connection and rejects ambiguity', async () => {
    const { ctx, transports, servers } = serverContext()
    const transport = new InprocTransport()
    const key = 'cluster-a' as ClusterKey
    const server = servers.register(key, 'inproc' as TransportId, ACP)

    let link: ServerLink | null = null
    transport.listen(ref('accepted'), (connection) => { link = servers.accept(connection, { key }) })
    const client = await transport.dial(endpoint('accepted'), {})
    if (link === null) throw new Error('connection was not accepted')
    expect(link.server).toBe(server)

    await link.dispose()
    expect(client.closed).toBe(true)

    servers.register(key, 'inproc' as TransportId, ACP)
    const [, ambiguous] = pair()
    expect(() => servers.accept(ambiguous)).toThrow(/multiple servers/)
    expect(() => servers.accept(ambiguous, { standard: 'missing' as StandardId })).toThrow(/no server/)

    await transport.dispose()
    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })

  it('scopes clients to one Cluster and registers its servers', async () => {
    const { ctx, transports, servers } = serverContext()
    const clients = new ClientRegistry(ctx)
    const key = 'cluster-a' as ClusterKey

    const makeClient = (owner: ClusterKey, id: string): Client => ({
      id: id as ClientId,
      owner,
      standard: ACP,
      host: 'host' as HostId,
      endpoint: id as EndpointId,
      connection: id as ConnectionId,
      capability: null,
      methods: [],
      bind: () => ({ dispose: () => {} }),
      describe: () => null,
      dispose: async () => {},
    })
    clients.add(makeClient(key, 'owned'))
    clients.add(makeClient('cluster-b' as ClusterKey, 'other'))

    let discovered = -1
    const cluster: Cluster = {
      key,
      apply() {
        servers.register(this.key, 'inproc' as TransportId, ACP)
        discovered = clients.discover(key).length
      },
    }

    await cluster.apply(ctx)
    expect(discovered).toBe(1)
    expect(servers.servers(key)).toHaveLength(1)

    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })

  it('mounts a Cluster through the cluster plugin factory', async () => {
    const { ctx, transports, servers } = serverContext()
    new ClientRegistry(ctx)
    const key = 'cluster-mount' as ClusterKey

    const cluster: Cluster = {
      key,
      apply() {
        servers.register(this.key, 'inproc' as TransportId, ACP)
      },
    }

    await ctx.plugin(clusterPlugin(cluster))
    expect(servers.servers(key)).toHaveLength(1)

    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })
})
