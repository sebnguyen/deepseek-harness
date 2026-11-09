import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { AcpClientTemplate } from '../../standard-acp/src/index.ts'
import { StdioTransport } from '../../transport-stdio/src/index.ts'
import { TransportId, type HostEndpoint } from '../src/types.ts'
import { endpoint, hostRecord } from './helpers.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-peer.mjs', import.meta.url))

function stdioEndpoint(): HostEndpoint {
  return {
    ...endpoint('stdio-peer'),
    transport: 'stdio' as TransportId,
    meta: { command: process.execPath, args: [FIXTURE] },
  }
}

describe('coral stdio transport', () => {
  it('runs the ACP standard over a child process pipe', async () => {
    const transport = new StdioTransport()
    const at = stdioEndpoint()

    const evidence = await new AcpClientTemplate().probe(await transport.dial(at), hostRecord())
    expect(evidence).not.toBeNull()

    const client = await new AcpClientTemplate().client(await transport.dial(at), evidence!, hostRecord())
    const session = await client.openSession()
    const result = await session.prompt('hello stdio')
    expect(result.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(client.updates).toHaveLength(1) })
    expect(client.updates[0]).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'answer over stdio' },
    })

    await client.dispose()
    await transport.dispose()
  }, 20_000)
})
