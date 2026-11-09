import { describe, expect, it, vi } from 'vitest'
import { acceptChannel, channel, linkChannel, mountTemplate } from '../src/channel.ts'
import { NDJSON, ndjsonCodec } from '../src/codec.ts'
import { InprocTransport } from '../../transport-inproc/src/index.ts'
import { pair, endpoint } from './helpers.ts'
import type {
  Connection,
  ServerTemplate,
  StandardId,
} from '../src/types.ts'

describe('coral channel composition', () => {
  it('routes a request to the peer subscription and resolves the response', async () => {
    const [client, peer] = pair()
    const remote = linkChannel(peer, ndjsonCodec)
    remote.subscribe('echo', value => ({ doubled: (value as { n: number }).n * 2 }))
    const local = linkChannel(client, ndjsonCodec)

    await expect(local.request('echo', { n: 21 })).resolves.toEqual({ doubled: 42 })

    await local.dispose()
    await remote.dispose()
  })

  it('rejects a request for an unhandled method', async () => {
    const [client, peer] = pair()
    const local = linkChannel(client, ndjsonCodec)
    const remote = linkChannel(peer, ndjsonCodec)

    await expect(local.request('missing', null)).rejects.toThrow(/no handler for missing/)

    await local.dispose()
    await remote.dispose()
  })

  it('delivers one-way notifications and allows unsubscribe', async () => {
    const [client, peer] = pair()
    const received: unknown[] = []
    const remote = linkChannel(peer, ndjsonCodec)
    const unbind = remote.subscribe('ping', (value) => { received.push(value) })
    const local = linkChannel(client, ndjsonCodec)

    local.notify('ping', 42)
    local.notify('ping', 43)
    await vi.waitFor(() => { expect(received).toEqual([42, 43]) })

    unbind.dispose()
    local.notify('ping', 44)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(received).toEqual([42, 43])

    await local.dispose()
    await remote.dispose()
  })

  it('serves many accepted links with per-link decoding and per-peer replies', async () => {
    const transport = new InprocTransport()
    const listener = transport.bind(endpoint('srv'))
    const server = acceptChannel(listener, ndjsonCodec)
    server.subscribe('who', value => `peer ${String((value as { tag: string }).tag)}`)

    const alice = linkChannel(await transport.dial(endpoint('srv')), ndjsonCodec)
    const bob = linkChannel(await transport.dial(endpoint('srv')), ndjsonCodec)

    const [a, b] = await Promise.all([
      alice.request('who', { tag: 'a' }),
      bob.request('who', { tag: 'b' }),
    ])
    expect(a).toBe('peer a')
    expect(b).toBe('peer b')

    await alice.dispose()
    await bob.dispose()
    await server.dispose()
    await transport.dispose()
  })

  it('mounts a standard template over an accept channel', async () => {
    const transport = new InprocTransport()
    const template: ServerTemplate = {
      id: 'tpl' as StandardId,
      methods: { hi: () => 'yo' },
      notifications: new Set(['tick']),
    }
    const server = acceptChannel(transport.bind(endpoint('srv')), ndjsonCodec)
    const mount = template.mount !== undefined ? template.mount(server) : mountTemplate(template, server)
    const client = linkChannel(await transport.dial(endpoint('srv')), ndjsonCodec)

    await expect(client.request('hi', null)).resolves.toBe('yo')

    mount.dispose()
    await client.dispose()
    await server.dispose()
    await transport.dispose()
  })

  it('reconnects through the policy and re-issues idempotent requests only', async () => {
    let opens = 0
    const deadPeers: Connection[] = []
    const open = async (): Promise<Connection> => {
      opens += 1
      const [client, peer] = pair()
      if (opens === 1) {
        deadPeers.push(peer)
        return client
      }
      const responder = linkChannel(peer, ndjsonCodec)
      responder.subscribe('safe', value => (value as number) + 1)
      return client
    }
    const managed = channel(open, ndjsonCodec, {
      reconnect: { backoffMs: 5, maxAttempts: 2, idempotent: method => method === 'safe' },
    })

    const safe = managed.request('safe', 1)
    const unsafe = managed.request('unsafe', 1)
    await vi.waitFor(() => { expect(opens).toBe(1) })
    deadPeers[0]!.dispose()

    await expect(safe).resolves.toBe(2)
    await expect(unsafe).rejects.toThrow(/non-idempotent/)
    expect(opens).toBe(2)

    await managed.dispose()
  })

  it('times out requests left unanswered', async () => {
    const [client, peer] = pair()
    const local = linkChannel(client, ndjsonCodec, { requestTimeoutMs: 20 })
    void peer // peer stays silent; the timeout decides

    await expect(local.request('slow', null)).rejects.toThrow(/timed out: slow/)

    await local.dispose()
  })

  it('exposes the codec id on every channel', () => {
    const [client] = pair()
    const local = linkChannel(client, ndjsonCodec)
    expect(local.codecId).toBe(NDJSON)
    void local.dispose()
  })
})
