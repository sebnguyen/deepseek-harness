import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AcpClientTemplate, AcpServerTemplate, ACP, type AcpClient } from '../../standard-acp/src/index.ts'
import { ClientRegistry } from '../../client-registry/src/index.ts'
import { ClientTemplateRegistry } from '../../client-standard-registry/src/index.ts'
import { HostDiscovery } from '../../host-discovery/src/index.ts'
import { HostRegistry } from '../../host-registry/src/index.ts'
import { InprocTransport } from '../../transport-inproc/src/index.ts'
import { ServerRegistry } from '../../server-registry/src/index.ts'
import { ServerTemplateRegistry } from '../../server-standard-registry/src/index.ts'
import { TransportRegistry } from '../../transport-registry/src/index.ts'
import { scriptedPeer } from '../../coral/tests/helpers.ts'
import { Orchestrator, type ClusterGraph } from '../src/index.ts'
import type { ClusterKey, EndpointId, HostId, HostEndpoint, TransportId } from '../../coral/src/types.ts'

const HOST = 'orchestrator-test' as HostId

function endpoint(id: string): HostEndpoint {
  return { id: id as EndpointId, transport: 'inproc' as TransportId, url: null }
}

function context(): {
  ctx: Context
  transports: TransportRegistry
  servers: ServerRegistry
  clients: ClientRegistry
  orchestrator: Orchestrator
} {
  const ctx = new Context()
  const transports = new TransportRegistry(ctx)
  transports.register(new InprocTransport())
  const servers = new ServerRegistry(ctx)
  const clients = new ClientRegistry(ctx)
  void new HostRegistry(ctx)
  const standards = new ClientTemplateRegistry(ctx)
  const serverStandards = new ServerTemplateRegistry(ctx)
  standards.register(new AcpClientTemplate())
  serverStandards.register(new AcpServerTemplate())
  void new HostDiscovery(ctx)
  const orchestrator = new Orchestrator(ctx)
  return { ctx, transports, servers, clients, orchestrator }
}

describe('coral orchestrator graph', () => {
  it('lets one master talk to three members and denies member-to-member links', async () => {
    const { ctx, transports, servers, clients, orchestrator } = context()
    const master = 'master' as ClusterKey
    const members = ['member-a', 'member-b', 'member-c'] as ClusterKey[]
    const memberEndpoints = members.map((key, index) => endpoint(`endpoint-${index}`))

    orchestrator.registerFactory('master', node => ({ key: node.key, apply() {} }))
    orchestrator.registerFactory('member', node => ({
      key: node.key,
      apply(child) {
        const declared = node.endpoints?.[0]
        if (declared === undefined) throw new Error('member has no endpoint')
        const server = child.coralServers.register(node.key, 'inproc' as TransportId, ACP)
        child.effect(() => () => child.coralServers.close(server.id))

        const transport = child.coralTransports.get('inproc') as InprocTransport
        const listener = transport.listen({ host: HOST, endpoint: declared }, (connection) => {
          const link = child.coralServers.accept(connection, { key: node.key, standard: ACP })
          child.effect(() => () => link.dispose())
          scriptedPeer(link.connection, { reply: `${node.key}:pong` })
        })
        child.effect(() => () => listener.dispose())
      },
    }))

    const nodes = [
      { key: master, kind: 'master' },
      ...members.map((key, index) => ({
        key,
        kind: 'member',
        endpoints: [memberEndpoints[index]!],
        servers: [{ endpoint: memberEndpoints[index]!.id, standard: ACP }],
      })),
    ]
    const edges = [
      ...members.map(key => ({ from: master, to: key })),
      ...members.map(key => ({ from: key, to: master })),
    ]
    const graph: ClusterGraph = { master, nodes, edges }

    await orchestrator.applyGraph(graph)

    expect(orchestrator.list()).toHaveLength(4)
    expect(orchestrator.servers(master)).toHaveLength(0)
    for (const key of members) expect(orchestrator.servers(key)).toHaveLength(1)

    for (const key of members) {
      const client = await orchestrator.connect(master, key)
      expect(client.owner).toBe(master)
      const session = await (client as AcpClient).openSession()
      await expect(session.prompt('ping')).resolves.toEqual({ stopReason: 'end_turn' })
    }

    expect(orchestrator.clients(master)).toHaveLength(3)
    await expect(orchestrator.connect(members[0]!, members[1]!)).rejects.toThrow(/not linked/)
    await expect(orchestrator.connect(members[1]!, members[2]!)).rejects.toThrow(/not linked/)

    for (const client of [...orchestrator.clients(master)]) await clients.close(client.id)
    await orchestrator.dispose()
    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a hosted endpoint owned by a member', async () => {
    const { ctx, transports, servers, orchestrator } = context()
    const master = 'master' as ClusterKey
    const member = 'member' as ClusterKey
    const hosted = {
      id: 'hosted' as EndpointId,
      transport: 'socket' as TransportId,
      url: new URL('tcp://127.0.0.1:9999'),
    }

    await expect(orchestrator.applyGraph({
      master,
      nodes: [
        { key: master },
        { key: member, endpoints: [hosted] },
      ],
      edges: [],
    })).rejects.toThrow(/must be owned by master/)

    await servers.dispose()
    await transports.dispose()
    await ctx.fiber.dispose()
  })
})
