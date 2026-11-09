import { Readable, Writable } from 'node:stream'
import {
  agent as createAgentApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))

await createAgentApp({ name: 'stdio-peer' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: {},
    authMethods: [],
  }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: 'stdio-session' }))
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'answer over stdio' },
      },
    })
    return { stopReason: 'end_turn' }
  })
  .connect(stream)
