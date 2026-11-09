import {
  agent as createAgentApp,
  methods,
  PROTOCOL_VERSION,
  type InitializeResponse,
} from '@agentclientprotocol/sdk'
import { connectionStream } from '../../standard-acp/src/index.ts'
import { InprocTransport, type EndpointRef } from '../../transport-inproc/src/index.ts'
import type {
  EndpointId,
  HostId,
  TransportId,
  Connection,
  HostEndpoint,
  HostRecord,
  JsonValue,
} from '../src/types.ts'

export const HOST = 'test-host' as HostId

export function endpoint(id: string): HostEndpoint {
  return { id: id as EndpointId, transport: 'inproc' as TransportId, url: null }
}

export function ref(id: string): EndpointRef {
  return { host: HOST, endpoint: endpoint(id) }
}

export function hostRecord(): HostRecord {
  return { id: HOST, endpoints: [], supports: new Map(), states: new Map() }
}

export function pair(limit = 64): readonly [Connection, Connection] {
  return new InprocTransport(limit).pair(ref('a'), ref('b'))
}

export function pairTo(endpointId: string, limit = 64): readonly [Connection, Connection] {
  return new InprocTransport(limit).pair(ref('client'), ref(endpointId))
}

export interface ScriptedPeer {
  readonly initializeCount: number
  readonly prompts: readonly { readonly sessionId: string; readonly text: string }[]
}

export function scriptedPeer(
  connection: Connection,
  options: { reply?: string; sessionId?: string; capabilities?: JsonValue } = {},
): ScriptedPeer {
  const answer = options.reply ?? 'from peer'
  const sessionId = options.sessionId ?? 'session-1'
  let initializeCount = 0
  const prompts: Array<{ sessionId: string; text: string }> = []
  const capabilities = (options.capabilities ?? { loadSession: true }) as unknown as NonNullable<InitializeResponse['agentCapabilities']>

  createAgentApp({ name: 'dsh-coral-scripted-peer' })
    .onRequest(methods.agent.initialize, () => {
      initializeCount += 1
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: capabilities, authMethods: [] }
    })
    .onRequest(methods.agent.session.new, () => ({ sessionId }))
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      const text = params.prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      prompts.push({ sessionId: params.sessionId, text })
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } },
      })
      return { stopReason: 'end_turn' as const }
    })
    .connect(connectionStream(connection))

  return {
    get initializeCount() { return initializeCount },
    get prompts() { return prompts },
  }
}
