import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { AcpClientTemplate } from '../../standard-acp/src/index.ts'
import { InprocTransport } from '../../transport-inproc/src/index.ts'
import { SocketTransport } from '../../transport-socket/src/index.ts'
import { StdioTransport } from '../../transport-stdio/src/index.ts'
import type {
  Connection,
  ConnectionId,
  EndpointId,
  HostId,
  HostEndpoint,
  TransportFrame,
  TransportId,
} from '../src/types.ts'
import { endpoint, hostRecord, pair, ref, scriptedPeer } from './helpers.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-peer.mjs', import.meta.url))
const decoder = new TextDecoder()

type Kind = 'inproc-pair' | 'inproc-accept' | 'socket' | 'stdio'
const KINDS: readonly Kind[] = ['inproc-pair', 'inproc-accept', 'socket', 'stdio']

interface Harness {
  connect(): Promise<Connection>
  dispose(): Promise<void>
}

class RecordingConnection implements Connection {
  readonly id: ConnectionId
  readonly host: HostId
  readonly endpoint: EndpointId
  readonly generation: number
  readonly sent: TransportFrame[] = []
  readonly received: TransportFrame[] = []

  constructor(private readonly inner: Connection) {
    this.id = inner.id
    this.host = inner.host
    this.endpoint = inner.endpoint
    this.generation = inner.generation
  }

  send(frame: TransportFrame): Promise<void> {
    this.sent.push(frame)
    return this.inner.send(frame)
  }

  get read(): AsyncIterable<TransportFrame> {
    return this.capture()
  }

  private async *capture(): AsyncIterable<TransportFrame> {
    for await (const frame of this.inner.read) {
      this.received.push(frame)
      yield frame
    }
  }

  get closed(): boolean {
    return this.inner.closed
  }

  dispose(): void {
    this.inner.dispose()
  }
}

interface WireLine {
  readonly jsonrpc?: string
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
}

function messages(frames: readonly TransportFrame[]): WireLine[] {
  const text = frames.map(frame => decoder.decode(frame)).join('')
  return text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as WireLine)
}

function socketEndpoint(id: string): HostEndpoint {
  return { id: id as EndpointId, transport: 'socket' as TransportId, url: new URL('tcp://127.0.0.1:0') }
}

async function make(kind: Kind): Promise<Harness> {
  if (kind === 'inproc-pair') {
    return {
      connect: async () => {
        const [client, peer] = pair()
        scriptedPeer(peer, { reply: 'shape answer' })
        return client
      },
      dispose: async () => {},
    }
  }
  if (kind === 'inproc-accept') {
    const transport = new InprocTransport()
    transport.listen(ref('peer'), (connection) => { scriptedPeer(connection, { reply: 'shape answer' }) })
    return {
      connect: () => transport.dial(endpoint('peer'), {}),
      dispose: () => transport.dispose(),
    }
  }
  if (kind === 'socket') {
    const transport = new SocketTransport()
    const listener = await transport.accept(socketEndpoint('peer'), (connection) => {
      scriptedPeer(connection, { reply: 'shape answer' })
    })
    return {
      connect: () => transport.dial(listener.endpoint, {}),
      dispose: async () => { await listener.close(); await transport.dispose() },
    }
  }
  const transport = new StdioTransport()
  const at: HostEndpoint = {
    ...endpoint('peer'),
    transport: 'stdio' as TransportId,
    meta: { command: process.execPath, args: ['--no-warnings', FIXTURE] },
  }
  return {
    connect: () => transport.dial(at, {}),
    dispose: () => transport.dispose(),
  }
}

function expectInitialize(recording: RecordingConnection): void {
  const sent = messages(recording.sent)
  const received = messages(recording.received)
  const request = sent.find(message => message.method === 'initialize')
  expect(request).toMatchObject({ jsonrpc: '2.0', method: 'initialize' })
  expect(typeof request.id).toBe('number')
  expect(typeof request.params.protocolVersion).toBe('number')
  expect(typeof request.params.clientCapabilities).toBe('object')

  const response = received.find(message => message.id === request.id)
  expect(typeof response.result.protocolVersion).toBe('number')
  expect(typeof response.result.agentCapabilities).toBe('object')
  expect(Array.isArray(response.result.authMethods)).toBe(true)
}

function expectSession(recording: RecordingConnection): void {
  const sent = messages(recording.sent)
  const received = messages(recording.received)

  const newRequest = sent.find(message => message.method === 'session/new')
  expect(typeof newRequest.params.cwd).toBe('string')
  expect(Array.isArray(newRequest.params.mcpServers)).toBe(true)
  const newResponse = received.find(message => message.id === newRequest.id)
  expect(typeof newResponse.result.sessionId).toBe('string')

  const promptRequest = sent.find(message => message.method === 'session/prompt')
  expect(promptRequest.params.sessionId).toBe(newResponse.result.sessionId)
  expect(Array.isArray(promptRequest.params.prompt)).toBe(true)
  expect(promptRequest.params.prompt[0]).toMatchObject({ type: 'text', text: 'shape' })
  const promptResponse = received.find(message => message.id === promptRequest.id)
  expect(typeof promptResponse.result.stopReason).toBe('string')

  const update = received.find(message => message.method === 'session/update')
  expect(update.id).toBeUndefined()
  expect(update.params.sessionId).toBe(newResponse.result.sessionId)
  expect(update.params.update.sessionUpdate).toBe('agent_message_chunk')
  expect(update.params.update.content).toMatchObject({ type: 'text' })

  const cancel = sent.find(message => message.method === 'session/cancel')
  expect(cancel).toBeDefined()
  expect(cancel.id).toBeUndefined()
  expect(cancel.params.sessionId).toBe(newResponse.result.sessionId)
}

describe('coral ACP wire shapes', () => {
  for (const kind of KINDS) {
    it(`initialize, session/new, prompt, update, and cancel over ${kind}`, async () => {
      const harness = await make(kind)

      const probe = new RecordingConnection(await harness.connect())
      const evidence = await new AcpClientTemplate().probe(probe, hostRecord())
      expect(evidence).not.toBeNull()
      expectInitialize(probe)

      const clientConnection = new RecordingConnection(await harness.connect())
      const client = await new AcpClientTemplate().client(clientConnection, evidence!, hostRecord())
      const session = await client.openSession()
      await session.prompt('shape')
      await vi.waitFor(() => { expect(client.updates).toHaveLength(1) })
      await session.cancel()
      expectSession(clientConnection)

      await client.dispose()
      await harness.dispose()
    })
  }
})
