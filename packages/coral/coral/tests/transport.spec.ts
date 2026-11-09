import { describe, expect, it } from 'vitest'
import { agent as createAgentApp, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { connectionStream } from '../../standard-acp/src/index.ts'
import { pair } from './helpers.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('inproc transport contract', () => {
  it('delivers frames in order', async () => {
    const [a, b] = pair()
    const seen: string[] = []
    const reader = (async () => {
      for await (const frame of b.read) {
        seen.push(decoder.decode(frame))
        if (seen.length === 3) return
      }
    })()
    await a.send(encoder.encode('one'))
    await a.send(encoder.encode('two'))
    await a.send(encoder.encode('three'))
    await reader
    expect(seen).toEqual(['one', 'two', 'three'])
  })

  it('ends the peer read when one side closes', async () => {
    const [a, b] = pair()
    const ended = (async () => {
      for await (const _frame of b.read) { /* drain */ }
    })()
    await a.dispose()
    await expect(ended).resolves.toBeUndefined()
  })

  it('rejects writes after close', async () => {
    const [a] = pair()
    await a.dispose()
    await expect(a.send(encoder.encode('x'))).rejects.toThrow(/closed/)
  })

  it('applies backpressure at the queue bound', async () => {
    const [a, b] = pair(2)
    await a.send(encoder.encode('1'))
    await a.send(encoder.encode('2'))
    const third = a.send(encoder.encode('3'))
    const raced = await Promise.race([
      third.then(() => 'resolved' as const),
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 20)),
    ])
    expect(raced).toBe('pending')
    const iterator = b.read[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    await expect(third).resolves.toBeUndefined()
  })

  it('parses one JSON line split across two frames', async () => {
    const [client, peer] = pair()
    let received: unknown
    const handled = new Promise<void>((resolve) => {
      createAgentApp({ name: 'split-line' })
        .onRequest(methods.agent.initialize, ({ params }) => {
          received = params
          resolve()
          return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, authMethods: [] }
        })
        .connect(connectionStream(peer))
    })
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} },
    })
    await client.send(encoder.encode(line.slice(0, 20)))
    await client.send(encoder.encode(`${line.slice(20)}\n`))
    await handled
    expect(received).toMatchObject({ protocolVersion: PROTOCOL_VERSION })
  })
})
