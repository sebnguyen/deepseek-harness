import { describe, expect, it } from 'vitest'
import { methods } from '@agentclientprotocol/sdk'
import { AcpClientTemplate } from '../../standard-acp/src/index.ts'
import { MethodRegistry } from '../src/shell.ts'
import { hostRecord, pair, scriptedPeer } from './helpers.ts'

describe('coral method registry', () => {
  type Methods = {
    ping: { readonly context: { readonly text: string }; readonly result: string }
  }

  it('binds, dispatches, rejects duplicates, and unbinds', async () => {
    const registry = new MethodRegistry<Methods>()
    const binding = registry.bind('ping', ({ text }) => `pong:${text}`)

    expect(registry.methods).toEqual(['ping'])
    await expect(registry.dispatch('ping', { text: 'a' })).resolves.toBe('pong:a')
    expect(() => registry.bind('ping', () => 'again')).toThrow(/already bound/)

    binding.dispose()
    expect(registry.methods).toEqual([])
    await expect(registry.dispatch('ping', { text: 'a' })).rejects.toThrow(/no handler/)

    registry.dispose()
  })
})

describe('coral bindable shells', () => {
  it('exposes a client shell with the default update handler bound', async () => {
    const template = new AcpClientTemplate()

    const [probeClient, probeServer] = pair()
    scriptedPeer(probeServer)
    const evidence = await template.probe(probeClient, hostRecord())
    if (evidence === null) throw new Error('probe failed')

    const [clientSide, serverSide] = pair()
    scriptedPeer(serverSide)
    const client = await template.client(clientSide, evidence, hostRecord())

    expect(client.methods).toContain(methods.client.session.update)
    expect(() => client.bindNotification(methods.client.session.update, () => {})).toThrow(/already bound/)

    const binding = client.bind(methods.client.fs.readTextFile, async () => ({ content: 'x' }))
    expect(client.methods).toContain(methods.client.fs.readTextFile)
    binding.dispose()
    expect(client.methods).not.toContain(methods.client.fs.readTextFile)

    await client.dispose()
  })
})
