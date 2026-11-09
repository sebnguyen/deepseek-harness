import { agent as createAgentApp, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { Context } from '@deepseek-ai/cordis'
import { ACP, AcpClient, acpStandard, connectionStream } from '../../standard-acp/src/index.ts'
import { clientRegistry } from '../../client-registry/src/index.ts'
import { clientTemplateRegistry } from '../../client-standard-registry/src/index.ts'
import { hostDiscovery } from '../../host-discovery/src/index.ts'
import { hostRegistry } from '../../host-registry/src/index.ts'
import { InprocTransport, inprocTransport } from '../../transport-inproc/src/index.ts'
import { serverRegistry } from '../../server-registry/src/index.ts'
import { serverTemplateRegistry } from '../../server-standard-registry/src/index.ts'
import { transportRegistry } from '../../transport-registry/src/index.ts'
import type {
  ClusterKey,
  Connection,
  EndpointId,
  HostEndpoint,
  HostId,
  JsonValue,
  TransportId,
} from '../src/types.ts'

const HOST = 'demo' as HostId

interface ClusterSpec {
  readonly key: ClusterKey
  readonly name: string
  readonly endpoint: HostEndpoint
}

function endpoint(id: string): HostEndpoint {
  return { id: id as EndpointId, transport: 'inproc' as TransportId, url: null }
}

const A: ClusterSpec = { key: 'alpha' as ClusterKey, name: 'alpha', endpoint: endpoint('peer-alpha') }
const B: ClusterSpec = { key: 'beta' as ClusterKey, name: 'beta', endpoint: endpoint('peer-beta') }

function ref(spec: ClusterSpec): { host: HostId; endpoint: HostEndpoint } {
  return { host: HOST, endpoint: spec.endpoint }
}

function serveAgent(connection: Connection, name: string): () => void {
  const app = createAgentApp({ name: `coral-${name}` })
  app
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [],
    }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: `session-${name}` }))
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `pong from ${name}` },
        },
      })
      return { stopReason: 'end_turn' as const }
    })
  const link = app.connect(connectionStream(connection))
  return () => link.close()
}

function textOf(update: JsonValue | undefined): string {
  if (update === undefined || update === null || typeof update !== 'object' || Array.isArray(update)) return ''
  const content = (update as { readonly content?: { readonly text?: unknown } }).content
  return typeof content?.text === 'string' ? content.text : ''
}

async function waitForUpdate(client: AcpClient): Promise<void> {
  for (let attempt = 0; attempt < 100 && client.updates.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  if (client.updates.length === 0) throw new Error(`no session/update from ${client.endpoint}`)
}

async function main(): Promise<void> {
  const ctx = new Context()
  const listeners: Array<{ dispose(): void }> = []
  const links: Array<{ dispose(): Promise<void> }> = []
  const closeAgents: Array<() => void> = []
  let clientA: AcpClient | null = null
  let clientB: AcpClient | null = null

  try {
    await ctx.plugin(hostRegistry)
    await ctx.plugin(transportRegistry)
    await ctx.plugin(clientTemplateRegistry)
    await ctx.plugin(clientRegistry)
    await ctx.plugin(serverTemplateRegistry)
    await ctx.plugin(serverRegistry)
    await ctx.plugin(hostDiscovery)
    await ctx.plugin(inprocTransport)
    await ctx.plugin(acpStandard)

    const transport = ctx.coralTransports.get('inproc' as TransportId) as InprocTransport

    for (const cluster of [A, B]) {
      const server = ctx.coralServers.register(cluster.key, 'inproc' as TransportId, ACP)
      console.log(`[server] ${cluster.name}: registered ${server.id} (${server.transport}/${server.standard})`)
      listeners.push(transport.listen(ref(cluster), (connection) => {
        try {
          const link = ctx.coralServers.accept(connection, { key: cluster.key, standard: ACP })
          links.push(link)
          closeAgents.push(serveAgent(link.connection, cluster.name))
        } catch (error) {
          console.error(`[server] ${cluster.name}: ${String(error)}`)
          void connection.dispose()
        }
      }))
    }

    await ctx.coralDiscovery.discover([A.endpoint])
    await ctx.coralDiscovery.discover([B.endpoint])
    console.log('[discovery] both endpoints advertise acp')

    clientA = await ctx.coralAcpClients.ensure(B.endpoint.id, A.key)
    clientB = await ctx.coralAcpClients.ensure(A.endpoint.id, B.key)
    console.log(`[client] ${A.name} owns ${clientA.id} -> ${B.name}`)
    console.log(`[client] ${B.name} owns ${clientB.id} -> ${A.name}`)

    const scopedA = ctx.coralClients.scope(A.key).discoverClients()
    const scopedB = ctx.coralClients.scope(B.key).discoverClients()
    console.log(`[scope] ${A.name}: ${scopedA.length} client(s); ${B.name}: ${scopedB.length} client(s)`)
    if (scopedA.length !== 1 || scopedB.length !== 1) throw new Error('cluster scope did not isolate clients')

    const sessionA = await clientA.openSession()
    const responseA = await sessionA.prompt('ping from alpha')
    await waitForUpdate(clientA)
    const textA = textOf(clientA.updates[0])
    console.log(`[acp] ${A.name} -> ${B.name}: ${textA} (${responseA.stopReason})`)

    const sessionB = await clientB.openSession()
    const responseB = await sessionB.prompt('ping from beta')
    await waitForUpdate(clientB)
    const textB = textOf(clientB.updates[0])
    console.log(`[acp] ${B.name} -> ${A.name}: ${textB} (${responseB.stopReason})`)

    if (textA !== 'pong from beta') throw new Error(`alpha got ${JSON.stringify(textA)}`)
    if (textB !== 'pong from alpha') throw new Error(`beta got ${JSON.stringify(textB)}`)

    console.log('MULTI-CLUSTER ACP DEMO PASSED')
  } finally {
    for (const close of closeAgents.reverse()) close()
    for (const link of links.reverse()) await link.dispose()
    if (clientA !== null) await clientA.dispose()
    if (clientB !== null) await clientB.dispose()
    for (const listener of listeners) listener.dispose()
    await ctx.coralTransports.closeAll()
    await ctx.fiber.dispose()
  }
}

await main()
