import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ACP, AcpClientTemplate, AcpServerTemplate, acpStandard } from '../../standard-acp/src/index.ts'
import { InprocTransport } from '../../transport-inproc/src/index.ts'
import { clientRegistry } from '../../client-registry/src/index.ts'
import { clientTemplateRegistry } from '../../client-standard-registry/src/index.ts'
import { hostDiscovery } from '../../host-discovery/src/index.ts'
import { hostRegistry } from '../../host-registry/src/index.ts'
import { inprocTransport } from '../../transport-inproc/src/index.ts'
import { serverRegistry } from '../../server-registry/src/index.ts'
import { serverTemplateRegistry } from '../../server-standard-registry/src/index.ts'
import { transportRegistry } from '../../transport-registry/src/index.ts'
import { endpoint, ref, scriptedPeer } from './helpers.ts'
import type { TransportId } from '../src/types.ts'

async function mount(ctx: Context): Promise<void> {
  await ctx.plugin(hostRegistry)
  await ctx.plugin(transportRegistry)
  await ctx.plugin(clientTemplateRegistry)
  await ctx.plugin(clientRegistry)
  await ctx.plugin(serverTemplateRegistry)
  await ctx.plugin(serverRegistry)
  await ctx.plugin(hostDiscovery)
  await ctx.plugin(inprocTransport)
  await ctx.plugin(acpStandard)
}

function inproc(ctx: Context): InprocTransport {
  return ctx.coralTransports.get('inproc' as TransportId) as InprocTransport
}

describe('coral plugin plane', () => {
  it('mounts, discovers an ACP peer, and prompts it', async () => {
    const ctx = new Context()
    await mount(ctx)
    expect(ctx.coralClientStandards.get(ACP)).toBeInstanceOf(AcpClientTemplate)
    expect(ctx.coralServerStandards.get(ACP)).toBeInstanceOf(AcpServerTemplate)
    ctx.effect(() => {
      const registration = inproc(ctx).listen(ref('peer-b'), (connection) => {
        scriptedPeer(connection, { reply: 'answer from B' })
      })
      return () => registration.dispose()
    })

    const host = ctx.coralDiscovery.discover([endpoint('peer-b')])
    const discovered = await host
    expect(discovered.supports.get(endpoint('peer-b').id)?.get(ACP)).toBeDefined()

    const client = await ctx.coralAcpClients.ensure(endpoint('peer-b').id)
    const session = await client.openSession()
    const result = await session.prompt('hello B')
    expect(result.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(client.updates).toHaveLength(1) })
    expect(client.updates[0]).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'answer from B' },
    })

    // C5: evidence survives the client connection.
    await client.dispose()
    expect(discovered.supports.get(endpoint('peer-b').id)?.get(ACP)).toBeDefined()

    await ctx.fiber.dispose()
  })

  it('routes two hosts concurrently and keeps client identity', async () => {
    const ctx = new Context()
    await mount(ctx)
    ctx.effect(() => {
      const first = inproc(ctx).listen(ref('peer-a'), (connection) => { scriptedPeer(connection, { reply: 'A' }) })
      const second = inproc(ctx).listen(ref('peer-b'), (connection) => { scriptedPeer(connection, { reply: 'B' }) })
      return () => { first.dispose(); second.dispose() }
    })

    await ctx.coralDiscovery.discover([endpoint('peer-a')])
    await ctx.coralDiscovery.discover([endpoint('peer-b')])
    const clientA = await ctx.coralAcpClients.ensure(endpoint('peer-a').id)
    const clientB = await ctx.coralAcpClients.ensure(endpoint('peer-b').id)

    const [first, second] = await Promise.all([clientA.openSession(), clientB.openSession()])
    await Promise.all([first.prompt('a'), second.prompt('b')])
    await vi.waitFor(() => {
      expect(clientA.updates).toHaveLength(1)
      expect(clientB.updates).toHaveLength(1)
    })
    expect(clientA.updates[0]).toMatchObject({ content: { type: 'text', text: 'A' } })
    expect(clientB.updates[0]).toMatchObject({ content: { type: 'text', text: 'B' } })

    const other = ctx.coralHosts.upsert({ endpoints: [endpoint('peer-c')] })
    expect(await ctx.coralAcpClients.ensure(endpoint('peer-a').id)).toBe(clientA)
    ctx.coralHosts.remove(other.id)
    expect(ctx.coralHosts.list()).toHaveLength(2)

    await ctx.fiber.dispose()
  })

  it('returns to an empty registry after host churn', async () => {
    const ctx = new Context()
    await mount(ctx)

    for (let index = 0; index < 20; index += 1) {
      ctx.coralHosts.upsert({ endpoints: [endpoint(`churn-${index}`)] })
    }
    expect(ctx.coralHosts.list()).toHaveLength(20)
    for (const host of [...ctx.coralHosts.list()]) ctx.coralHosts.remove(host.id)
    expect(ctx.coralHosts.list()).toHaveLength(0)

    await ctx.coralTransports.closeAll()
    await ctx.coralServers.dispose()
    await ctx.fiber.dispose()
  })
})
